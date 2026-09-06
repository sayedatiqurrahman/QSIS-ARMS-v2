'use client';

import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { useUserAccess } from '@/lib/useUserAccess';
import Link from 'next/link';
import { CLUB_ROLES, getRoleGroupMembers, getRoleLabel } from '@/lib/club-roles';
import type { ClubDataMember } from '@/lib/club-roles';
import { CLUB_MEMBER_ROLES, CLUB_MEMBER_ROLE_LIST, parseClubRoles } from '@/lib/club-member-roles';
import RoleCombobox from './RoleCombobox';
import BulkImportView from './BulkImportView';
import Modal from '@/components/ui/Modal';
import { downloadCertPDF, generateBulkCertPDF } from '@/lib/club-cert-pdf';
import type { CertPDFData } from '@/lib/club-cert-pdf';
import { normalizeUniversityId } from '@/lib/utils';
import { ClubDetailSkeleton } from '@/components/ui/Skeleton';
import AlumniTimeline from './AlumniTimeline';

const ROLE_BADGE: Record<string, string> = {
  advisor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  president: 'bg-red-500/15 text-red-400 border-red-500/30',
  vice_president: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  gs: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  ags: 'bg-qsis/15 text-qsis border-qsis/30',
  ogs: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  treasurer: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  finance: 'bg-green-500/15 text-green-400 border-green-500/30',
  it_media: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  cultural: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  publication: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  office_secretary: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  member: 'bg-dark-border/50 text-dark-text2 border-dark-border',
};

const CLAIM_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  approved: 'bg-green-500/15 text-green-400 border border-green-500/30',
  rejected: 'bg-red-500/15 text-red-400 border border-red-500/30',
};

type Section = 'posts' | 'about' | 'members' | 'events' | 'certificates' | 'claims' | 'settings' | 'timeline';
type ClaimFilter = 'pending' | 'approved' | 'rejected' | 'all';

const GROUP_ORDER = ['Executive', 'Finance', 'Operations', 'Members'];

function dn(m: ClubDataMember): string { return m.profileName || m.name || m.userId.split('@')[0]; }
function ui(m: ClubDataMember): string { return dn(m).substring(0, 2).toUpperCase(); }
function memberImage(m: ClubDataMember): string | null { return m.profileImage || null; }
function waLink(phone: string): string {
  let clean = phone.replace(/[^\d+]/g, '').trim();
  if (clean.startsWith('00')) clean = '+' + clean.slice(2);
  if (!clean.startsWith('+')) clean = '+' + clean;
  return `https://wa.me/${clean.slice(1)}`;
}
function tgLink(input: string): string {
  const clean = input.replace(/^@/, '').trim();
  if (/^\+?\d{7,15}$/.test(clean)) {
    const num = clean.startsWith('+') ? clean : `+${clean}`;
    return `https://t.me/${encodeURIComponent(num)}`;
  }
  return `https://t.me/${clean}`;
}
function timeAgo(d: string): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dy = Math.floor(h / 24);
  return dy < 30 ? `${dy}d ago` : `${Math.floor(dy / 30)}mo ago`;
}

export default function ClubDetailView({ params }: { params: Promise<{ slug: string }> }) {
  const profile = useAppStore(s => s.profile);
  const access = useUserAccess(profile.email || '', profile.role, profile.isCR, profile.customPermissions);
  const headerRef = useRef<HTMLDivElement>(null);
  const [stickyTab, setStickyTab] = useState(false);

  const [club, setClub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState('');
  const [section, setSection] = useState<Section>('certificates');
  const [claims, setClaims] = useState<any[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('pending');

  const [showAddMember, setShowAddMember] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<'email' | 'name'>('email');
  const [addName, setAddName] = useState('');
  const [addDept, setAddDept] = useState('');
  const [addSession, setAddSession] = useState('');
  const [addWhatsapp, setAddWhatsapp] = useState('');
  const [addEmailByName, setAddEmailByName] = useState('');

  const [showAddEvent, setShowAddEvent] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evVenue, setEvVenue] = useState('');
  const [addingEvent, setAddingEvent] = useState(false);

  const [certSearch, setCertSearch] = useState('');
  const [certResults, setCertResults] = useState<any[]>([]);
  const [editingCert, setEditingCert] = useState<any>(null);
  const [editCertSaving, setEditCertSaving] = useState(false);
  const [certDraft, setCertDraft] = useState({ memberName: '', universityId: '', department: '', session: '', post: '', eventName: '', servicePeriod: '' });

  const [logoUploading, setLogoUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editSession, setEditSession] = useState('');

  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimRole, setClaimRole] = useState('member');
  const [claimMsg, setClaimMsg] = useState('');
  const [submittingClaim, setSubmittingClaim] = useState(false);

  const [creatorProfile, setCreatorProfile] = useState<any>(null);
  const [showCreatorPopup, setShowCreatorPopup] = useState(false);
  const [showSelfRoles, setShowSelfRoles] = useState(false);
  const [savingSelfRoles, setSavingSelfRoles] = useState(false);
  const [editClubRoles, setEditClubRoles] = useState<string[]>([]);
  const [selfClubRoles, setSelfClubRoles] = useState<string[]>([]);
  const [customClubRoles, setCustomClubRoles] = useState<Array<{ key: string; label: string }>>([]);
  const [selfPositionRole, setSelfPositionRole] = useState('');
  const [memberView, setMemberView] = useState<'list' | 'grid'>('list');
  const [showBulkImport, setShowBulkImport] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (headerRef.current) {
        const bottom = headerRef.current.getBoundingClientRect().bottom;
        setStickyTab(bottom <= 52);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function loadClub(s: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/clubs/${s}`);
      const data = await res.json();
      setClub(data.club);
    } catch {}
    setLoading(false);
  }

  async function loadClaims(status: ClaimFilter = claimFilter) {
    if (!slug) return;
    setClaimsLoading(true);
    try {
      const res = await fetch(`/api/clubs/${slug}/claims?status=${status}`);
      const data = await res.json();
      setClaims(data.claims || []);
    } catch {}
    setClaimsLoading(false);
  }

  async function loadCustomRoles() {
    try {
      const res = await fetch('/api/clubs/roles');
      const data = await res.json();
      if (data.customRoles) setCustomClubRoles(data.customRoles);
    } catch {}
  }

  async function handleSaveCustomRole(key: string, label: string) {
    try {
      const res = await fetch('/api/clubs/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, label }),
      });
      const data = await res.json();
      if (data.customRoles) setCustomClubRoles(data.customRoles);
    } catch {}
  }

  useEffect(() => {
    params.then(p => { setSlug(p.slug); loadClub(p.slug); });
    loadCustomRoles();
  }, []);
  useEffect(() => {
    if (section === 'claims' && slug) loadClaims(claimFilter);
  }, [section, slug, claimFilter]);

  // Fetch creator profile for name/avatar
  useEffect(() => {
    if (club?.createdBy && !creatorProfile) {
      fetch(`/api/profile/${encodeURIComponent(club.createdBy)}`).then(r => r.json()).then(d => {
        if (d.profile) setCreatorProfile(d.profile);
      }).catch(() => {});
    }
  }, [club?.createdBy]);

  useEffect(() => {
    if ((section === 'certificates' || section === 'posts') && slug) handleCertSearch('');
  }, [section, slug]);

  const myMember: ClubDataMember | undefined = club?.members?.find((m: ClubDataMember) => m.userId === profile.email);
  const isOfficer = !!myMember && ['gs', 'ags', 'ogs', 'office_secretary'].includes(myMember.role);
  const isGS = myMember?.role === 'gs';
  const isClubAdmin = !!myMember?.isClubAdmin;
  const isAdmin = profile.role === 'admin' || profile.role === 'manager';
  const canManage = isAdmin || isOfficer || isClubAdmin;
  const isMember = !!myMember;
  const myClubRoles = parseClubRoles(myMember?.clubRoles);
  const canIssueCert = isAdmin || isOfficer || isClubAdmin || myClubRoles.includes('club_admin') || myClubRoles.includes('club_maintainer') || myClubRoles.includes('club_cert_issuer');
  const clubSettings = (() => { try { return JSON.parse(club?.settings || '{}'); } catch { return {}; } })();

  // Sync self clubRoles state when myMember changes
  useEffect(() => {
    if (myMember) {
      setSelfClubRoles(parseClubRoles(myMember.clubRoles));
      setSelfPositionRole(myMember.role || 'member');
    }
  }, [myMember?.clubRoles, myMember?.role]);

  async function handleAddMember() {
    if (addMode === 'email') {
      if (!addEmail.trim()) return;
      setAdding(true);
      try {
        const res = await fetch(`/api/clubs/${slug}/members`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: addEmail.trim(), role: addRole }),
        });
        const data = await res.json();
        if (data.success) { setShowAddMember(false); setAddEmail(''); setAddRole('member'); loadClub(slug); }
        else alert(data.error || 'Failed');
      } catch { alert('Network error'); }
      setAdding(false);
    } else {
      if (!addName.trim()) return;
      setAdding(true);
      try {
        const res = await fetch(`/api/clubs/${slug}/members`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: addRole,
            name: addName.trim(),
            email: addEmailByName.trim() || undefined,
            department: addDept.trim() || undefined,
            session: addSession.trim() || undefined,
            whatsapp: addWhatsapp.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (data.success) { setShowAddMember(false); setAddName(''); setAddEmailByName(''); setAddDept(''); setAddSession(''); setAddWhatsapp(''); setAddRole('member'); loadClub(slug); }
        else alert(data.error || 'Failed');
      } catch { alert('Network error'); }
      setAdding(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm('Remove this member?')) return;
    try {
      await fetch(`/api/clubs/${slug}/members`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      loadClub(slug);
    } catch {}
  }

  async function handleChangeRole() {
    if (!editingMember) return;
    try {
      const body: any = { userId: editingMember };
      if (editRole) { body.role = editRole; body.session = editSession.trim() || undefined; }
      body.clubRoles = editClubRoles;
      const res = await fetch(`/api/clubs/${slug}/members`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) { setEditingMember(null); setEditRole(''); setEditSession(''); setEditClubRoles([]); loadClub(slug); }
      else alert(data.error || 'Failed');
    } catch { alert('Network error'); }
  }

  async function handleSaveSelfRoles() {
    if (!myMember) return;
    setSavingSelfRoles(true);
    try {
      const res = await fetch(`/api/clubs/${slug}/members`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: myMember.userId, role: selfPositionRole, clubRoles: selfClubRoles }),
      });
      const data = await res.json();
      if (data.success) { setShowSelfRoles(false); loadClub(slug); }
      else alert(data.error || 'Failed');
    } catch { alert('Network error'); }
    setSavingSelfRoles(false);
  }

  function handleExportMembers() {
    try {
      const blob = new Blob([JSON.stringify(club.members || [], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${slug}-members.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch {}
  }

  async function handleAddEvent() {
    if (!evTitle.trim()) return;
    setAddingEvent(true);
    try {
      const res = await fetch(`/api/clubs/${slug}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: evTitle.trim(), description: evDesc.trim() || undefined, eventDate: evDate || undefined, venue: evVenue.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) { setShowAddEvent(false); setEvTitle(''); setEvDesc(''); setEvDate(''); setEvVenue(''); loadClub(slug); }
      else alert(data.error || 'Failed');
    } catch { alert('Network error'); }
    setAddingEvent(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { alert('Max 5MB'); return; }
    setLogoUploading(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((res, rej) => { reader.onload = () => res(reader.result as string); reader.onerror = rej; reader.readAsDataURL(file); });
      const r = await fetch(`/api/clubs/${slug}/logo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUri }) });
      const d = await r.json();
      if (d.success) setClub((p: any) => ({ ...p, logoUrl: d.logoUrl }));
      else alert(d.error || 'Failed');
    } catch { alert('Network error'); }
    setLogoUploading(false);
    e.target.value = '';
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) { alert('Max 10MB'); return; }
    setCoverUploading(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((res, rej) => { reader.onload = () => res(reader.result as string); reader.onerror = rej; reader.readAsDataURL(file); });
      const r = await fetch(`/api/clubs/${slug}/logo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUri, type: 'cover' }) });
      const d = await r.json();
      if (d.success) setClub((p: any) => ({ ...p, coverUrl: d.coverUrl || d.logoUrl }));
      else alert(d.error || 'Failed');
    } catch { alert('Network error'); }
    setCoverUploading(false);
    e.target.value = '';
  }

  async function handleCertSearch(query?: string) {
    const q = query !== undefined ? query : certSearch;
    try {
      const url = q ? `/api/clubs/${slug}/certificates?search=${encodeURIComponent(q)}` : `/api/clubs/${slug}/certificates`;
      const res = await fetch(url);
      const data = await res.json();
      setCertResults(data.certificates || []);
    } catch {}
  }

  async function handleBulkDownload() {
    if (certResults.length === 0) return;
    const certs: CertPDFData[] = certResults.map((c: any) => ({
      certificateId: c.certificateId, memberName: c.memberName, universityId: c.universityId,
      department: c.department, session: c.session || '', post: c.post || '',
      eventName: c.eventName || '', servicePeriod: c.servicePeriod || '',
      clubName: club?.name || slug, clubLogoUrl: club?.logoUrl, iiucLogoUrl: '/iiuc-logo.png',
      issuedBy: club?.name || slug, issuedAt: c.issuedAt || new Date().toISOString(),
      signatories: (() => { try { return JSON.parse(c.signatories || '[]'); } catch { return []; } })(),
      theme: undefined,
    }));
    try { await generateBulkCertPDF(certs); } catch { alert('PDF generation failed'); }
  }

  async function handleSyncGitHub() {
    try {
      const res = await fetch(`/api/clubs/${slug}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.synced) alert('Synced to GitHub.'); else alert(data.error || 'Sync failed');
    } catch { alert('Network error'); }
  }

  async function handleClaimReview(claimId: string, status: 'approved' | 'rejected') {
    try {
      const res = await fetch(`/api/clubs/${slug}/claims`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, action: status === 'approved' ? 'approve' : 'reject' }),
      });
      const data = await res.json();
      if (data.success) loadClaims(claimFilter); else alert(data.error || 'Failed');
    } catch { alert('Network error'); }
  }

  async function handleSubmitClaim() {
    if (!slug) return;
    setSubmittingClaim(true);
    try {
      const res = await fetch(`/api/clubs/${slug}/claims`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedRole: claimRole, message: claimMsg.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) { setShowClaimModal(false); setClaimMsg(''); setClaimRole('member'); alert('Request submitted!'); }
      else alert(data.error || 'Failed');
    } catch { alert('Network error'); }
    setSubmittingClaim(false);
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
      const res = await fetch(`/api/clubs/${slug}/certificates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificateId: editingCert.certificateId, data: certDraft }),
      });
      const data = await res.json();
      if (data.success) {
        setCertResults(prev => prev.map((c: any) => c.certificateId === editingCert.certificateId ? data.certificate : c));
        setEditingCert(null);
      } else {
        alert(data.error || 'Failed to update certificate');
      }
    } catch { alert('Network error'); }
    setEditCertSaving(false);
  }

  function toCertPDFData(cert: any): CertPDFData {
    return {
      certificateId: cert.certificateId, memberName: cert.memberName, universityId: cert.universityId,
      department: cert.department, session: cert.session || '', post: cert.post || '',
      eventName: cert.eventName || '', servicePeriod: cert.servicePeriod || '',
      clubName: club?.name || slug, clubLogoUrl: club?.logoUrl, iiucLogoUrl: '/iiuc-logo.png',
      issuedBy: club?.name || slug, issuedAt: cert.issuedAt || new Date().toISOString(),
      signatories: (() => { try { return JSON.parse(cert.signatories || '[]'); } catch { return []; } })(),
      theme: undefined,
    };
  }

  if (loading) return <ClubDetailSkeleton />;

  if (!club) return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-dark-bg3 flex items-center justify-center">
          <i className="fas fa-users text-dark-text2 text-3xl"></i>
        </div>
        <h2 className="text-dark-text text-lg font-bold mb-2">Club not found</h2>
        <p className="text-dark-text2 text-sm mb-4">This club page doesn&apos;t exist or hasn&apos;t been set up yet.</p>
        <Link href="/clubs" className="inline-flex items-center gap-2 px-4 py-2 bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold rounded-lg transition">
          <i className="fas fa-arrow-left"></i> Back to Clubs
        </Link>
      </div>
    </div>
  );

  const memberCount = club._count?.members ?? club.members?.length ?? 0;
  const eventCount = club._count?.events ?? club.events?.length ?? 0;
  const certCount = club._count?.certificates ?? 0;
  const pendingClaimCount = claims.filter(c => c.status === 'pending').length;
  const roleGroups = getRoleGroupMembers(club.members || []);
  const orderedGroups = [...GROUP_ORDER.filter(g => roleGroups[g]), ...Object.keys(roleGroups).filter(g => !GROUP_ORDER.includes(g))];
  const leadership = (club.members || []).filter((m: ClubDataMember) => m.role !== 'member');
  const recentMembers = (club.members || []).slice(0, 8);

  const navItems: { key: Section; label: string; icon: string; badge?: number }[] = [
    { key: 'certificates', label: 'Certificates', icon: 'fa-award', badge: certCount },
    { key: 'events', label: 'Events', icon: 'fa-calendar-days', badge: eventCount },
    { key: 'members', label: 'Members', icon: 'fa-user-group', badge: memberCount },
    { key: 'about', label: 'About', icon: 'fa-circle-info' },
    { key: 'timeline', label: 'Timeline', icon: 'fa-stream' },
    ...(canManage ? [{ key: 'claims' as Section, label: 'Claims', icon: 'fa-inbox', badge: pendingClaimCount }] : []),
    ...(isGS || isClubAdmin || isAdmin ? [{ key: 'settings' as Section, label: 'Settings', icon: 'fa-gear' }] : []),
  ];

  return (
    <div>
      {/* ══════════ COVER ══════════ */}
      <div ref={headerRef} className="relative">
        <div className="relative h-[200px] sm:h-[280px] md:h-[340px] lg:h-[380px]">
          {club.coverUrl ? (
            <img src={club.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-dark-bg2 via-dark-bg to-dark-bg3" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-dark-bg via-transparent to-transparent" />
          {canManage && (
            <label className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 bg-dark-bg3/80 hover:bg-dark-bg3/80 backdrop-blur-sm text-dark-text rounded-lg text-xs font-semibold cursor-pointer transition border border-white/10">
              <i className="fas fa-camera"></i>{coverUploading ? ' Uploading...' : 'Edit cover'}
              <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" disabled={coverUploading} />
            </label>
          )}
        </div>

        {/* ══════════ PROFILE HEADER ══════════ */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-8 sm:-mt-10 relative z-10">
            {/* Logo */}
            <div className="relative shrink-0 self-center sm:self-auto">
              {club.logoUrl ? (
                <div className="w-[120px] h-[120px] sm:w-[168px] sm:h-[168px] rounded-full bg-white border-4 border-dark-bg shadow-xl overflow-hidden flex items-center justify-center">
                  <img src={club.logoUrl} alt={club.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-[120px] h-[120px] sm:w-[168px] sm:h-[168px] rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center border-4 border-dark-bg shadow-xl">
                  <i className="fas fa-users text-dark-text text-4xl sm:text-5xl"></i>
                </div>
              )}
              {canManage && (
                <label className="absolute bottom-1 right-1 w-9 h-9 bg-dark-bg3 hover:bg-dark-bg3 rounded-full flex items-center justify-center cursor-pointer shadow-lg transition border border-white/10">
                  <i className="fas fa-camera text-dark-text text-sm"></i>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={logoUploading} />
                </label>
              )}
            </div>

            {/* Name & Info */}
            <div className="flex-1 min-w-0 pb-2 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-dark-text leading-tight">{club.name}</h1>
              <p className="text-sm text-dark-text2 mt-1">
                <i className="fas fa-building mr-1"></i>{club.department}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 mt-2 text-sm text-dark-text2">
                <span className="flex items-center gap-1">
                  <i className="fas fa-user-group text-qsis"></i>
                  <strong className="text-dark-text">{memberCount}</strong> members
                </span>
                <span className="flex items-center gap-1">
                  <i className="fas fa-calendar-days text-green-400"></i>
                  <strong className="text-dark-text">{eventCount}</strong> events
                </span>
                <span className="flex items-center gap-1">
                  <i className="fas fa-award text-yellow-400"></i>
                  <strong className="text-dark-text">{certCount}</strong> certificates
                </span>
              </div>
              <p className="text-xs text-dark-text2 mt-1">
                <i className="fas fa-clock mr-1"></i>Created {timeAgo(club.createdAt)} by{' '}
                <button onClick={() => setShowCreatorPopup(true)} className="text-qsis hover:underline font-semibold">
                  {creatorProfile?.name || club.createdBy?.split('@')[0]}
                </button>
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 shrink-0 pb-2">
              {!isMember && profile.email && (
                <button onClick={() => setShowClaimModal(true)} className="px-5 py-2.5 bg-qsis hover:bg-qsis/80 text-dark-text rounded-lg text-sm font-bold transition shadow-lg shadow-qsis/20">
                  <i className="fas fa-hand-sparkles mr-1.5"></i>Follow
                </button>
              )}
              {isMember && (
                <span className="px-4 py-2.5 bg-green-600/15 text-green-400 border border-green-500/30 rounded-lg text-sm font-bold">
                  <i className="fas fa-check-circle mr-1.5"></i>Following
                </span>
              )}
              {canIssueCert && (
                <Link href={`/clubs/${slug}/certificates/issue`} className="no-underline">
                  <button className="px-4 py-2.5 bg-dark-bg3 hover:bg-dark-bg3 text-dark-text border border-white/10 rounded-lg text-sm font-semibold transition">
                    <i className="fas fa-award mr-1.5"></i>Issue Cert
                  </button>
                </Link>
              )}
            </div>
          </div>

          {/* ══════════ TAB BAR ══════════ */}
          <div className={`mt-4 border-b border-dark-border transition-all ${stickyTab ? 'fixed top-0 left-0 right-0 z-50 bg-dark-bg2 shadow-xl shadow-black/30' : ''}`}>
            <div className="max-w-[1100px] mx-auto px-4 sm:px-6">
              <div className="flex gap-0 overflow-x-auto scrollbar-hide">
                {navItems.map(item => {
                  const active = section === item.key;
                  return (
                    <button key={item.key} onClick={() => setSection(item.key)}
                      className={`relative px-4 py-3.5 text-sm font-semibold transition whitespace-nowrap ${
                        active
                          ? 'text-qsis'
                          : 'text-dark-text2 hover:text-dark-text hover:bg-dark-bg3'
                      }`}>
                      <i className={`fas ${item.icon} mr-1.5`}></i>{item.label}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 text-[0.6rem] rounded-full bg-qsis/20 text-qsis font-bold">{item.badge}</span>
                      )}
                      {active && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-qsis rounded-t-full"></div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ MAIN CONTENT ══════════ */}
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-6 flex-col lg:flex-row">

          {/* ── LEFT SIDEBAR ── (desktop only) */}
          <div className="hidden lg:block lg:w-[360px] shrink-0 space-y-4">
            {/* About Card */}
            <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
              <div className="p-4">
                <h3 className="text-lg font-bold text-dark-text mb-3">About</h3>
                {club.description ? (
                  <p className="text-sm text-dark-text leading-relaxed">{club.description}</p>
                ) : (
                  <p className="text-sm text-dark-text2 italic">No description yet.</p>
                )}
              </div>
              <div className="border-t border-dark-border">
                <div className="px-4 py-3 flex items-center gap-3">
                  <i className="fas fa-building text-dark-text2 w-5 text-center"></i>
                  <div><p className="text-sm text-dark-text">{club.department}</p><p className="text-xs text-dark-text2">Department</p></div>
                </div>
                <div className="px-4 py-3 flex items-center gap-3">
                  <i className="fas fa-clock text-dark-text2 w-5 text-center"></i>
                  <div><p className="text-sm text-dark-text">Created {new Date(club.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p><p className="text-xs text-dark-text2">Club established</p></div>
                </div>
                <div className="px-4 py-3 flex items-center gap-3">
                  <i className="fas fa-user text-dark-text2 w-5 text-center"></i>
                  <div>
                    <button onClick={() => setShowCreatorPopup(true)} className="text-sm text-qsis hover:underline font-semibold text-left">
                      {creatorProfile?.name || club.createdBy?.split('@')[0]}
                    </button>
                    <p className="text-xs text-dark-text2">Created by</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Certificates Highlight */}
            <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-dark-text"><i className="fas fa-award text-yellow-400 mr-2"></i>Certificates</h3>
                  <span className="text-sm font-bold text-yellow-400">{certCount}</span>
                </div>
                {certCount > 0 ? (
                  <>
                    <p className="text-xs text-dark-text2 mb-3">Official certificates issued by {club.name}. Scan the QR code on any certificate to verify.</p>
                    <button onClick={() => setSection('certificates')} className="w-full px-3 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-lg text-xs font-semibold hover:bg-yellow-500/20 transition mb-2">
                      <i className="fas fa-award mr-1.5"></i>View All Certificates
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-dark-text2">No certificates issued yet.</p>
                )}
                {canIssueCert && (
                  <Link href={`/clubs/${slug}/certificates/issue`} className="no-underline block">
                    <button className="w-full px-3 py-2 bg-qsis/10 text-qsis border border-qsis/20 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                      <i className="fas fa-plus mr-1.5"></i>Issue Certificate
                    </button>
                  </Link>
                )}
              </div>
              <div className="border-t border-dark-border">
                <Link href="/verify" className="flex items-center gap-3 px-4 py-3 hover:bg-dark-bg3 transition no-underline">
                  <div className="w-9 h-9 rounded-lg bg-green-500/15 flex items-center justify-center">
                    <i className="fas fa-qrcode text-green-400"></i>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-dark-text">Verify Certificate</p>
                    <p className="text-xs text-dark-text2">Scan QR or enter ID</p>
                  </div>
                </Link>
              </div>
            </div>

            {/* Members Quick View */}
            {recentMembers.length > 0 && (
              <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-bold text-dark-text"><i className="fas fa-user-group text-qsis mr-2"></i>Members</h3>
                    <span className="text-sm font-bold text-qsis">{memberCount}</span>
                  </div>
                  {/* Avatar stack */}
                  <div className="flex -space-x-2 mb-3">
                    {recentMembers.slice(0, 10).map((m: ClubDataMember) => {
                      const img = memberImage(m);
                      return (
                        <div key={m.userId} className="w-9 h-9 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-[0.55rem] font-bold text-dark-text ring-2 ring-dark-bg2 overflow-hidden shrink-0" title={dn(m)}>
                          {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : ui(m)}
                        </div>
                      );
                    })}
                    {memberCount > 10 && (
                      <div className="w-9 h-9 rounded-full bg-dark-bg3 flex items-center justify-center text-[0.55rem] font-bold text-dark-text2 ring-2 ring-dark-bg2">
                        +{memberCount - 10}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setSection('members')} className="w-full px-3 py-2 bg-qsis/10 text-qsis border border-qsis/20 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                    <i className="fas fa-user-group mr-1.5"></i>View All Members
                  </button>
                </div>
              </div>
            )}

            {/* Photos placeholder */}
            {club.coverUrl && (
              <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4">
                <h3 className="text-base font-bold text-dark-text mb-3">Cover Photo</h3>
                <img src={club.coverUrl} alt="" className="w-full rounded-lg object-cover" />
              </div>
            )}

            {/* Leadership Quick View */}
            {leadership.length > 0 && (
              <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4">
                <h3 className="text-base font-bold text-dark-text mb-3">Leadership</h3>
                <div className="space-y-2.5">
                  {leadership.slice(0, 6).map((m: ClubDataMember) => {
                    const ri = CLUB_ROLES[m.role];
                    return (
                      <div key={m.userId} className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 ring-2 ring-dark-bg2 overflow-hidden">
                          {(() => { const img = memberImage(m); return img ? <img src={img} alt="" className="w-full h-full object-cover" /> : ui(m); })()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-dark-text truncate group-hover:text-qsis transition">{dn(m)}</p>
                          <span className={`inline-flex items-center gap-1 text-[0.65rem] px-2 py-0.5 rounded-full border font-semibold ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                            <i className={`fas ${ri?.icon || 'fa-user'}`}></i> {getRoleLabel(m.role, customClubRoles)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── MAIN FEED ── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* ═══ POSTS ═══ */}
            {section === 'posts' && (
              <div className="space-y-4">
                {/* Create Post Box */}
                {canManage && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 overflow-hidden">
                        {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-full h-full rounded-full object-cover bg-white" /> : <i className="fas fa-users"></i>}
                      </div>
                      <button onClick={() => setShowAddEvent(true)} className="flex-1 text-left px-4 py-2.5 bg-dark-bg3 hover:bg-dark-bg3 rounded-full text-sm text-dark-text2 transition">
                        Create an event...
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowAddEvent(true)} className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-dark-bg3 rounded-lg text-sm text-dark-text font-semibold transition">
                        <i className="fas fa-calendar-plus text-green-400"></i> Event
                      </button>
                      {canIssueCert && (
                        <Link href={`/clubs/${slug}/certificates/issue`} className="flex-1 no-underline">
                          <button className="w-full flex items-center justify-center gap-2 py-2 hover:bg-dark-bg3 rounded-lg text-sm text-dark-text font-semibold transition">
                            <i className="fas fa-award text-yellow-400"></i> Certificate
                          </button>
                        </Link>
                      )}
                    </div>
                  </div>
                )}

                {/* Certificates Highlight Card */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-yellow-500/15 flex items-center justify-center">
                        <i className="fas fa-award text-yellow-400 text-xl"></i>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-dark-text">{certCount} Certificates Issued</h3>
                        <p className="text-sm text-dark-text2">Verified credentials from {club.name}</p>
                      </div>
                    </div>
                    <p className="text-sm text-dark-text mb-4 leading-relaxed">
                      Every certificate issued by {club.name} contains a unique QR code. Anyone can scan it with their phone camera or any QR scanner to verify authenticity instantly.
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => setSection('certificates')} className="flex-1 px-4 py-2.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-lg text-sm font-semibold hover:bg-yellow-500/20 transition">
                        <i className="fas fa-award mr-1.5"></i>View Certificates
                      </button>
                      <Link href="/verify" className="flex-1 no-underline">
                        <button className="w-full px-4 py-2.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-sm font-semibold hover:bg-green-500/20 transition">
                          <i className="fas fa-qrcode mr-1.5"></i>Verify a Cert
                        </button>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Recent Certificates as Posts */}
                {certResults.length > 0 && certResults.slice(0, 3).map((cert: any) => (
                  <div key={cert.id || cert.certificateId} className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                    <div className="p-4 pb-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 overflow-hidden">
                            {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-full h-full rounded-full object-cover bg-white" /> : <i className="fas fa-users"></i>}
                          </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-dark-text">{club.name}</p>
                          <p className="text-xs text-dark-text2">Issued a certificate &middot; {timeAgo(cert.issuedAt)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="bg-dark-bg rounded-xl p-4 border border-yellow-500/10">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-yellow-500/15 flex items-center justify-center shrink-0">
                            <i className="fas fa-award text-yellow-400"></i>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-dark-text truncate">{cert.memberName}</p>
                            <p className="text-xs text-dark-text2 font-mono">{cert.certificateId}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {cert.post && <span className="px-2 py-1 bg-qsis/10 text-qsis rounded-md">{cert.post}</span>}
                          {cert.eventName && <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded-md">{cert.eventName}</span>}
                          {cert.servicePeriod && <span className="px-2 py-1 bg-dark-bg3/50 text-dark-text2 rounded-md">{cert.servicePeriod}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-dark-border px-4 py-2 flex items-center justify-between text-xs text-dark-text2">
                      <span><i className="fas fa-shield-check mr-1 text-green-400"></i>Verified by IIUC-ARMS</span>
                      <div className="flex gap-3">
                        <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer" className="hover:text-qsis transition font-semibold">View</a>
                        <button onClick={() => downloadCertPDF(toCertPDFData(cert))} className="hover:text-yellow-400 transition font-semibold">PDF</button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Events as Posts */}
                {(club.events || []).length === 0 && certResults.length === 0 ? (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-8 text-center">
                    <i className="fas fa-newspaper text-dark-text2 text-4xl mb-3 block"></i>
                    <p className="text-dark-text2 text-sm font-semibold">No posts yet</p>
                    <p className="text-dark-text2 text-xs mt-1">Certificates and events will appear here.</p>
                  </div>
                ) : (
                  club.events?.slice(0, 3).map((ev: any) => (
                    <div key={ev.id} className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                      <div className="p-4 pb-0">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 overflow-hidden">
                            {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-full h-full rounded-full object-cover bg-white" /> : <i className="fas fa-users"></i>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-dark-text">{club.name}</p>
                            <p className="text-xs text-dark-text2">Posted an event &middot; {timeAgo(ev.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="text-lg font-bold text-dark-text mb-2">{ev.title}</h3>
                        {ev.description && <p className="text-sm text-dark-text leading-relaxed mb-3">{ev.description}</p>}
                        <div className="flex flex-wrap gap-3">
                          {ev.eventDate && (
                            <div className="flex items-center gap-2 bg-dark-bg3 rounded-lg px-3 py-2">
                              <div className="text-center w-10">
                                <p className="text-lg font-bold text-dark-text leading-none">{new Date(ev.eventDate).getDate()}</p>
                                <p className="text-[0.6rem] text-dark-text2 uppercase">{new Date(ev.eventDate).toLocaleString('en', { month: 'short' })}</p>
                              </div>
                              <div className="border-l border-dark-border pl-2">
                                <p className="text-xs text-dark-text font-semibold">{new Date(ev.eventDate).toLocaleString('en', { weekday: 'short' })}</p>
                                <p className="text-xs text-dark-text2">{new Date(ev.eventDate).toLocaleString('en', { hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                            </div>
                          )}
                          {ev.venue && (
                            <div className="flex items-center gap-2 bg-dark-bg3 rounded-lg px-3 py-2">
                              <i className="fas fa-location-dot text-qsis"></i>
                              <span className="text-sm text-dark-text">{ev.venue}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="border-t border-dark-border px-4 py-2 flex items-center justify-between text-xs text-dark-text2">
                        <span><i className="fas fa-calendar-check mr-1 text-green-400"></i>{eventCount} total events</span>
                        <button onClick={() => setSection('events')} className="hover:text-qsis transition font-semibold">View all events</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ═══ ABOUT ═══ */}
            {section === 'about' && (
              <div className="space-y-4">
                {/* Description */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                  <h3 className="text-lg font-bold text-dark-text mb-3">About {club.name}</h3>
                  {club.description ? (
                    <p className="text-sm text-dark-text leading-relaxed">{club.description}</p>
                  ) : (
                    <p className="text-sm text-dark-text2 italic">No description provided. Club admins can add one in Settings.</p>
                  )}
                </div>

                {/* Overview */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                  <h3 className="text-base font-bold text-dark-text mb-4">Overview</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-dark-bg rounded-lg">
                      <p className="text-2xl font-bold text-qsis">{memberCount}</p>
                      <p className="text-xs text-dark-text2 mt-1">Members</p>
                    </div>
                    <div className="text-center p-3 bg-dark-bg rounded-lg">
                      <p className="text-2xl font-bold text-green-400">{eventCount}</p>
                      <p className="text-xs text-dark-text2 mt-1">Events</p>
                    </div>
                    <div className="text-center p-3 bg-dark-bg rounded-lg">
                      <p className="text-2xl font-bold text-yellow-400">{certCount}</p>
                      <p className="text-xs text-dark-text2 mt-1">Certificates</p>
                    </div>
                  </div>
                </div>

                {/* Info rows */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <i className="fas fa-building text-dark-text2 w-5 text-center"></i>
                    <div><p className="text-sm text-dark-text">{club.department}</p><p className="text-xs text-dark-text2">Department</p></div>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <i className="fas fa-clock text-dark-text2 w-5 text-center"></i>
                    <div><p className="text-sm text-dark-text">Created {new Date(club.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p><p className="text-xs text-dark-text2">Club established</p></div>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <i className="fas fa-user text-dark-text2 w-5 text-center"></i>
                    <div>
                      <button onClick={() => setShowCreatorPopup(true)} className="text-sm text-qsis hover:underline font-semibold text-left">
                        {creatorProfile?.name || club.createdBy?.split('@')[0]}
                      </button>
                      <p className="text-xs text-dark-text2">Created by</p>
                    </div>
                  </div>
                </div>

                {/* Certificates Quick */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-bold text-dark-text"><i className="fas fa-award text-yellow-400 mr-2"></i>Certificates</h3>
                      <span className="text-sm font-bold text-yellow-400">{certCount}</span>
                    </div>
                    {certCount > 0 ? (
                      <>
                        <p className="text-xs text-dark-text2 mb-3">Official certificates issued by {club.name}. Scan the QR code on any certificate to verify.</p>
                        <button onClick={() => setSection('certificates')} className="w-full px-3 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-lg text-xs font-semibold hover:bg-yellow-500/20 transition mb-2">
                          <i className="fas fa-award mr-1.5"></i>View All Certificates
                        </button>
                      </>
                    ) : (
                      <p className="text-xs text-dark-text2">No certificates issued yet.</p>
                    )}
                    {canIssueCert && (
                      <Link href={`/clubs/${slug}/certificates/issue`} className="no-underline block">
                        <button className="w-full px-3 py-2 bg-qsis/10 text-qsis border border-qsis/20 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                          <i className="fas fa-plus mr-1.5"></i>Issue Certificate
                        </button>
                      </Link>
                    )}
                  </div>
                  <div className="border-t border-dark-border">
                    <Link href="/verify" className="flex items-center gap-3 px-4 py-3 hover:bg-dark-bg3 transition no-underline">
                      <div className="w-9 h-9 rounded-lg bg-green-500/15 flex items-center justify-center">
                        <i className="fas fa-qrcode text-green-400"></i>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-dark-text">Verify Certificate</p>
                        <p className="text-xs text-dark-text2">Scan QR or enter ID</p>
                      </div>
                    </Link>
                  </div>
                </div>

                {/* Members Quick */}
                {recentMembers.length > 0 && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-base font-bold text-dark-text"><i className="fas fa-user-group text-qsis mr-2"></i>Members</h3>
                        <span className="text-sm font-bold text-qsis">{memberCount}</span>
                      </div>
                      <div className="flex -space-x-2 mb-3">
                        {recentMembers.slice(0, 10).map((m: ClubDataMember) => (
                          <div key={m.userId} className="w-9 h-9 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-[0.55rem] font-bold text-dark-text ring-2 ring-dark-bg2" title={dn(m)}>
                            {ui(m)}
                          </div>
                        ))}
                        {memberCount > 10 && (
                          <div className="w-9 h-9 rounded-full bg-dark-bg3 flex items-center justify-center text-[0.55rem] font-bold text-dark-text2 ring-2 ring-dark-bg2">
                            +{memberCount - 10}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setSection('members')} className="w-full px-3 py-2 bg-qsis/10 text-qsis border border-qsis/20 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                        <i className="fas fa-user-group mr-1.5"></i>View All Members
                      </button>
                    </div>
                  </div>
                )}

                {/* Cover Photo */}
                {club.coverUrl && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4">
                    <h3 className="text-base font-bold text-dark-text mb-3">Cover Photo</h3>
                    <img src={club.coverUrl} alt="" className="w-full rounded-lg object-cover" />
                  </div>
                )}

                {/* Leadership */}
                {leadership.length > 0 && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                    <h3 className="text-base font-bold text-dark-text mb-4">Key People</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {leadership.map((m: ClubDataMember) => {
                        const ri = CLUB_ROLES[m.role];
                        return (
                          <div key={m.userId} className="flex items-center gap-3 p-3 bg-dark-bg rounded-lg hover:bg-dark-bg3 transition">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-sm font-bold text-dark-text shrink-0">
                              {ui(m)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-dark-text truncate">{dn(m)}</p>
                              <span className={`inline-flex items-center gap-1 text-[0.65rem] px-2 py-0.5 rounded-full border font-semibold ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                                <i className={`fas ${ri?.icon || 'fa-user'}`}></i> {getRoleLabel(m.role, customClubRoles)}
                              </span>
                              {m.isClubAdmin && <span className="ml-1 text-[0.6rem] px-1.5 py-0.5 rounded bg-qsis/20 text-qsis font-bold">ADMIN</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ MEMBERS ═══ */}
            {section === 'members' && (
              <div>
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4 mb-4 flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-dark-text"><i className="fas fa-user-group text-qsis mr-2"></i>{memberCount} Members</h3>
                  <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex bg-dark-bg3 rounded-lg p-0.5">
                      <button onClick={() => setMemberView('list')} className={`px-2 py-1 rounded-md text-xs transition ${memberView === 'list' ? 'bg-qsis text-dark-text' : 'text-dark-text2 hover:text-dark-text'}`} title="List view">
                        <i className="fas fa-list"></i>
                      </button>
                      <button onClick={() => setMemberView('grid')} className={`px-2 py-1 rounded-md text-xs transition ${memberView === 'grid' ? 'bg-qsis text-dark-text' : 'text-dark-text2 hover:text-dark-text'}`} title="Grid view">
                        <i className="fas fa-grip"></i>
                      </button>
                    </div>
                    {canManage && (
                      <>
                        <button onClick={() => setShowAddMember(true)} className="px-3 py-1.5 bg-qsis/15 text-qsis border border-qsis/30 rounded-lg text-xs font-semibold hover:bg-qsis/20 transition">
                          <i className="fas fa-user-plus mr-1"></i>Add
                        </button>
                        <button onClick={() => setShowBulkImport(true)} className="px-3 py-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold hover:bg-emerald-500/25 transition">
                          <i className="fas fa-file-import mr-1"></i>Import
                        </button>
                        <button onClick={handleExportMembers} className="px-3 py-1.5 bg-dark-bg3 text-dark-text border border-dark-border rounded-lg text-xs font-semibold hover:bg-dark-bg3 transition">
                          <i className="fas fa-download mr-1"></i>Export
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {(club.members || []).length === 0 ? (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-12 text-center">
                    <i className="fas fa-user-group text-dark-text2 text-4xl mb-3 block"></i>
                    <p className="text-dark-text2 text-sm">No members yet</p>
                  </div>
                ) : (
                  orderedGroups.map(groupName => {
                    const members = roleGroups[groupName];
                    return (
                      <div key={groupName} className="mb-6">
                        <div className="flex items-center gap-2 mb-3">
                          <h4 className="text-base font-bold text-dark-text">{groupName}</h4>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-dark-bg3 text-dark-text2 font-semibold">{members.length}</span>
                          <div className="flex-1 h-px bg-dark-bg3"></div>
                        </div>
                        {memberView === 'grid' ? (
                          /* ═══ GRID VIEW ═══ */
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {members.map((m: ClubDataMember) => {
                              const ri = CLUB_ROLES[m.role];
                              const img = memberImage(m);
                              const pRoles = parseClubRoles(m.clubRoles);
                              return (
                                <div key={`${m.userId}-${m.role}`} className="bg-dark-bg2 border border-dark-border rounded-xl overflow-hidden hover:border-dark-border transition group">
                                  {/* Profile image */}
                                  <div className="w-full aspect-square bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-2xl font-bold text-dark-text relative overflow-hidden">
                                    {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : ui(m)}
                                    {m.isClubAdmin && <span className="absolute top-2 right-2 text-[0.5rem] px-1.5 py-0.5 rounded bg-qsis/90 text-dark-text font-bold">ADMIN</span>}
                                  </div>
                                  <div className="p-3">
                                    <p className="text-sm font-semibold text-dark-text truncate">{dn(m)}</p>
                                    {m.profileDepartment && <p className="text-[0.6rem] text-dark-text2 truncate">{m.profileDepartment}</p>}
                                    <span className={`inline-flex items-center gap-1 text-[0.6rem] px-2 py-0.5 rounded-full border font-semibold mt-1.5 ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                                      <i className={`fas ${ri?.icon || 'fa-user'}`}></i> {getRoleLabel(m.role, customClubRoles)}
                                    </span>
                                    {m.previousRole && (
                                      <p className="text-[0.55rem] text-dark-text2 mt-1">
                                        <i className="fas fa-clock-rotate-left mr-0.5"></i>Ex {getRoleLabel(m.previousRole, customClubRoles)}{m.previousRoleSession ? ` (${m.previousRoleSession})` : ''}
                                      </p>
                                    )}
                                    {pRoles.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5">
                                        {pRoles.slice(0, 2).map((rk: string) => {
                                          const r = CLUB_MEMBER_ROLES[rk];
                                          if (!r) return null;
                                          return <span key={rk} title={r.description} className={`inline-flex items-center gap-0.5 text-[0.5rem] px-1 py-0.5 rounded bg-dark-bg3 font-semibold ${r.color}`}><i className={`fas ${r.icon}`}></i> {r.label}</span>;
                                        })}
                                        {pRoles.length > 2 && <span className="text-[0.5rem] text-dark-text2">+{pRoles.length - 2}</span>}
                                      </div>
                                    )}
                                    {/* Contact row */}
                                    <div className="flex items-center gap-2 mt-2">
                                      {m.profileWhatsapp && (
                                        <a href={waLink(m.profileWhatsapp)} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 transition" title="WhatsApp">
                                          <i className="fab fa-whatsapp text-xs"></i>
                                        </a>
                                      )}
                                      {m.userId && (
                                        <a href={`mailto:${m.userId}`} className="text-dark-text2 hover:text-dark-text transition" title={m.userId}>
                                          <i className="fas fa-envelope text-xs"></i>
                                        </a>
                                      )}
                                    </div>
                                    {/* Actions */}
                                    {(canManage || m.userId === profile.email) && (
                                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-dark-border">
                                        {m.userId === profile.email && (
                                          <button onClick={() => setShowSelfRoles(true)} title="Edit my roles" className="text-green-400 hover:text-green-300 text-[0.65rem] px-1.5 py-0.5 rounded hover:bg-green-500/10 transition"><i className="fas fa-id-badge mr-0.5"></i>Edit</button>
                                        )}
                                        {canManage && m.userId !== profile.email && (
                                          <>
                                            <button onClick={() => { setEditingMember(m.userId); setEditRole(m.role); setEditSession(''); setEditClubRoles(parseClubRoles(m.clubRoles)); }} title="Change role" className="text-qsis hover:text-qsis text-[0.65rem] px-1.5 py-0.5 rounded hover:bg-qsis/10 transition"><i className="fas fa-pen mr-0.5"></i>Edit</button>
                                            <button onClick={() => handleRemoveMember(m.userId)} title="Remove" className="text-red-400 hover:text-red-300 text-[0.65rem] px-1.5 py-0.5 rounded hover:bg-red-500/10 transition ml-auto"><i className="fas fa-user-minus"></i></button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* ═══ LIST VIEW ═══ */
                          <div className="space-y-2">
                            {members.map((m: ClubDataMember) => {
                              const ri = CLUB_ROLES[m.role];
                              const img = memberImage(m);
                              const pRoles = parseClubRoles(m.clubRoles);
                              return (
                                <div key={`${m.userId}-${m.role}`} className="bg-dark-bg2 border border-dark-border rounded-xl p-3 flex items-center gap-3 hover:border-dark-border transition">
                                  {/* Avatar */}
                                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 overflow-hidden ring-2 ring-dark-bg2">
                                    {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : ui(m)}
                                  </div>
                                  {/* Info */}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="text-sm font-semibold text-dark-text truncate">{dn(m)}</p>
                                      {m.isClubAdmin && <span className="text-[0.55rem] px-1.5 py-0.5 rounded bg-qsis/20 text-qsis font-bold">ADMIN</span>}
                                      <span className={`inline-flex items-center gap-1 text-[0.65rem] px-2 py-0.5 rounded-full border font-semibold ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                                        <i className={`fas ${ri?.icon || 'fa-user'}`}></i> {getRoleLabel(m.role, customClubRoles)}
                                      </span>
                                      {m.previousRole && (
                                        <span className="text-[0.55rem] text-dark-text2">
                                          <i className="fas fa-clock-rotate-left mr-0.5"></i>Ex {getRoleLabel(m.previousRole, customClubRoles)}{m.previousRoleSession ? ` (${m.previousRoleSession})` : ''}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                      {m.profileDepartment && <span className="text-[0.6rem] text-dark-text2"><i className="fas fa-building mr-0.5"></i>{m.profileDepartment}</span>}
                                      {m.profileWhatsapp && (
                                        <a href={waLink(m.profileWhatsapp)} target="_blank" rel="noopener noreferrer" className="text-[0.6rem] text-emerald-400 hover:text-emerald-300 transition no-underline">
                                          <i className="fab fa-whatsapp mr-0.5"></i>{m.profileWhatsapp}
                                        </a>
                                      )}
                                      <a href={`mailto:${m.userId}`} className="text-[0.6rem] text-dark-text2 hover:text-dark-text transition no-underline">
                                        <i className="fas fa-envelope mr-0.5"></i>{m.userId}
                                      </a>
                                    </div>
                                    {pRoles.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {pRoles.map((rk: string) => {
                                          const r = CLUB_MEMBER_ROLES[rk];
                                          if (!r) return null;
                                          return <span key={rk} title={r.description} className={`inline-flex items-center gap-0.5 text-[0.55rem] px-1.5 py-0.5 rounded bg-dark-bg3 font-semibold ${r.color}`}><i className={`fas ${r.icon}`}></i> {r.label}</span>;
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  {/* Actions */}
                                  {(canManage || m.userId === profile.email) && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      {m.userId === profile.email && (
                                        <button onClick={() => setShowSelfRoles(true)} title="Edit my roles" className="text-green-400 hover:text-green-300 text-xs p-1.5 rounded-lg hover:bg-green-500/10 transition"><i className="fas fa-id-badge"></i></button>
                                      )}
                                      {canManage && m.userId !== profile.email && (
                                        <>
                                          <button onClick={() => { setEditingMember(m.userId); setEditRole(m.role); setEditSession(''); setEditClubRoles(parseClubRoles(m.clubRoles)); }} title="Change role" className="text-qsis hover:text-qsis text-xs p-1.5 rounded-lg hover:bg-qsis/10 transition"><i className="fas fa-pen"></i></button>
                                          <button onClick={() => handleRemoveMember(m.userId)} title="Remove" className="text-red-400 hover:text-red-300 text-xs p-1.5 rounded-lg hover:bg-red-500/10 transition"><i className="fas fa-user-minus"></i></button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ═══ EVENTS ═══ */}
            {section === 'events' && (
              <div>
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4 mb-4 flex items-center justify-between">
                  <h3 className="text-base font-bold text-dark-text"><i className="fas fa-calendar-days text-green-400 mr-2"></i>Events ({eventCount})</h3>
                  {canManage && (
                    <button onClick={() => setShowAddEvent(true)} className="px-3 py-1.5 bg-green-600/15 text-green-400 border border-green-500/30 rounded-lg text-xs font-semibold hover:bg-green-600/25 transition">
                      <i className="fas fa-plus mr-1"></i>New Event
                    </button>
                  )}
                </div>
                {(club.events || []).length === 0 ? (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-12 text-center">
                    <i className="fas fa-calendar-xmark text-dark-text2 text-4xl mb-3 block"></i>
                    <p className="text-dark-text2 text-sm">No events yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {club.events.map((ev: any) => (
                      <div key={ev.id} className="bg-dark-bg2 border border-dark-border rounded-xl overflow-hidden">
                        <div className="p-5">
                          <div className="flex items-start gap-4">
                            {ev.eventDate && (
                              <div className="text-center shrink-0 w-14 bg-qsis/15 rounded-xl p-2.5 border border-qsis/20">
                                <p className="text-2xl font-bold text-qsis leading-none">{new Date(ev.eventDate).getDate()}</p>
                                <p className="text-[0.6rem] text-qsis/70 uppercase mt-0.5">{new Date(ev.eventDate).toLocaleString('en', { month: 'short' })}</p>
                                <p className="text-[0.55rem] text-dark-text2">{new Date(ev.eventDate).toLocaleString('en', { year: 'numeric' })}</p>
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <h4 className="text-base font-bold text-dark-text">{ev.title}</h4>
                              {ev.venue && <p className="text-sm text-dark-text2 mt-1"><i className="fas fa-location-dot mr-1 text-qsis"></i>{ev.venue}</p>}
                              {ev.description && <p className="text-sm text-dark-text mt-2 leading-relaxed">{ev.description}</p>}
                              {ev.eventDate && (
                                <p className="text-xs text-dark-text2 mt-2">
                                  <i className="fas fa-clock mr-1"></i>
                                  {new Date(ev.eventDate).toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="border-t border-dark-border px-5 py-2 flex items-center gap-4 text-xs text-dark-text2">
                          <span>Posted {timeAgo(ev.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ═══ CERTIFICATES ═══ */}
            {section === 'certificates' && (
              <div>
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4 mb-4 flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-dark-text"><i className="fas fa-award text-yellow-400 mr-2"></i>Certificates ({certCount})</h3>
                  <div className="flex gap-2">
                    {canIssueCert && (
                      <Link href={`/clubs/${slug}/certificates/issue`} className="no-underline">
                        <button className="px-3 py-1.5 bg-yellow-600/15 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs font-semibold hover:bg-yellow-600/25 transition">
                          <i className="fas fa-plus mr-1"></i>Issue
                        </button>
                      </Link>
                    )}
                    <button onClick={handleBulkDownload} disabled={certResults.length === 0}
                      className="px-3 py-1.5 bg-dark-bg3 text-dark-text border border-dark-border rounded-lg text-xs font-semibold hover:bg-dark-bg3 transition disabled:opacity-40 disabled:pointer-events-none">
                      <i className="fas fa-file-pdf mr-1 text-red-400"></i>Download All ({certResults.length})
                    </button>
                  </div>
                </div>
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4 mb-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-dark-text2 text-sm"></i>
                      <input type="text" value={certSearch} onChange={e => setCertSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCertSearch()}
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                        placeholder="Search by name or ID..." />
                    </div>
                    <button onClick={() => handleCertSearch()} className="px-4 py-2.5 bg-qsis hover:bg-qsis/80 text-dark-text rounded-lg text-sm font-semibold transition">
                      <i className="fas fa-search"></i>
                    </button>
                  </div>
                </div>
                {certResults.length === 0 ? (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-12 text-center">
                    <i className="fas fa-award text-dark-text2 text-4xl mb-3 block"></i>
                    <p className="text-dark-text2 text-sm">{certSearch ? 'No certificates match your search' : 'No certificates issued yet'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {certResults.map((cert: any) => (
                      <div key={cert.id || cert.certificateId} className="bg-dark-bg2 border border-dark-border rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center">
                                <i className="fas fa-award text-yellow-400 text-sm"></i>
                              </div>
                              <div>
                                <p className="text-xs font-mono font-bold text-dark-text">{cert.certificateId}</p>
                                <p className="text-xs text-dark-text2">{cert.memberName}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] ml-10">
                              <span className="text-dark-text2">UID: <span className="text-dark-text">{cert.universityId}</span></span>
                              {cert.post && <span className="text-dark-text2">Post: <span className="text-qsis">{cert.post}</span></span>}
                              {cert.servicePeriod && <span className="text-dark-text2">Period: <span className="text-dark-text">{cert.servicePeriod}</span></span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                              className="w-8 h-8 flex items-center justify-center bg-qsis/15 text-qsis border border-qsis/30 rounded-lg hover:bg-qsis/20 transition no-underline">
                              <i className="fas fa-external-link-alt text-xs"></i>
                            </a>
                            <button onClick={() => downloadCertPDF(toCertPDFData(cert))}
                              className="w-8 h-8 flex items-center justify-center bg-red-600/15 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/25 transition">
                              <i className="fas fa-file-pdf text-xs"></i>
                            </button>
                            <a href={`/clubs/preview/${cert.certificateId}`} target="_blank" rel="noopener noreferrer"
                              className="w-8 h-8 flex items-center justify-center bg-dark-bg3 text-dark-text border border-dark-border rounded-lg hover:border-qsis transition no-underline"
                              title="View certificate design">
                              <i className="fas fa-eye text-xs"></i>
                            </a>
                            {canIssueCert && (
                              <button onClick={() => handleOpenEditCert(cert)}
                                className="w-8 h-8 flex items-center justify-center bg-blue-500/15 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/25 transition"
                                title="Edit certificate">
                                <i className="fas fa-edit text-xs"></i>
                              </button>
                            )}
                            {isAdmin && (
                              <button onClick={async () => {
                                if (!confirm(`Delete certificate ${cert.certificateId}?`)) return;
                                try {
                                  const res = await fetch(`/api/clubs/${slug}/certificates`, {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ certificateId: cert.certificateId }),
                                  });
                                  const data = await res.json();
                                  if (data.success) setCertResults(prev => prev.filter((c: any) => c.certificateId !== cert.certificateId));
                                  else alert(data.error || 'Failed to delete');
                                } catch { alert('Network error'); }
                              }}
                              className="w-8 h-8 flex items-center justify-center bg-red-600/10 text-red-400/60 border border-red-500/20 rounded-lg hover:bg-red-600/20 hover:text-red-400 transition"
                              title="Delete certificate (admin only)">
                                <i className="fas fa-trash text-xs"></i>
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

            {/* ═══ TIMELINE ═══ */}
            {section === 'timeline' && (
              <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4">
                <AlumniTimeline slug={slug} />
              </div>
            )}

            {/* ═══ CLAIMS ═══ */}
            {section === 'claims' && canManage && (
              <div>
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-4 mb-4">
                  <h3 className="text-base font-bold text-dark-text"><i className="fas fa-inbox text-purple-400 mr-2"></i>Membership Claims</h3>
                </div>
                <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
                  {(['pending', 'approved', 'rejected', 'all'] as ClaimFilter[]).map(f => (
                    <button key={f} onClick={() => setClaimFilter(f)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                        claimFilter === f ? 'bg-qsis text-dark-text' : 'bg-dark-bg2 text-dark-text2 border border-dark-border hover:border-qsis/50'
                      }`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                {claimsLoading ? (
                  <div className="flex items-center justify-center py-12"><i className="fas fa-spinner fa-spin text-qsis text-2xl"></i></div>
                ) : claims.length === 0 ? (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-12 text-center">
                    <i className="fas fa-inbox text-dark-text2 text-4xl mb-3 block"></i>
                    <p className="text-dark-text2 text-sm">No {claimFilter === 'all' ? '' : claimFilter} claims</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {claims.map((cl: any) => {
                      const clName = cl.profileName || cl.userId?.split('@')[0] || 'Unknown';
                      const clImage = cl.profileImage;
                      const isStub = cl.userId?.startsWith('stub.');
                      return (
                        <div key={cl.id} className="bg-dark-bg2 border border-dark-border rounded-xl p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-xs font-bold text-dark-text shrink-0 overflow-hidden">
                                {clImage ? <img src={clImage} alt="" className="w-full h-full object-cover" /> : clName.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-dark-text">{clName}</p>
                                  {isStub && <span className="text-[0.55rem] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold">STUB</span>}
                                </div>
                                <p className="text-[0.65rem] text-dark-text2">{cl.userId}</p>
                                {cl.profileDepartment && <p className="text-[0.6rem] text-dark-text2"><i className="fas fa-building mr-0.5"></i>{cl.profileDepartment}</p>}
                                <span className={`inline-flex text-[0.65rem] px-2 py-0.5 rounded-full font-semibold mt-1 ${CLAIM_STATUS_BADGE[cl.status] || ''}`}>{cl.status}</span>
                                <p className="text-sm text-dark-text mt-1">Wants: <span className="text-qsis font-semibold">{CLUB_ROLES[cl.requestedRole]?.label || cl.requestedRole}</span></p>
                                {cl.message && <p className="text-sm text-dark-text2 mt-1 italic">&ldquo;{cl.message}&rdquo;</p>}
                              </div>
                            </div>
                            {cl.status === 'pending' && (
                              <div className="flex gap-2 shrink-0">
                                <button onClick={() => handleClaimReview(cl.id, 'approved')} className="px-3 py-1.5 bg-green-600/15 text-green-400 border border-green-500/30 rounded-lg text-xs font-semibold hover:bg-green-600/25 transition"><i className="fas fa-check mr-1"></i>Approve</button>
                                <button onClick={() => handleClaimReview(cl.id, 'rejected')} className="px-3 py-1.5 bg-red-600/15 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold hover:bg-red-600/25 transition"><i className="fas fa-times mr-1"></i>Reject</button>
                              </div>
                            )}
                          </div>
                          {isStub && cl.status === 'pending' && (
                            <div className="mt-3 pt-3 border-t border-dark-border">
                              <p className="text-[0.65rem] text-amber-400"><i className="fas fa-exclamation-triangle mr-1"></i>This is a stub profile (added by admin, not a registered user). Verify identity before approving.</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══ SETTINGS ═══ */}
            {section === 'settings' && (isGS || isClubAdmin || isAdmin) && (
              <div className="space-y-4">
                {/* Logo & Cover */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                  <h3 className="text-base font-bold text-dark-text mb-4"><i className="fas fa-images text-qsis mr-2"></i>Appearance</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-dark-text2 font-semibold mb-2">Club Logo</p>
                      <div className="flex items-center gap-3">
                        {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-dark-border bg-white" /> : <div className="w-16 h-16 rounded-full bg-qsis/20 flex items-center justify-center"><i className="fas fa-users text-qsis"></i></div>}
                        <label className="px-3 py-1.5 bg-dark-bg3 hover:bg-dark-bg3 text-dark-text rounded-lg text-xs font-semibold cursor-pointer transition border border-dark-border">
                          {logoUploading ? <><i className="fas fa-spinner fa-spin mr-1"></i>Uploading...</> : <><i className="fas fa-upload mr-1"></i>Upload Logo</>}
                          <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={logoUploading} />
                        </label>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-dark-text2 font-semibold mb-2">Cover Photo</p>
                      <div className="flex items-center gap-3">
                        {club.coverUrl ? <img src={club.coverUrl} alt="" className="w-16 h-10 rounded-lg object-cover border border-dark-border" /> : <div className="w-16 h-10 rounded-lg bg-dark-bg3 flex items-center justify-center"><i className="fas fa-image text-dark-text2 text-xs"></i></div>}
                        <label className="px-3 py-1.5 bg-dark-bg3 hover:bg-dark-bg3 text-dark-text rounded-lg text-xs font-semibold cursor-pointer transition border border-dark-border">
                          {coverUploading ? <><i className="fas fa-spinner fa-spin mr-1"></i>Uploading...</> : <><i className="fas fa-upload mr-1"></i>Upload Cover</>}
                          <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" disabled={coverUploading} />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Basic Info */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                  <h3 className="text-base font-bold text-dark-text mb-4"><i className="fas fa-circle-info text-qsis mr-2"></i>Club Info</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center py-2 border-b border-dark-border"><span className="text-dark-text2 font-semibold">Name</span><span className="text-dark-text">{club.name}</span></div>
                    <div className="flex justify-between items-center py-2 border-b border-dark-border"><span className="text-dark-text2 font-semibold">Department</span><span className="text-dark-text">{club.department}</span></div>
                    <div className="flex justify-between items-start py-2 border-b border-dark-border"><span className="text-dark-text2 font-semibold">Description</span><span className="text-dark-text text-right max-w-[60%]">{club.description || '—'}</span></div>
                    <div className="flex justify-between items-center py-2"><span className="text-dark-text2 font-semibold">Created By</span><button onClick={() => setShowCreatorPopup(true)} className="text-qsis hover:underline">{creatorProfile?.name || club.createdBy}</button></div>
                  </div>
                </div>

                {/* Access Control */}
                {(isGS || isClubAdmin) && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                    <h3 className="text-base font-bold text-dark-text mb-1"><i className="fas fa-shield-halved text-qsis mr-2"></i>Access Control</h3>
                    <p className="text-xs text-dark-text2 mb-4">Control what managers (non-club members) can do in your club.</p>
                    <div className="space-y-4">
                      {[
                        { key: 'managerCanManageMembers', label: 'Allow managers to manage members', default: true },
                        { key: 'managerCanIssueCerts', label: 'Allow managers to issue certificates', default: true },
                        { key: 'managerCanManageEvents', label: 'Allow managers to manage events', default: true },
                      ].map(item => (
                        <label key={item.key} className="flex items-center justify-between cursor-pointer py-2">
                          <span className="text-sm text-dark-text">{item.label}</span>
                          <div className="relative">
                            <input type="checkbox" checked={clubSettings[item.key] !== undefined ? clubSettings[item.key] : item.default}
                              onChange={async (e) => {
                                const newSettings = { ...clubSettings, [item.key]: e.target.checked };
                                try {
                                  await fetch(`/api/clubs/${slug}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: JSON.stringify(newSettings) }) });
                                  setClub((p: any) => ({ ...p, settings: JSON.stringify(newSettings) }));
                                } catch {}
                              }}
                              className="sr-only peer" />
                            <div className="w-10 h-6 bg-dark-bg3 rounded-full peer peer-checked:bg-qsis transition"></div>
                            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition peer-checked:translate-x-4"></div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Club Admins */}
                {(isGS || isClubAdmin) && (
                  <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                    <h3 className="text-base font-bold text-dark-text mb-1"><i className="fas fa-user-shield text-qsis mr-2"></i>Club Admins</h3>
                    <p className="text-xs text-dark-text2 mb-3">Club admins have full control over the club.</p>
                    <div className="space-y-2">
                      {club.members?.filter((m: ClubDataMember) => m.isClubAdmin).map((m: ClubDataMember) => (
                        <div key={m.userId} className="flex items-center gap-3 bg-dark-bg border border-dark-border rounded-lg p-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-[0.65rem] font-bold text-dark-text">{ui(m)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-dark-text truncate">{dn(m)}</p>
                            <p className="text-xs text-dark-text2">{m.userId}</p>
                          </div>
                          <span className="text-[0.6rem] px-2 py-0.5 rounded bg-qsis/20 text-qsis font-bold">ADMIN</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* GitHub Sync */}
                <div className="bg-dark-bg2 rounded-xl border border-dark-border p-5">
                  <h3 className="text-base font-bold text-dark-text mb-1"><i className="fab fa-github text-dark-text mr-2"></i>GitHub Backup</h3>
                  <p className="text-xs text-dark-text2 mb-3">Sync club data to GitHub as JSON.</p>
                  {isAdmin ? (
                    <button onClick={handleSyncGitHub} className="px-4 py-2 bg-dark-bg3 hover:bg-dark-bg3 text-dark-text border border-dark-border rounded-lg text-sm font-semibold transition">
                      <i className="fas fa-rotate mr-1.5"></i>Sync to GitHub
                    </button>
                  ) : (
                    <p className="text-xs text-dark-text2"><i className="fas fa-lock mr-1"></i>Admin only.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════ MODALS ══════════ */}

      {/* ── Add Member ── */}
      <Modal isOpen={showAddMember} onClose={() => setShowAddMember(false)} title="Add Member">
        <div className="space-y-3 px-4 pb-4">
          {isAdmin && (
            <div className="flex bg-dark-bg3 rounded-lg p-0.5 mb-1">
              <button onClick={() => setAddMode('email')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${addMode === 'email' ? 'bg-qsis text-dark-text' : 'text-dark-text2 hover:text-dark-text'}`}>
                <i className="fas fa-envelope mr-1"></i>By Email
              </button>
              <button onClick={() => setAddMode('name')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${addMode === 'name' ? 'bg-qsis text-dark-text' : 'text-dark-text2 hover:text-dark-text'}`}>
                <i className="fas fa-user mr-1"></i>By Name
              </button>
            </div>
          )}
          {addMode === 'email' ? (
            <>
              <div>
                <label className="text-sm text-dark-text2 font-semibold mb-1 block">Email *</label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                  placeholder="student@ugrad.iiuc.ac.bd" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm text-dark-text2 font-semibold mb-1 block">Full Name *</label>
                <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                  placeholder="e.g. Ahmed Hassan" />
              </div>
              <div>
                <label className="text-sm text-dark-text2 font-semibold mb-1 block">Email (auto-links profile if exists)</label>
                <input type="email" value={addEmailByName} onChange={e => setAddEmailByName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                  placeholder="student@ugrad.iiuc.ac.bd" />
                <p className="text-[0.6rem] text-dark-text2/60 mt-1">If this email has an account, their profile info will connect automatically.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-dark-text2 font-semibold mb-1 block">Department</label>
                  <input type="text" value={addDept} onChange={e => setAddDept(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                    placeholder="e.g. CSE" />
                </div>
                <div>
                  <label className="text-sm text-dark-text2 font-semibold mb-1 block">Session</label>
                  <input type="text" value={addSession} onChange={e => setAddSession(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                    placeholder="e.g. 2021" />
                </div>
              </div>
              <div>
                <label className="text-sm text-dark-text2 font-semibold mb-1 block">WhatsApp (optional)</label>
                <input type="tel" value={addWhatsapp} onChange={e => setAddWhatsapp(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
                  placeholder="+880 1XXXXXXXXX" />
              </div>
            </>
          )}
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Role</label>
            <RoleCombobox value={addRole} onChange={setAddRole} customRoles={customClubRoles} onSaveCustom={handleSaveCustomRole} />
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setShowAddMember(false)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleAddMember} disabled={adding || (addMode === 'email' ? !addEmail.trim() : !addName.trim())} className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold disabled:opacity-50 transition">
              {adding ? <i className="fas fa-spinner fa-spin"></i> : 'Add Member'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Member ── */}
      <Modal isOpen={!!editingMember} onClose={() => setEditingMember(null)} title="Edit Member Roles">
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-dark-text2 -mt-1">Position role and permission roles for this member.</p>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Position Role</label>
            <RoleCombobox value={editRole} onChange={setEditRole} customRoles={customClubRoles} onSaveCustom={handleSaveCustomRole} />
          </div>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Session (for Ex-badge)</label>
            <input type="text" value={editSession} onChange={e => setEditSession(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition"
              placeholder="e.g. Autumn 2023 (optional)" />
          </div>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-2 block">Permission Roles</label>
            <div className="space-y-2">
              {CLUB_MEMBER_ROLE_LIST.map(r => (
                <label key={r.key} className="flex items-center gap-3 p-2.5 rounded-lg bg-dark-bg border border-dark-border hover:border-qsis/30 cursor-pointer transition">
                  <input type="checkbox" checked={editClubRoles.includes(r.key)}
                    onChange={e => {
                      const next = e.target.checked ? [...editClubRoles, r.key] : editClubRoles.filter(k => k !== r.key);
                      setEditClubRoles(next);
                    }}
                    className="accent-qsis w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <i className={`${r.icon} ${r.color} text-sm`}></i>
                      <span className="text-sm font-semibold text-dark-text">{r.label}</span>
                    </div>
                    <p className="text-[0.7rem] text-dark-text2">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setEditingMember(null)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleChangeRole} className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold transition">Update</button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Certificate ── */}
      <Modal isOpen={!!editingCert} onClose={() => setEditingCert(null)} title={`Edit Certificate ${editingCert?.certificateId || ''}`}>
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-dark-text2 -mt-1">Update the recipient details for this certificate. The certificate ID and issue date stay unchanged.</p>
          {([['memberName', 'Member Name', true], ['universityId', 'University ID', true], ['department', 'Department', true], ['session', 'Session'], ['post', 'Post'], ['eventName', 'Event Name'], ['servicePeriod', 'Service Period']] as const).map(([key, label, required]) => (
            <div key={key}>
              <label className="text-sm text-dark-text2 font-semibold mb-1 block">{label}{required && <span className="text-red-400"> *</span>}</label>
              <input type="text" value={certDraft[key]} onChange={e => {
                const v = e.target.value;
                setCertDraft(d => ({ ...d, [key]: v }));
              }} onBlur={e => {
                if (key === 'universityId') setCertDraft(d => ({ ...d, universityId: normalizeUniversityId(e.target.value) }));
              }}
                className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition" />
            </div>
          ))}
          <div className="flex gap-3 mt-2">
            <button onClick={() => setEditingCert(null)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleSaveEditCert} disabled={editCertSaving || !certDraft.memberName.trim() || !certDraft.universityId.trim() || !certDraft.department.trim()}
              className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold transition disabled:opacity-50">
              {editCertSaving ? <i className="fas fa-spinner fa-spin"></i> : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add Event ── */}
      <Modal isOpen={showAddEvent} onClose={() => setShowAddEvent(false)} title="Create Event">
        <div className="space-y-3 px-4 pb-4">
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Title *</label>
            <input type="text" value={evTitle} onChange={e => setEvTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition" placeholder="Event title" />
          </div>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Description</label>
            <textarea value={evDesc} onChange={e => setEvDesc(e.target.value)} rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition resize-none" placeholder="Event details..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-dark-text2 font-semibold mb-1 block">Date & Time</label>
              <input type="datetime-local" value={evDate} onChange={e => setEvDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition" />
            </div>
            <div>
              <label className="text-sm text-dark-text2 font-semibold mb-1 block">Venue</label>
              <input type="text" value={evVenue} onChange={e => setEvVenue(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition" placeholder="Room / Hall" />
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setShowAddEvent(false)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleAddEvent} disabled={!evTitle.trim() || addingEvent} className="flex-1 px-3 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-dark-text text-sm font-semibold disabled:opacity-50 transition">
              {addingEvent ? <i className="fas fa-spinner fa-spin"></i> : 'Create Event'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Claim Modal ── */}
      <Modal isOpen={showClaimModal} onClose={() => setShowClaimModal(false)} title={`Follow ${club?.name || ''}`}>
        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm text-dark-text2 -mt-1">Request membership &mdash; an officer will review.</p>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Requested Role</label>
            <RoleCombobox value={claimRole} onChange={setClaimRole} customRoles={customClubRoles} onSaveCustom={handleSaveCustomRole} />
          </div>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Message (optional)</label>
            <textarea value={claimMsg} onChange={e => setClaimMsg(e.target.value)} rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-sm outline-none focus:border-qsis transition resize-none"
              placeholder="Why do you want to join?" />
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setShowClaimModal(false)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleSubmitClaim} disabled={submittingClaim} className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold disabled:opacity-50 transition">
              {submittingClaim ? <i className="fas fa-spinner fa-spin"></i> : 'Send Request'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Creator Profile ── */}
      <Modal isOpen={showCreatorPopup} onClose={() => setShowCreatorPopup(false)} maxWidth="max-w-sm">
        <div className="flex flex-col items-center text-center px-4 pb-4 pt-2">
          {creatorProfile?.image ? (
            <img src={creatorProfile.image} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-dark-border mb-3" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-qsis/60 to-qsis flex items-center justify-center text-2xl font-bold text-dark-text mb-3">
              {(creatorProfile?.name || club?.createdBy)?.charAt(0)?.toUpperCase()}
            </div>
          )}
          <h3 className="text-lg font-bold text-dark-text">{creatorProfile?.name || club?.createdBy}</h3>
          {creatorProfile?.title && <p className="text-sm text-dark-text2">{creatorProfile.title}</p>}
          <div className="mt-3 space-y-2 w-full text-sm">
            <div className="flex items-center gap-2 text-dark-text">
              <i className="fas fa-envelope text-dark-text2 w-5 text-center"></i>
              <span>{club?.createdBy}</span>
            </div>
            {creatorProfile?.department && (
              <div className="flex items-center gap-2 text-dark-text">
                <i className="fas fa-building text-dark-text2 w-5 text-center"></i>
                <span>{creatorProfile.department}</span>
              </div>
            )}
            {creatorProfile?.whatsapp && (
              <div className="flex items-center gap-2 text-dark-text">
                <i className="fab fa-whatsapp text-green-400 w-5 text-center"></i>
                <a href={`https://wa.me/${creatorProfile.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="hover:text-green-400 transition">{creatorProfile.whatsapp}</a>
              </div>
            )}
          </div>
          <button onClick={() => setShowCreatorPopup(false)} className="w-full mt-4 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Close</button>
        </div>
      </Modal>

      {/* ── Self Roles ── */}
      <Modal isOpen={showSelfRoles} onClose={() => setShowSelfRoles(false)} title="My Roles">
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-dark-text2 -mt-1">Change your position role and permission roles in this club.</p>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-1 block">Position Role</label>
            <RoleCombobox value={selfPositionRole} onChange={setSelfPositionRole} customRoles={customClubRoles} onSaveCustom={handleSaveCustomRole} />
          </div>
          <div>
            <label className="text-sm text-dark-text2 font-semibold mb-2 block">Permission Roles</label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {CLUB_MEMBER_ROLE_LIST.map(r => (
                <label key={r.key} className="flex items-center gap-3 p-3 rounded-lg bg-dark-bg border border-dark-border hover:border-qsis/30 cursor-pointer transition">
                  <input type="checkbox" checked={selfClubRoles.includes(r.key)}
                    onChange={e => {
                      const next = e.target.checked ? [...selfClubRoles, r.key] : selfClubRoles.filter(k => k !== r.key);
                      setSelfClubRoles(next);
                    }}
                    className="accent-qsis w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <i className={`${r.icon} ${r.color} text-sm`}></i>
                      <span className="text-sm font-semibold text-dark-text">{r.label}</span>
                    </div>
                    <p className="text-[0.7rem] text-dark-text2 mt-0.5">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setShowSelfRoles(false)} className="flex-1 px-3 py-2.5 rounded-lg border border-dark-border text-dark-text2 text-sm font-semibold hover:bg-dark-bg3 transition">Cancel</button>
            <button onClick={handleSaveSelfRoles} disabled={savingSelfRoles} className="flex-1 px-3 py-2.5 rounded-lg bg-qsis hover:bg-qsis/80 text-dark-text text-sm font-semibold disabled:opacity-50 transition">
              {savingSelfRoles ? <i className="fas fa-spinner fa-spin"></i> : 'Save Roles'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Bulk Import ── */}
      <Modal isOpen={showBulkImport} onClose={() => { setShowBulkImport(false); loadClub(slug); }} title="Bulk Import Members" maxWidth="max-w-2xl">
        <div className="px-4 pb-4">
          <BulkImportView
            clubSlug={slug}
            customClubRoles={customClubRoles}
            onSaveCustomRole={handleSaveCustomRole}
            onClose={() => { setShowBulkImport(false); loadClub(slug); }}
          />
        </div>
      </Modal>
    </div>
  );
}
