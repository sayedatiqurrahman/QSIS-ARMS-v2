'use client';
import { useState, useEffect, useCallback, useMemo } from 'react'
import { config } from '@/lib/config'
import { FACULTIES } from '@/lib/departments'
import CustomSelect from '@/components/CustomSelect'
import { normalizeUniversityId } from '@/lib/utils'

export default function BatchesTab({ effectiveRole, profile }: { effectiveRole: string; profile: any }) {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState('qsis');
  const [batchName, setBatchName] = useState('');
  const [session, setSession] = useState('');
  const [startSem, setStartSem] = useState('');
  const [idRange, setIdRange] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [studentEmail, setStudentEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [isReAdmission, setIsReAdmission] = useState(false);
  const [editStudentId, setEditStudentId] = useState<string | null>(null);
  const [editUniId, setEditUniId] = useState('');
  const [editOrigId, setEditOrigId] = useState('');
  const [canManage, setCanManage] = useState(false);

  const deptOptions = useMemo(() => FACULTIES.flatMap(f => f.departments.map(d => ({
    value: d.id, label: `${d.shortName} — ${d.name}`, icon: 'fa-building', group: f.shortName,
  }))), []);

  useEffect(() => {
    fetch('/api/settings/permissions').then(r => r.json()).then(data => {
      if (!data.success) return;
      const perms = data.permissions || {};
      const roleKey = profile?.isCR ? 'cr' : effectiveRole;
      const customPerms = profile?.customPermissions || {};
      const allowed = perms.manageBatches || ['admin', 'manager', 'teacher', 'cr', 'acr'];
      setCanManage(customPerms.manageBatches === true || allowed.includes(roleKey));
    }).catch(() => {});
  }, [effectiveRole, profile]);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/batches?department=${dept}`);
      const data = await res.json();
      if (data.success) setBatches(data.batches);
    } catch {}
    setLoading(false);
  }, [dept]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const createBatch = async () => {
    if (!batchName.trim() || !session.trim()) { setError('Enter batch name and session'); return; }
    setError(''); setSuccess('');
    try {
      const res = await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createBatch', department: dept, name: batchName.trim(), session: session.trim(), startSemester: startSem || undefined, idRange: idRange.trim() || undefined }) });
      const data = await res.json();
      if (data.success) { setSuccess('Batch created'); setBatchName(''); setSession(''); setIdRange(''); loadBatches(); setTimeout(() => setSuccess(''), 2000); }
      else setError(data.error || 'Failed');
    } catch { setError('Network error'); }
  };

  const deleteBatch = async (batchId: string) => {
    try {
      await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteBatch', batchId }) });
      loadBatches();
    } catch {}
  };

  const addStudent = async (batchId: string) => {
    if (!studentEmail.trim() || !studentId.trim()) { setError('Enter student email and ID'); return; }
    setError('');
    try {
      const res = await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addStudent', batchId, email: studentEmail.trim(), universityId: studentId.trim(), name: studentName.trim() || undefined, isReAdmission }) });
      const data = await res.json();
      if (data.success) { setStudentEmail(''); setStudentId(''); setStudentName(''); setIsReAdmission(false); loadBatches(); }
      else setError(data.error || 'Failed');
    } catch { setError('Network error'); }
  };

  const removeStudent = async (studentId: string) => {
    try {
      await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'removeStudent', studentId }) });
      loadBatches();
    } catch {}
  };

  const startEditStudent = (s: any) => {
    setEditStudentId(s.id);
    setEditUniId(s.universityId);
    setEditOrigId(s.originalId || '');
  };

  const saveEditStudent = async () => {
    if (!editStudentId) return;
    try {
      await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateStudent', studentId: editStudentId, universityId: editUniId, originalId: editOrigId || undefined }) });
      setEditStudentId(null);
      loadBatches();
    } catch {}
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-dark-text"><i className="fas fa-layer-group text-purple-400 mr-2"></i>Batch Management</h3>
      <p className="text-[0.72rem] text-dark-text3">Manage student batches. Semesters auto-progress every 6 months. Batches auto-close after 4.5 years.</p>
      {success && <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs"><i className="fas fa-check mr-1"></i>{success}</div>}
      {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs"><i className="fas fa-exclamation-triangle mr-1"></i>{error}</div>}

      {canManage && (
        <div className="p-4 bg-dark-bg2 border border-dark-border rounded-xl">
          <h4 className="text-[0.82rem] font-semibold text-dark-text mb-3"><i className="fas fa-plus-circle text-purple-400 mr-1.5"></i>Create New Batch</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[0.68rem] text-dark-text3 mb-0.5 block">Department *</label>
              <CustomSelect value={dept} onChange={setDept} options={deptOptions} placeholder="Select..." searchable className="w-full" />
            </div>
            <div>
              <label className="text-[0.68rem] text-dark-text3 mb-0.5 block">Batch Name *</label>
              <input value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. Batch-56" className="w-full px-2.5 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.78rem] outline-none focus:border-qsis" />
            </div>
            <div>
              <label className="text-[0.68rem] text-dark-text3 mb-0.5 block">Session *</label>
              <input value={session} onChange={e => setSession(e.target.value)} placeholder="e.g. 2023-24" className="w-full px-2.5 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.78rem] outline-none focus:border-qsis" />
            </div>
            <div>
              <label className="text-[0.68rem] text-dark-text3 mb-0.5 block">ID Range</label>
              <input value={idRange} onChange={e => setIdRange(e.target.value)} placeholder="e.g. Q233020-Q233100" className="w-full px-2.5 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.78rem] outline-none focus:border-qsis" />
            </div>
            <div>
              <label className="text-[0.68rem] text-dark-text3 mb-0.5 block">Start Semester</label>
              <CustomSelect value={startSem} onChange={setStartSem} options={[{ value: '', label: 'Not assigned', icon: 'fa-calendar' }, ...config.semesters.map(s => ({ value: s.id, label: s.label, icon: 'fa-calendar' }))]} className="w-full" />
            </div>
          </div>
          <button onClick={createBatch} className="routine-btn routine-btn-primary text-[0.72rem]"><i className="fas fa-plus mr-1"></i>Create Batch</button>
        </div>
      )}

      {loading ? <div className="text-center py-6"><i className="fas fa-spinner fa-spin text-qsis text-xl"></i></div> : (
        <div className="space-y-3">
          {batches.length === 0 && <p className="text-dark-text3 text-xs text-center py-4">No batches for this department</p>}
          {batches.map(b => {
            const isExpanded = expandedBatch === b.id;
            const semLabel = config.semesters.find(s => s.id === b.currentSemester)?.label || b.currentSemester;
            return (
              <div key={b.id} className="bg-dark-bg2 border border-dark-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-dark-bg3/50" onClick={() => setExpandedBatch(isExpanded ? null : b.id)}>
                  <i className={`fas fa-layer-group ${b.isActive ? 'text-purple-400' : 'text-dark-text3'}`}></i>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-bold text-dark-text">{b.name}</span>
                      <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-dark-bg border border-dark-border text-dark-text3">{b.session}</span>
                      {b.isActive ? <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Active</span> : <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-dark-bg border border-dark-border text-dark-text3">Closed</span>}
                    </div>
                    <div className="text-[0.68rem] text-dark-text3 mt-0.5">
                      Current: {semLabel} &middot; {b.studentCount || 0} students &middot; Target: {new Date(b.targetEndDate).toLocaleDateString()}
                    </div>
                  </div>
                  {canManage && <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} className="text-red-400 hover:text-red-300 bg-transparent border-none cursor-pointer text-[0.68rem]"><i className="fas fa-trash"></i></button>}
                  <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} text-dark-text3 text-[0.65rem]`}></i>
                </div>

                {isExpanded && (
                  <div className="border-t border-dark-border p-3 space-y-3">
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <input value={studentEmail} onChange={e => setStudentEmail(e.target.value)} placeholder="student@ugrad.iiuc.ac.bd" className="flex-1 min-w-[180px] px-2 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.72rem] outline-none focus:border-qsis" />
                        <input value={studentId} onChange={e => setStudentId(e.target.value)} onBlur={e => setStudentId(normalizeUniversityId(e.target.value))} placeholder="University ID (e.g. Q233099)" className="w-28 px-2 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.72rem] outline-none focus:border-qsis" />
                        <input value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="Name (optional)" className="w-32 px-2 py-1.5 rounded border border-dark-border bg-dark-bg text-dark-text text-[0.72rem] outline-none focus:border-qsis" />
                        <label className="flex items-center gap-1 text-[0.68rem] text-dark-text3 cursor-pointer">
                          <input type="checkbox" checked={isReAdmission} onChange={e => setIsReAdmission(e.target.checked)} className="rounded" />
                          Re-admission
                        </label>
                        <button onClick={() => addStudent(b.id)} className="px-3 py-1.5 bg-qsis text-white rounded text-[0.72rem] font-semibold hover:bg-qsis/90"><i className="fas fa-user-plus mr-1"></i>Add</button>
                      </div>
                    )}

                    {b.students && b.students.length > 0 ? (
                      <div className="space-y-1">
                        {b.students.map((s: any) => (
                          <div key={s.id} className="flex items-center gap-2 p-2 rounded bg-dark-bg border border-dark-border text-[0.72rem]">
                            {editStudentId === s.id ? (
                              <>
                                <input value={editUniId} onChange={e => setEditUniId(e.target.value)} className="w-24 px-1.5 py-0.5 rounded border border-qsis bg-dark-bg2 text-dark-text text-[0.7rem] outline-none" />
                                <input value={editOrigId} onChange={e => setEditOrigId(e.target.value)} placeholder="Orig ID" className="w-24 px-1.5 py-0.5 rounded border border-dark-border bg-dark-bg2 text-dark-text text-[0.7rem] outline-none" />
                                <button onClick={saveEditStudent} className="text-green-400 hover:text-green-300 bg-transparent border-none cursor-pointer text-[0.65rem]"><i className="fas fa-check"></i></button>
                                <button onClick={() => setEditStudentId(null)} className="text-dark-text3 hover:text-dark-text bg-transparent border-none cursor-pointer text-[0.65rem]"><i className="fas fa-times"></i></button>
                              </>
                            ) : (
                              <>
                                <span className="font-mono font-semibold text-dark-text w-24">{s.universityId}</span>
                                {s.originalId && <span className="text-[0.6rem] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Orig: {s.originalId}</span>}
                                {s.isReAdmission && <span className="text-[0.6rem] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400">Re-admission</span>}
                                <span className="flex-1 text-dark-text2 truncate">{s.name || s.email}</span>
                                {canManage && (
                                  <>
                                    <button onClick={() => startEditStudent(s)} className="text-qsis hover:text-qsis/80 bg-transparent border-none cursor-pointer text-[0.65rem]"><i className="fas fa-edit"></i></button>
                                    <button onClick={() => removeStudent(s.id)} className="text-red-400 hover:text-red-300 bg-transparent border-none cursor-pointer text-[0.65rem]"><i className="fas fa-trash"></i></button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-dark-text3 text-[0.7rem] text-center py-2">No students in this batch</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}