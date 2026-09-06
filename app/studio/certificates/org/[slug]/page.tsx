'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import Link from 'next/link';
import { downloadCertPDF, generateBulkCertPDF, CertPDFData } from '@/lib/club-cert-pdf';
import { CertSignatory, CertTheme, DEFAULT_THEME, THEME_PRESETS } from '@/lib/cert-theme';
import { useAppStore } from '@/lib/store';
import CertDesignPanel from '@/components/studio/CertDesignPanel';
import { normalizeUniversityId } from '@/lib/utils';

interface CertRow {
  memberName: string;
  universityId: string;
  department: string;
  session: string;
  post: string;
  eventName: string;
  servicePeriod: string;
}

const defaultSignatories: CertSignatory[] = [
  { name: '', designation: '', title: 'President' },
  { name: '', designation: '', title: 'Chairman' },
];

export default function StudioOrgDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const profile = useAppStore(s => s.profile);
  const [slug, setSlug] = useState('');
  const [org, setOrg] = useState<any>(null);
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'issue' | 'issued'>('issue');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<CertRow[]>([{ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' }]);
  const [signatories, setSignatories] = useState<CertSignatory[]>(defaultSignatories);
  const [themes, setThemes] = useState<CertTheme[]>(THEME_PRESETS);
  const [selectedTheme, setSelectedTheme] = useState<CertTheme>(DEFAULT_THEME);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<any[]>([]);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [editingCert, setEditingCert] = useState<any>(null);
  const [certDraft, setCertDraft] = useState({ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' });
  const [editCertSaving, setEditCertSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOwner = org?.createdBy === profile.email;

  useEffect(() => {
    params.then(async p => {
      setSlug(p.slug);
      try {
        const [orgRes, themesRes, themeRes] = await Promise.all([
          fetch(`/api/studio/certificates/orgs/${p.slug}`),
          fetch('/api/clubs/themes'),
          fetch(`/api/studio/certificates/orgs/${p.slug}/theme`).catch(() => null),
        ]);
        const orgData = await orgRes.json();
        const themesData = await themesRes.json();
        setOrg(orgData.org);
        setCerts(orgData.org?.certificates || []);
        if (themesData.themes) setThemes(themesData.themes);
        if (themeRes && themeRes.ok) {
          const savedTheme = await themeRes.json();
          if (savedTheme.theme?.design) {
            setSelectedTheme(prev => ({ ...prev, design: savedTheme.theme.design }));
          }
        }
      } catch {}
      setLoading(false);
    });
  }, []);

  function updateRow(i: number, field: keyof CertRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, { memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateSignatory(i: number, field: keyof CertSignatory, value: string) {
    setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  function addSignatory() {
    setSignatories(prev => [...prev, { name: '', designation: '', title: '' }]);
  }

  function removeSignatory(i: number) {
    if (signatories.length <= 1) return;
    setSignatories(prev => prev.filter((_, idx) => idx !== i));
  }

  function handleDesignChange(next: CertTheme) {
    setSelectedTheme(next);
    try {
      localStorage.setItem(`cert-design:${slug}`, JSON.stringify(next.design || {}));
    } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/studio/certificates/orgs/${slug}/theme`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: next }),
        });
      } catch {}
    }, 800);
  }

  async function handleIssue() {
    const valid = rows.filter(r => r.memberName.trim() && r.universityId.trim() && r.department.trim());
    if (valid.length === 0) return;
    setIssuing(true);
    try {
      const cleanedSigs = signatories.filter(s => s.name.trim());
      const res = await fetch(`/api/studio/certificates/orgs/${slug}/certificates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificates: valid.map(r => ({
            ...r,
            signatories: cleanedSigs.length > 0 ? cleanedSigs : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIssued(data.certificates || []);
        const urls: Record<string, string> = {};
        for (const cert of data.certificates) {
          urls[cert.certificateId] = await QRCode.toDataURL(
            `${typeof window !== 'undefined' ? window.location.origin : 'https://iiuc-arms.eu.cc'}/clubs/preview/${cert.certificateId}`,
            { width: 200, margin: 2 }
          );
        }
        setQrUrls(urls);
        setCerts(prev => [...(data.certificates || []), ...prev]);
        setRows([{ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' }]);
      } else {
        alert(data.error || 'Failed to issue');
      }
    } catch { alert('Network error'); }
    setIssuing(false);
  }

  async function handleBulkDownload() {
    if (issued.length === 0) return;
    setGeneratingPdf(true);
    try {
      await generateBulkCertPDF(issued.map(toCertPDFData));
    } catch { alert('PDF generation failed'); }
    setGeneratingPdf(false);
  }

  async function handleOpenEditCert(cert: any) {
    if (!cert) return;
    setEditingCert(cert);
    setCertDraft({
      memberName: cert.memberName || '',
      universityId: cert.universityId || '',
      department: cert.department || '',
      session: cert.session || '',
      post: cert.post || '',
      eventName: cert.eventName || '',
      servicePeriod: cert.servicePeriod || '',
    });
  }

  async function handleSaveEditCert() {
    if (!editingCert || !slug) return;
    setEditCertSaving(true);
    try {
      const res = await fetch(`/api/studio/certificates/orgs/${slug}/certificates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificateId: editingCert.certificateId, data: certDraft }),
      });
      const data = await res.json();
      if (data.success) {
        setCerts(prev => prev.map((c: any) => c.certificateId === editingCert.certificateId ? data.certificate : c));
        setEditingCert(null);
      } else {
        alert(data.error || 'Failed to update certificate');
      }
    } catch { alert('Network error'); }
    setEditCertSaving(false);
  }

  function toCertPDFData(cert: any): CertPDFData {
    return {
      certificateId: cert.certificateId,
      memberName: cert.memberName,
      universityId: cert.universityId,
      department: cert.department,
      session: cert.session || '',
      post: cert.post || '',
      eventName: cert.eventName || '',
      servicePeriod: cert.servicePeriod || '',
      clubName: org?.name || slug,
      clubLogoUrl: org?.logoUrl || undefined,
      iiucLogoUrl: '/iiuc-logo.png',
      issuedBy: org?.name || slug,
      issuedAt: cert.issuedAt || new Date().toISOString(),
      signatories: signatories.filter(s => s.name.trim()),
      theme: selectedTheme,
    };
  }

  const filteredCerts = certs.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.memberName?.toLowerCase().includes(q) || c.certificateId?.toLowerCase().includes(q) || c.universityId?.toLowerCase().includes(q);
  });

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <i className="fas fa-spinner fa-spin text-qsis text-2xl"></i>
    </div>
  );

  if (!org) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <i className="fas fa-exclamation-triangle text-yellow-400 text-4xl mb-4"></i>
      <h2 className="text-lg font-bold text-dark-text mb-2">Organization not found</h2>
      <Link href="/studio/certificates" className="text-qsis text-sm hover:underline no-underline"><i className="fas fa-arrow-left mr-1"></i>Back to Certificate Studio</Link>
    </div>
  );

  return (
    <div className="min-h-screen py-6 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/studio/certificates" className="text-qsis text-xs hover:underline no-underline"><i className="fas fa-arrow-left mr-1"></i>Back to Certificate Studio</Link>
          <div className="flex items-center gap-4 mt-3">
            {org.logoUrl ? (
              <img src={org.logoUrl} alt="" className="w-16 h-16 rounded-2xl object-cover border border-dark-border bg-white" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-qsis/15 flex items-center justify-center">
                <i className="fas fa-certificate text-qsis text-2xl"></i>
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-dark-text">{org.name}</h1>
              <p className="text-sm text-dark-text2 capitalize">{org.type} &middot; {certs.length} certificates issued</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide">
          <button onClick={() => setTab('issue')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${tab === 'issue' ? 'bg-qsis text-white' : 'bg-dark-bg2 text-dark-text2 border border-dark-border hover:border-qsis/50'}`}>
            <i className="fas fa-plus mr-1.5"></i>Issue Certificates
          </button>
          <button onClick={() => setTab('issued')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${tab === 'issued' ? 'bg-qsis text-white' : 'bg-dark-bg2 text-dark-text2 border border-dark-border hover:border-qsis/50'}`}>
            <i className="fas fa-list mr-1.5"></i>Issued ({certs.length})
          </button>
        </div>

        {/* ═══ ISSUE TAB ═══ */}
        {tab === 'issue' && (
          <div className="space-y-4">
            {/* Subscription Badge */}
            <div className="rounded-xl border border-dashed border-qsis/30 bg-qsis/5 p-3 flex items-center gap-3">
              <i className="fas fa-gem text-qsis"></i>
              <span className="text-xs text-dark-text2"><span className="font-bold text-qsis">Free Plan</span> &mdash; Unlimited certificate issuance. Premium features coming soon.</span>
            </div>

            {/* Theme */}
            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-dark-text mb-3"><i className="fas fa-palette text-qsis mr-2"></i>Certificate Theme</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {themes.map(theme => (
                  <button key={theme.name} onClick={() => setSelectedTheme(theme)}
                    className={`p-3 rounded-xl border text-left transition-all text-xs ${
                      selectedTheme.name === theme.name
                        ? 'border-qsis bg-qsis/10 text-qsis'
                        : 'border-dark-border bg-dark-bg text-dark-text2 hover:border-qsis/40'
                    }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: `rgb(${theme.colors.primary.join(',')})` }}></div>
                      <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: `rgb(${theme.colors.secondary.join(',')})` }}></div>
                      <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: `rgb(${theme.colors.background.join(',')})` }}></div>
                    </div>
                    <span className="font-semibold block">{theme.displayName}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Design Customization */}
            <CertDesignPanel theme={selectedTheme} onChange={handleDesignChange} />

            {/* Signatories */}
            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-dark-text"><i className="fas fa-signature text-qsis mr-2"></i>Signatories</h3>
                <button onClick={addSignatory} className="text-qsis text-xs font-semibold hover:underline"><i className="fas fa-plus mr-1"></i>Add</button>
              </div>
              <div className="space-y-3">
                {signatories.map((sig, i) => (
                  <div key={i} className="bg-dark-bg border border-dark-border rounded-xl p-3 flex items-start gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                      <div>
                        <label className="text-[0.65rem] text-dark-text2 mb-1 block">Name</label>
                        <input type="text" value={sig.name} onChange={e => updateSignatory(i, 'name', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-xs outline-none focus:border-qsis"
                          placeholder="Dr. Mohammed Rahman" />
                      </div>
                      <div>
                        <label className="text-[0.65rem] text-dark-text2 mb-1 block">Title</label>
                        <input type="text" value={sig.title} onChange={e => updateSignatory(i, 'title', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-xs outline-none focus:border-qsis"
                          placeholder="President" />
                      </div>
                      <div>
                        <label className="text-[0.65rem] text-dark-text2 mb-1 block">Designation</label>
                        <input type="text" value={sig.designation} onChange={e => updateSignatory(i, 'designation', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-xs outline-none focus:border-qsis"
                          placeholder="Dept. of CSE, IIUC" />
                      </div>
                      <div className="mt-2">
                        <label className="text-[0.65rem] text-dark-text2 mb-1 block">Signature text</label>
                        <input type="text" value={sig.signatureText || ''} onChange={e => updateSignatory(i, 'signatureText', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-xs outline-none focus:border-qsis"
                          placeholder="Text to render as the script signature (blank = first word of name)" />
                      </div>
                    </div>
                    {signatories.length > 1 && (
                      <button onClick={() => removeSignatory(i)} className="text-red-400 hover:text-red-300 text-xs mt-5"><i className="fas fa-trash"></i></button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Recipients */}
            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-dark-text"><i className="fas fa-users text-qsis mr-2"></i>Certificate Recipients</h3>
                <button onClick={addRow} className="text-qsis text-xs font-semibold hover:underline"><i className="fas fa-plus mr-1"></i>Add More</button>
              </div>
              <div className="space-y-4">
                {rows.map((row, i) => (
                  <div key={i} className="bg-dark-bg border border-dark-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-dark-text2 font-semibold">#{i + 1}</span>
                      {rows.length > 1 && (
                        <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-300 text-xs"><i className="fas fa-trash"></i></button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Full Name *</label>
                        <input type="text" value={row.memberName} onChange={e => updateRow(i, 'memberName', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="Md. Abdul Karim" />
                      </div>
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">University ID *</label>
                        <input type="text" value={row.universityId} onChange={e => updateRow(i, 'universityId', e.target.value)} onBlur={e => updateRow(i, 'universityId', normalizeUniversityId(e.target.value))}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="Q233099" />
                      </div>
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Department *</label>
                        <input type="text" value={row.department} onChange={e => updateRow(i, 'department', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="CSE" />
                      </div>
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Post / Role</label>
                        <input type="text" value={row.post} onChange={e => updateRow(i, 'post', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="General Secretary" />
                      </div>
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Service Period</label>
                        <input type="text" value={row.servicePeriod} onChange={e => updateRow(i, 'servicePeriod', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="2024-2025" />
                      </div>
                      <div>
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Session</label>
                        <input type="text" value={row.session} onChange={e => updateRow(i, 'session', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="2022-23" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Event Name (optional)</label>
                        <input type="text" value={row.eventName} onChange={e => updateRow(i, 'eventName', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-sm outline-none focus:border-qsis"
                          placeholder="Programming Contest 2025" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={handleIssue} disabled={issuing}
                  className="px-6 py-2.5 bg-qsis text-white rounded-lg text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
                  {issuing ? <><i className="fas fa-spinner fa-spin mr-1"></i>Issuing...</> : <><i className="fas fa-certificate mr-1"></i>Issue {rows.filter(r => r.memberName.trim() && r.universityId.trim() && r.department.trim()).length} Certificate(s)</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ISSUED TAB ═══ */}
        {tab === 'issued' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="bg-dark-bg2 border border-dark-border rounded-xl p-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-dark-text3 text-sm"></i>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis"
                    placeholder="Search by name, ID..." />
                </div>
              </div>
            </div>

            {filteredCerts.length === 0 ? (
              <div className="bg-dark-bg2 rounded-xl border border-dark-border p-12 text-center">
                <i className="fas fa-certificate text-dark-text3 text-4xl mb-3 block"></i>
                <p className="text-dark-text2 text-sm">{search ? 'No certificates match your search' : 'No certificates issued yet'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCerts.map((cert: any) => (
                  <div key={cert.id} className="bg-dark-bg2 border border-dark-border rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center">
                            <i className="fas fa-certificate text-yellow-400 text-sm"></i>
                          </div>
                          <div>
                            <p className="text-xs font-mono font-bold text-dark-text">{cert.certificateId}</p>
                            <p className="text-xs text-dark-text2">{cert.memberName}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] ml-10">
                          <span className="text-dark-text2">UID: <span className="text-dark-text">{cert.universityId}</span></span>
                          <span className="text-dark-text2">Dept: <span className="text-dark-text">{cert.department}</span></span>
                          {cert.post && <span className="text-dark-text2">Post: <span className="text-qsis">{cert.post}</span></span>}
                          {cert.eventName && <span className="text-dark-text2">Event: <span className="text-dark-text">{cert.eventName}</span></span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                          className="w-8 h-8 flex items-center justify-center bg-qsis/15 text-qsis border border-qsis/30 rounded-lg hover:bg-qsis/25 transition no-underline">
                          <i className="fas fa-external-link-alt text-xs"></i>
                        </a>
                        <button onClick={() => downloadCertPDF(toCertPDFData(cert))}
                          className="w-8 h-8 flex items-center justify-center bg-red-500/15 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/25 transition">
                          <i className="fas fa-file-pdf text-xs"></i>
                        </button>
                        <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                          className="w-8 h-8 flex items-center justify-center bg-dark-bg3 text-dark-text border border-dark-border rounded-lg hover:border-qsis transition no-underline">
                          <i className="fas fa-eye text-xs"></i>
                        </a>
                        {isOwner && (
                          <button onClick={() => handleOpenEditCert(cert)}
                            className="w-8 h-8 flex items-center justify-center bg-blue-500/15 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/25 transition"
                            title="Edit certificate">
                            <i className="fas fa-edit text-xs"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ POST-ISSUE SUCCESS ═══ */}
        {issued.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto">
              <div className="text-center mb-5">
                <i className="fas fa-check-circle text-green-400 text-3xl mb-2 block"></i>
                <h2 className="text-lg font-bold text-green-400">{issued.length} Certificate(s) Issued</h2>
                <p className="text-xs text-dark-text2 mt-1">Verifiable at iiuc-arms.eu.cc/verify</p>
              </div>
              <div className="flex items-center justify-center gap-3 mb-5">
                <button onClick={handleBulkDownload} disabled={generatingPdf}
                  className="px-4 py-2 bg-qsis text-white rounded-lg text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
                  {generatingPdf ? <><i className="fas fa-spinner fa-spin mr-1"></i>Generating...</> : <><i className="fas fa-file-pdf mr-1"></i>Download PDFs ({issued.length})</>}
                </button>
                <button onClick={() => { setIssued([]); setTab('issued'); }}
                  className="px-4 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm font-semibold text-dark-text2 hover:border-qsis transition">
                  View Issued
                </button>
              </div>
              <div className="space-y-3">
                {issued.map(cert => (
                  <div key={cert.id} className="bg-dark-bg border border-dark-border rounded-xl p-4 flex items-center gap-4">
                    {qrUrls[cert.certificateId] && (
                      <img src={qrUrls[cert.certificateId]} alt="QR" className="w-20 h-20 rounded-lg border border-dark-border shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-bold text-dark-text">{cert.certificateId}</p>
                      <p className="text-xs text-dark-text2">{cert.memberName} &middot; {cert.universityId}</p>
                      <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                        className="text-[0.65rem] text-qsis hover:underline no-underline mt-1 inline-block">
                        <i className="fas fa-external-link-alt mr-1"></i>Verify
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* ═══ EDIT CERTIFICATE ═══ */}
        {editingCert && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditingCert(null)}>
            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-bold text-dark-text mb-1"><i className="fas fa-edit text-qsis mr-2"></i>Edit Certificate {editingCert.certificateId}</h3>
              <p className="text-xs text-dark-text2 mb-4">Update recipient details. The certificate ID and issue date stay unchanged.</p>
              <div className="space-y-3">
                {([['memberName', 'Member Name', true], ['universityId', 'University ID', true], ['department', 'Department', true], ['session', 'Session'], ['post', 'Post'], ['eventName', 'Event Name'], ['servicePeriod', 'Service Period']] as const).map(([key, label, required]) => (
                  <div key={key}>
                    <label className="text-xs text-dark-text2 font-semibold mb-1 block">{label}{required && <span className="text-red-400"> *</span>}</label>
                    <input type="text" value={certDraft[key]} onChange={e => setCertDraft(d => ({ ...d, [key]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition" />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setEditingCert(null)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
                <button onClick={handleSaveEditCert} disabled={editCertSaving || !certDraft.memberName.trim() || !certDraft.universityId.trim() || !certDraft.department.trim()}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold transition disabled:opacity-50">
                  {editCertSaving ? <i className="fas fa-spinner fa-spin"></i> : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
