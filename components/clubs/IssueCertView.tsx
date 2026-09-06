'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { parseClubRoles } from '@/lib/club-member-roles';
import QRCode from 'qrcode';
import { downloadCertPDF, generateBulkCertPDF, CertPDFData } from '@/lib/club-cert-pdf';
import { CertSignatory, CertTheme, DEFAULT_THEME, THEME_PRESETS } from '@/lib/cert-theme';
import { generateSignatureDataURL, signatureTextFor } from '@/lib/signature-gen';
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
  { name: '', designation: '', title: 'President', autoSignature: true },
  { name: '', designation: '', title: 'Chairman', autoSignature: true },
];

export default function IssueCertView({ params }: { params: Promise<{ slug: string }> }) {
  const profile = useAppStore(s => s.profile);
  const [slug, setSlug] = useState('');
  const [club, setClub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [rows, setRows] = useState<CertRow[]>([{ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' }]);
  const [signatories, setSignatories] = useState<CertSignatory[]>(defaultSignatories);
  const [themes, setThemes] = useState<CertTheme[]>(THEME_PRESETS);
  const [selectedTheme, setSelectedTheme] = useState<CertTheme>(DEFAULT_THEME);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<any[]>([]);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [expandedSig, setExpandedSig] = useState<number | null>(null);
  const [sigPreviews, setSigPreviews] = useState<Record<number, string>>({});
  const sigFileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    params.then(async p => {
      setSlug(p.slug);
      try {
        const [clubRes, themesRes] = await Promise.all([
          fetch(`/api/clubs/${p.slug}`),
          fetch('/api/clubs/themes'),
        ]);
        const clubData = await clubRes.json();
        const themesData = await themesRes.json();
        setClub(clubData.club);
        if (themesData.themes) setThemes(themesData.themes);

        if (clubData.club?.department) {
          setRows(prev => prev.map((r, idx) => idx === 0 && !r.department ? { ...r, department: clubData.club.department } : r));
        }

        try {
          const themeRes = await fetch(`/api/clubs/${p.slug}/theme`);
          const themeData = await themeRes.json();
          if (themeData.theme) setSelectedTheme(themeData.theme);
        } catch {}

        const myMember = clubData.club?.members?.find((m: any) => m.userId === profile.email);
        const isAdmin = profile.role === 'admin' || profile.role === 'manager';
        const isOfficer = !!myMember && ['gs', 'ags', 'ogs', 'office_secretary'].includes(myMember.role);
        const isClubAdmin = !!myMember?.isClubAdmin;
        const myClubRoles = parseClubRoles(myMember?.clubRoles);
        const canIssue = isAdmin || isOfficer || isClubAdmin || myClubRoles.includes('club_admin') || myClubRoles.includes('club_maintainer') || myClubRoles.includes('club_cert_issuer');
        if (!canIssue) setDenied(true);
      } catch {}
      setLoading(false);
    });
  }, [profile.email, profile.role]);

  function updateRow(i: number, field: keyof CertRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, { memberName: '', universityId: '', department: club?.department || '', session: '', post: '', eventName: '', servicePeriod: '' }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateSignatory(i: number, field: keyof CertSignatory, value: string) {
    setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  function addSignatory() {
    setSignatories(prev => [...prev, { name: '', designation: '', title: '', autoSignature: true }]);
  }

  function removeSignatory(i: number) {
    if (signatories.length <= 1) return;
    setSignatories(prev => prev.filter((_, idx) => idx !== i));
    setSigPreviews(prev => { const n = { ...prev }; delete n[i]; return n; });
  }

  function handleSigFileUpload(i: number, file: File) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, signatureUrl: dataUrl } : s));
      setSigPreviews(prev => ({ ...prev, [i]: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  function removeSignature(i: number) {
    setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, signatureUrl: undefined } : s));
    setSigPreviews(prev => { const n = { ...prev }; delete n[i]; return n; });
    if (sigFileRefs.current[i]) sigFileRefs.current[i]!.value = '';
  }

  const getSigPreview = useCallback(async (sig: CertSignatory, i: number) => {
    if (sig.signatureUrl) return sig.signatureUrl;
    if (sigPreviews[i]) return sigPreviews[i];
    if (sig.autoSignature !== false && sig.name) {
      const url = await generateSignatureDataURL(signatureTextFor(sig));
      return url;
    }
    return null;
  }, [sigPreviews]);

  async function handleIssue() {
    const valid = rows.filter(r => r.memberName.trim() && r.universityId.trim() && r.department.trim());
    if (valid.length === 0) return;
    setIssuing(true);
    try {
      const cleanedSigs = signatories.filter(s => s.name.trim());
      const res = await fetch(`/api/clubs/${slug}/certificates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        setRows([{ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' }]);
      } else {
        alert(data.error || 'Failed to issue');
      }
    } catch { alert('Network error'); }
    setIssuing(false);
  }

  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

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
      clubName: club?.name || slug,
      clubLogoUrl: club?.logoUrl || undefined,
      iiucLogoUrl: '/iiuc-logo.png',
      issuedBy: club?.name || slug,
      issuedAt: cert.issuedAt || new Date().toISOString(),
      signatories: signatories.filter(s => s.name.trim()),
      theme: selectedTheme,
    };
  }

  async function handleBulkDownload() {
    if (issued.length === 0) return;
    setGeneratingPdf(true);
    try {
      await generateBulkCertPDF(issued.map(toCertPDFData));
    } catch { alert('PDF generation failed'); }
    setGeneratingPdf(false);
  }

  if (loading) return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <i className="fas fa-spinner fa-spin text-qsis text-2xl"></i>
    </div>
  );

  if (denied) return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-lock text-red-400 text-2xl"></i>
        </div>
        <h2 className="text-lg font-bold text-dark-text mb-2">Access Denied</h2>
        <p className="text-sm text-dark-text2 mb-4">You don&apos;t have permission to issue certificates for this club. Only club admins, maintainers, certificate issuers, and GS/AGS officers can issue certificates.</p>
        <a href={`/clubs/${slug}`} className="text-qsis text-sm hover:underline"><i className="fas fa-arrow-left mr-1"></i>Back to {club?.name || 'Club'}</a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-dark-bg py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <a href={`/clubs/${slug}`} className="text-qsis text-xs hover:underline no-underline"><i className="fas fa-arrow-left mr-1"></i>Back to {club?.name || 'Club'}</a>
          <h1 className="text-xl font-bold text-dark-text mt-2 flex items-center gap-2">
            <i className="fas fa-certificate text-qsis"></i> Issue Certificates
          </h1>
          <p className="text-sm text-dark-text2 mt-1">Generate verifiable certificates with unique IDs and QR codes</p>
        </div>

        {!club?.logoUrl && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-4 flex items-start gap-3">
            <i className="fas fa-exclamation-triangle text-amber-400 mt-0.5"></i>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400">No club logo set</p>
              <p className="text-xs text-dark-text2 mt-0.5">Your certificates won't display the club logo. <a href={`/clubs/${slug}`} className="text-amber-400 font-semibold hover:underline no-underline">Upload your club logo</a> in the club settings first for a complete certificate.</p>
            </div>
          </div>
        )}

        {issued.length === 0 ? (
          <div className="space-y-4">
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
                    {theme.publishedBy && theme.publishedBy !== 'system' && (
                      <span className="text-[0.6rem] text-dark-text3">by {theme.publishedBy}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-dark-text"><i className="fas fa-signature text-qsis mr-2"></i>Signatories</h3>
                <button onClick={addSignatory} className="text-qsis text-xs font-semibold hover:underline"><i className="fas fa-plus mr-1"></i>Add</button>
              </div>
              <div className="space-y-3">
                {signatories.map((sig, i) => (
                  <div key={i} className="bg-dark-bg border border-dark-border rounded-xl p-3">
                    <div className="flex items-start gap-2">
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
                      </div>
                      <div className="flex items-center gap-1.5 mt-5">
                        <button onClick={() => setExpandedSig(expandedSig === i ? null : i)}
                          className="text-dark-text2 hover:text-qsis text-xs" title="Signature">
                          <i className="fas fa-pen-nib"></i>
                        </button>
                        {signatories.length > 1 && (
                          <button onClick={() => removeSignatory(i)} className="text-red-400 hover:text-red-300 text-xs"><i className="fas fa-trash"></i></button>
                        )}
                      </div>
                    </div>

                    {expandedSig === i && (
                      <div className="mt-3 pt-3 border-t border-dark-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[0.65rem] font-semibold text-dark-text">Signature</span>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <span className="text-[0.6rem] text-dark-text2">Auto-generate</span>
                            <input type="checkbox" checked={sig.autoSignature !== false}
                              onChange={e => {
                                setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, autoSignature: e.target.checked } : s));
                                if (e.target.checked) setSigPreviews(prev => { const n = { ...prev }; delete n[i]; return n; });
                              }}
                              className="w-3.5 h-3.5 rounded border-dark-border accent-qsis" />
                          </label>
                        </div>
                        <div className="mb-2">
                          <label className="text-[0.6rem] text-dark-text2 mb-1 block">
                            Signature text <span className="text-dark-text2/60">(used when auto-generating; leave empty to sign the first word of the name)</span>
                          </label>
                          <input type="text" value={sig.signatureText || ''} onChange={e => {
                            setSignatories(prev => prev.map((s, idx) => idx === i ? { ...s, signatureText: e.target.value } : s));
                            setSigPreviews(prev => { const n = { ...prev }; delete n[i]; return n; });
                          }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text text-xs outline-none focus:border-qsis"
                            placeholder="Full name or short label" />
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <input ref={el => { sigFileRefs.current[i] = el; }} type="file" accept="image/png,image/jpeg,image/svg+xml"
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleSigFileUpload(i, f); }}
                              className="w-full text-[0.6rem] text-dark-text2 file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[0.6rem] file:font-semibold file:bg-qsis/10 file:text-qsis hover:file:bg-qsis/20 file:cursor-pointer" />
                          </div>
                          {sig.signatureUrl && (
                            <button onClick={() => removeSignature(i)} className="text-red-400 hover:text-red-300 text-[0.6rem]"><i className="fas fa-times mr-0.5"></i>Remove</button>
                          )}
                        </div>
                        <SignaturePreview sig={sig} index={i} getSigPreview={getSigPreview} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

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
                        <label className="text-[0.68rem] text-dark-text2 mb-1 block">Post / Role *</label>
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
        ) : (
          <div>
            <div className="bg-green-500/5 border border-green-500/30 rounded-2xl p-5 mb-6 text-center">
              <i className="fas fa-check-circle text-green-400 text-3xl mb-2 block"></i>
              <h2 className="text-lg font-bold text-green-400">{issued.length} Certificate(s) Issued Successfully</h2>
              <p className="text-xs text-dark-text2 mt-1">Share these with your club members</p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <button onClick={handleBulkDownload} disabled={generatingPdf}
                  className="px-4 py-2 bg-qsis text-white rounded-lg text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
                  {generatingPdf ? <><i className="fas fa-spinner fa-spin mr-1"></i>Generating...</> : <><i className="fas fa-file-pdf mr-1"></i>Download All PDFs ({issued.length})</>}
                </button>
                <button onClick={() => setIssued([])} className="px-4 py-2 bg-dark-bg2 border border-dark-border rounded-lg text-sm font-semibold text-dark-text2 hover:border-qsis transition">
                  <i className="fas fa-plus mr-1"></i>Issue More
                </button>
              </div>
            </div>
            <div className="space-y-4">
              {issued.map(cert => (
                <div key={cert.id} className="bg-dark-bg2 border border-dark-border rounded-2xl p-5">
                  <div className="flex items-start gap-4">
                    {qrUrls[cert.certificateId] && (
                      <img src={qrUrls[cert.certificateId]} alt="QR" className="w-24 h-24 rounded-lg border border-dark-border" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <i className="fas fa-certificate text-qsis"></i>
                        <span className="font-mono text-sm font-bold text-dark-text">{cert.certificateId}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-dark-text2">Name:</span> <span className="text-dark-text font-semibold">{cert.memberName}</span></div>
                        <div><span className="text-dark-text2">UID:</span> <span className="text-dark-text">{cert.universityId}</span></div>
                        <div><span className="text-dark-text2">Dept:</span> <span className="text-dark-text">{cert.department}</span></div>
                        {cert.post && <div><span className="text-dark-text2">Post:</span> <span className="text-qsis">{cert.post}</span></div>}
                      </div>
                      <div className="mt-3 flex gap-2 flex-wrap">
                        <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-qsis/10 text-qsis border border-qsis/30 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition no-underline">
                          <i className="fas fa-external-link-alt mr-1"></i>Verify
                        </a>
                        <button onClick={() => downloadCertPDF(toCertPDFData(cert))}
                          className="px-3 py-1.5 bg-qsis/10 text-qsis border border-qsis/30 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                          <i className="fas fa-file-pdf mr-1"></i>PDF
                        </button>
                        <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-dark-bg3 text-dark-text border border-dark-border rounded-lg text-xs font-semibold hover:border-qsis transition no-underline">
                          <i className="fas fa-eye mr-1"></i>View
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SignaturePreview({ sig, index, getSigPreview }: { sig: CertSignatory; index: number; getSigPreview: (sig: CertSignatory, i: number) => Promise<string | null> }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSigPreview(sig, index).then(url => {
      if (!cancelled) { setPreviewUrl(url); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [sig.name, sig.signatureUrl, sig.autoSignature, index, getSigPreview]);

  if (sig.autoSignature === false && !sig.signatureUrl) return null;

  return (
    <div className="mt-2 p-2 bg-dark-bg2 rounded-lg border border-dark-border">
      <span className="text-[0.6rem] text-dark-text3 block mb-1">Preview</span>
      {loading ? (
        <div className="h-8 flex items-center"><i className="fas fa-spinner fa-spin text-dark-text3 text-xs"></i></div>
      ) : previewUrl ? (
        <img src={previewUrl} alt="Signature preview" className="h-8 object-contain" />
      ) : (
        <span className="text-[0.6rem] text-dark-text3 italic">No signature</span>
      )}
    </div>
  );
}
