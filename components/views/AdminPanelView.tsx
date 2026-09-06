'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { config } from '@/lib/config';
import { showToast } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useConfirm } from '@/components/ConfirmModal';
import FacultyDeptTab from '@/components/faculty/FacultyDeptTab';
import { type UserRecord, type ActivityLog, type AdminStats, type Tab, type UserSubTab } from '@/components/admin/types';
import ContributorsTab from '@/components/admin/ContributorsTab';
import RoomsTab from '@/components/admin/RoomsTab';
import BatchesTab from '@/components/admin/BatchesTab';
import PermissionsTab from '@/components/admin/PermissionsTab';
import RolesTab from '@/components/admin/RolesTab';
import CoursesTab from '@/components/admin/CoursesTab';
import TelegramTab from '@/components/admin/TelegramTab';
import OverviewTab from '@/components/admin/OverviewTab';
import UsersTab from '@/components/admin/UsersTab';
import FacultyTab from '@/components/admin/FacultyTab';
import EmailSettingsTab from '@/components/admin/EmailSettingsTab';
import EmailComposer from '@/components/admin/EmailComposer';
import BulkEmailComposer from '@/components/admin/BulkEmailComposer';
import ActivityLogTab from '@/components/admin/ActivityLogTab';
import NoticesTab from '@/components/admin/NoticesTab';
import CronJobTab from '@/components/admin/CronJobTab';
import BlogTab from '@/components/admin/BlogTab';
import ClubsTab from '@/components/admin/ClubsTab';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { filterAdminNav } from '@/components/admin/nav';
import { useUrlTab, getUrlParam, writeUrlParams } from '@/lib/use-url-tabs';
import { useUserAccess } from '@/lib/useUserAccess';
import { resolveDepartment, getDepartmentDisplayName } from '@/lib/departments';

// Deep-linkable tabs: /admin?tab=users&sub=pending (the `tab` param is only
// owned here when the panel is rendered standalone — when embedded inside the
// dashboard, DashboardView owns the `tab`/`admin` URL params).
const TAB_KEYS: readonly Tab[] = ['overview', 'users', 'activity', 'faculty', 'facultyDept', 'courses', 'permissions', 'roles', 'rooms', 'batches', 'telegram', 'contributors', 'notices', 'cronJobs', 'blog', 'clubs'];
const SUB_KEYS: readonly UserSubTab[] = ['all', 'admin', 'manager', 'teacher', 'student', 'external', 'pending'];

interface AdminPanelViewProps {
  activeTab?: Tab;
  setActiveTab?: (tab: Tab) => void;
  showSidebar?: boolean;
}

export default function AdminPanelView({ activeTab: activeTabProp, setActiveTab: setActiveTabProp, showSidebar = true }: AdminPanelViewProps = {}) {
  const { data: session } = useSession();
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  const profile = useAppStore(s => s.profile);

  const [internalTab, setInternalTab] = useState<Tab>('overview');
  const activeTab = activeTabProp ?? internalTab;
  const setActiveTab = setActiveTabProp ?? setInternalTab;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userSubTab, setUserSubTab] = useState<UserSubTab>('all');
  // One-shot deep link: /admin?tab=users&sub=pending&q=<email> (sent in the
  // Telegram pending-account notification) opens the Pending list with that
  // exact account pre-filtered in the search box. Freeze the value so later
  // renders never re-read a cleaned-up URL.
  const [deepLinkQ] = useState(() => (typeof window !== 'undefined' ? getUrlParam('q') : ''));
  // Pending-tab gender separation. Default (genderExplicit=false) = server shows
  // the caller's own gender (male managers → male pending, female → female); the
  // All / Male / Female filter buttons flip genderExplicit to let them browse
  // and analyze the full queue. A direct `q=` link neutralises the personalised
  // default so the flagged account is never filtered out of view.
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [genderExplicit, setGenderExplicit] = useState(!!deepLinkQ);

  // The `gender` query param to send for the Pending tab (undefined = server
  // personalizes to the caller's gender). Always `all`/`male`/`female` once the
  // user explicitly picks a filter.
  const pendingGenderParam = useMemo(() => {
    if (!genderExplicit) return undefined;
    return genderFilter === 'all' ? 'all' : genderFilter;
  }, [genderExplicit, genderFilter]);

  // Deep-linkable tabs: /admin?tab=users&sub=pending (the `tab` param is only
  // owned here when the panel is rendered standalone — when embedded inside the
  // dashboard, DashboardView owns the `tab`/`admin` URL params).
  const isStandalone = activeTabProp === undefined;
  const setTabWithUrl = useUrlTab<Tab>('tab', activeTab, setActiveTab, TAB_KEYS, isStandalone);
  const setSubWithUrl = useUrlTab<UserSubTab>('sub', userSubTab, setUserSubTab, SUB_KEYS);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  // Per-sub-tab pagination state so tabs never share each other's lists/pages
  const [userStates, setUserStates] = useState<Partial<Record<UserSubTab, { users: UserRecord[]; total: number; page: number; search: string; nextToken: string | null; firebaseListFailed: boolean; firebaseOnlyCount: number; adminGender: string | null; effectiveGender: string | null }>>>(() =>
    deepLinkQ
      ? { pending: { users: [], total: 0, page: 1, search: deepLinkQ, nextToken: null, firebaseListFailed: false, firebaseOnlyCount: 0, adminGender: null, effectiveGender: null } }
      : {}
  );
  const userState = userStates[userSubTab] ?? { users: [] as UserRecord[], total: 0, page: 1, search: '', nextToken: null as string | null, firebaseListFailed: false, firebaseOnlyCount: 0, adminGender: null as string | null, effectiveGender: null as string | null };
  const users = userState.users;
  const totalUsers = userState.total;
  const currentPage = userState.page;
  const searchQuery = userState.search;
  const firebaseNextPageToken = userState.nextToken;
  const firebaseListFailed = userState.firebaseListFailed;
  const firebaseOnlyCount = userState.firebaseOnlyCount;
  const effectiveGender = userState.effectiveGender;

  // Button highlight: an explicit choice always wins; otherwise the server's
  // effective (gender-personalised) filter is shown, falling back to All.
  const activeGender = (genderExplicit || userSubTab !== 'pending')
    ? genderFilter
    : (effectiveGender === 'male' || effectiveGender === 'female' ? effectiveGender : 'all');
  const handleGenderChange = (g: 'all' | 'male' | 'female') => {
    if (g === activeGender && genderExplicit) return;
    setGenderExplicit(true);
    setGenderFilter(g);
  };

  const patchUserState = (tab: UserSubTab, patch: Partial<typeof userState>) => {
    setUserStates(prev => ({
      ...prev,
      [tab]: { users: [], total: 0, page: 1, search: '', nextToken: null, firebaseListFailed: false, firebaseOnlyCount: 0, adminGender: null, effectiveGender: null, ...prev[tab], ...patch },
    }));
  };
  const setCurrentPage = (page: number) => patchUserState(userSubTab, { page });
  const setSearchQuery = (q: string) => patchUserState(userSubTab, { search: q });
  const tabFromArgs = (role?: string, domain?: string): UserSubTab => {
    if (role === 'admin') return 'admin';
    if (role === 'manager') return 'manager';
    if (domain === 'teacher') return 'teacher';
    if (domain === 'student') return 'student';
    if (domain === 'external') return 'external';
    if (domain === 'pending') return 'pending';
    return 'all';
  };
  const [actionLoading, setActionLoading] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [facultyList, setFacultyList] = useState<any[]>([]);
  const [facultyForm, setFacultyForm] = useState({ department: '', name: '', title: '', email: '', phone: '', shortForm: '', memberType: 'faculty' });
  const [facultySaving, setFacultySaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ inserted: number; updated: number; skipped: number; errors?: string[] } | null>(null);
  const [facultyRequests, setFacultyRequests] = useState<any[]>([]);
  const [facultyDeptFilter, setFacultyDeptFilter] = useState('qsis');
  const [facultyTitleFilter, setFacultyTitleFilter] = useState('');
  const [overviewFacultyCount, setOverviewFacultyCount] = useState(0);
  const [recentLogins, setRecentLogins] = useState<UserRecord[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ email: '', role: 'user', department: '', password: '' });
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  const [createUserSuccess, setCreateUserSuccess] = useState('');
  const [emailTarget, setEmailTarget] = useState<UserRecord | null>(null);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [linkUser, setLinkUser] = useState<UserRecord | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkMsg, setLinkMsg] = useState('');

  const email = session?.user?.email || profile.email || '';
  const effectiveRole = config.getEffectiveRole(email, profile.role);
  const { loading: accessLoading, has, hasAdminPanelAccess, hasCoursePerms, customRoles, permissions } = useUserAccess(
    email,
    effectiveRole,
    profile?.isCR || false,
    profile?.customPermissions || {}
  );
  const isAdmin = effectiveRole === 'admin';
  const isManager = effectiveRole === 'manager';
  const isOwner = config.ownerEmails.includes(email.toLowerCase());
  const hasAdminAccess = hasAdminPanelAccess;
  const canViewExternalUsers = isAdmin || isManager;
  const pendingApprovers = (Array.isArray((permissions as any)?.pendingApprovers) ? (permissions as any).pendingApprovers as string[] : []).map(e => e.toLowerCase());
  const canApprovePending = isAdmin || pendingApprovers.includes(email.toLowerCase());
  const canManageFacultyDepts = isAdmin || isManager || has('manageFacultyDepts');
  const isSuperAdmin = config.ownerEmails.includes(email);
  const useSidebar = showSidebar !== false;

  const navGroups = useMemo(
    () => filterAdminNav({
      isAdmin,
      isManager,
      isOwner,
      effectiveRole,
      profileIsCR: profile?.isCR || false,
      canManageFacultyDepts,
      isTeacherUser: effectiveRole === 'teacher',
      hasCoursePerms,
      has,
    }),
    [isAdmin, isManager, isOwner, effectiveRole, profile?.isCR, canManageFacultyDepts, hasCoursePerms, has]
  );

  // Consume the one-shot ?q=… deep-link param once it has been applied.
  useEffect(() => {
    if (deepLinkQ) writeUrlParams({ q: null });
  }, [deepLinkQ]);

  useEffect(() => {
    if (!hasAdminAccess) return;
    fetch('/api/activity?limit=50')
      .then(r => r.json())
      .then(data => {
        setActivities(data.activities || []);
        setStats(data.stats || null);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load admin data');
        setLoading(false);
      });
    fetch('/api/faculty')
      .then(r => r.json())
      .then(data => setOverviewFacultyCount((data.members || []).length))
      .catch(() => {});
    fetch('/api/admin/users?sort=recent&limit=5')
      .then(r => r.json())
      .then(data => setRecentLogins((data.users || []).filter((u: UserRecord) => u.lastSignIn).slice(0, 5)))
      .catch(() => {});
  }, [hasAdminAccess]);

  const loadUsers = useCallback((role?: string, search?: string, pageToken?: string, append = false, domain?: string, page?: number, gender?: string) => {
    const tab = tabFromArgs(role, domain);
    const params = new URLSearchParams();
    if (role && role !== 'all') params.set('role', role);
    if (search) params.set('search', search);
    if (pageToken) params.set('firebasePageToken', pageToken);
    if (domain && domain !== 'all') params.set('domain', domain);
    if (gender) params.set('gender', gender);
    if (page) params.set('page', String(page));
    params.set('limit', '10');
    if (append) setLoadingMore(true);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(data => {
        setUserStates(prev => {
          const cur = prev[tab] ?? { users: [], total: 0, page: 1, search: '', nextToken: null, adminGender: null, effectiveGender: null };
          return {
            ...prev,
            [tab]: {
              ...cur,
              users: append ? [...cur.users, ...(data.users || [])] : (data.users || []),
              total: data.total || data.users?.length || 0,
              nextToken: data.firebaseNextPageToken || null,
              page: page || cur.page,
              firebaseListFailed: data.firebaseListFailed || false,
              firebaseOnlyCount: data.firebaseOnlyCount || 0,
              adminGender: data.adminGender || null,
              effectiveGender: data.effectiveGender || null,
            },
          };
        });
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, []);

  const refreshUsers = useCallback(() => {
    const domainFilter = userSubTab === 'student' ? 'student' : userSubTab === 'teacher' ? 'teacher' : userSubTab === 'external' ? 'external' : userSubTab === 'pending' ? 'pending' : undefined;
    const roleFilter = userSubTab === 'admin' ? 'admin' : userSubTab === 'manager' ? 'manager' : undefined;
    setCurrentPage(1);
    loadUsers(roleFilter, searchQuery, undefined, false, domainFilter, 1, userSubTab === 'pending' ? pendingGenderParam : undefined);
  }, [userSubTab, searchQuery, pendingGenderParam, loadUsers]);

  useEffect(() => {
    if (!hasAdminAccess) return;
    if (activeTab === 'users') {
      const domainFilter = userSubTab === 'student' ? 'student' : userSubTab === 'teacher' ? 'teacher' : userSubTab === 'external' ? 'external' : userSubTab === 'pending' ? 'pending' : undefined;
      const roleFilter = userSubTab === 'admin' ? 'admin' : userSubTab === 'manager' ? 'manager' : undefined;
      setCurrentPage(1);
      loadUsers(roleFilter, searchQuery, undefined, false, domainFilter, 1, userSubTab === 'pending' ? pendingGenderParam : undefined);
    }
  }, [hasAdminAccess, activeTab, userSubTab, searchQuery, pendingGenderParam, loadUsers]);

  const handleBan = async (targetEmail: string, isBanned: boolean) => {
    const action = isBanned ? 'unban' : 'ban';
    let banReason = '';
    if (!isBanned) {
      const reason = prompt(`Ban ${targetEmail}?\n\nEnter a reason (optional):`);
      if (reason === null) return;
      banReason = reason;
    } else {
      if (!await confirm({ message: `Unban user ${targetEmail}?`, title: 'Unban User' })) return;
    }
    setActionLoading(targetEmail + action);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action, banReason }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleSetRole = async (targetEmail: string, newRole: string) => {
    if (!await confirm({ message: `Change ${targetEmail}'s role to ${newRole}?`, title: 'Change Role' })) return;
    setActionLoading(targetEmail + 'role');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'setRole', newRole }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim()) return;
    await handleSetRole(newAdminEmail.trim(), 'admin');
    setNewAdminEmail('');
    setShowAddAdmin(false);
  };

  const handleLinkEmail = (u: UserRecord) => {
    setLinkUser(u);
    setLinkEmail('');
    setLinkError('');
    setLinkMsg('');
  };

  const handleConfirmLink = async () => {
    if (!linkUser || !linkEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkEmail.trim())) {
      setLinkError('Please enter a valid email address.');
      return;
    }
    setLinkSubmitting(true);
    setLinkError('');
    setLinkMsg('');
    try {
      const res = await fetch('/api/admin/link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: linkUser.email, linkEmail: linkEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (data.success) {
        setLinkMsg(`Linked ${linkEmail.trim().toLowerCase()} to ${linkUser.email}. A password-set email ${data.resetLinkSent ? 'was sent to that inbox' : 'could not be sent (mailer unavailable)'}.`);
        showToast(data.resetLinkSent ? `Linked ${linkEmail.trim().toLowerCase()} and sent a login email` : `Linked ${linkEmail.trim().toLowerCase()}`, 'success');
        refreshUsers();
        setTimeout(() => { setLinkUser(null); setLinkMsg(''); }, 4000);
      } else {
        setLinkError(data.error || 'Failed to link email');
      }
    } catch {
      setLinkError('Action failed. Try again.');
    } finally {
      setLinkSubmitting(false);
    }
  };

  const handleToggleCR = async (targetEmail: string, currentCR: boolean) => {
    setActionLoading(targetEmail + 'cr');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'toggleCR', isCR: !currentCR }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleToggleACR = async (targetEmail: string, currentACR: boolean) => {
    setActionLoading(targetEmail + 'acr');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'toggleACR', isACR: !currentACR }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleToggleManager = async (targetEmail: string, currentRole: string) => {
    if (currentRole === 'manager') {
      await handleSetRole(targetEmail, 'student');
      return;
    }
    if (!await confirm({ message: `Promote ${targetEmail} to Manager? You will remain admin.`, title: 'Promote to Manager' })) return;
    setActionLoading(targetEmail + 'manager');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'setRole', newRole: 'manager' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleDeleteUser = async (targetEmail: string) => {
    if (!await confirm({ message: `Delete ${targetEmail} permanently from Firebase and database? This cannot be undone.`, title: 'Delete User', danger: true })) return;
    setActionLoading(targetEmail + 'delete');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'delete' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleApprove = async (targetEmail: string) => {
    setActionLoading(targetEmail + 'approve');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'approve' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleReject = async (targetEmail: string) => {
    if (!await confirm({ message: `Reject ${targetEmail}'s account? They will be banned.`, title: 'Reject Account', danger: true })) return;
    setActionLoading(targetEmail + 'reject');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'reject' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleSendToPending = async (targetEmail: string) => {
    if (!await confirm({ message: `Move ${targetEmail} back to Pending Approval? They will immediately lose access until approved again.`, title: 'Move to Pending', danger: true })) return;
    setActionLoading(targetEmail + 'pending');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, action: 'sendToPending' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const handleApproveAll = async () => {
    if (!await confirm({ message: 'Approve logins for all still-blocked pending accounts? Only ones that signed up but could not log in yet are affected — roles still need to be assigned separately.', title: 'Approve Pending Logins', danger: true })) return;
    setApproveAllLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approveAllPending' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        refreshUsers();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setApproveAllLoading(false);
    }
  };

  const handleCreateUser = async () => {
    setCreateUserError('');
    setCreateUserSuccess('');
    if (!createUserForm.email.trim() || !createUserForm.email.includes('@')) {
      setCreateUserError('Valid email required');
      return;
    }
    setCreateUserLoading(true);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createUserForm),
      });
      const data = await res.json();
      if (data.success) {
        setCreateUserSuccess(data.message);
        setCreateUserForm({ email: '', role: 'user', department: '', password: '' });
        setShowCreateUser(false);
        refreshUsers();
      } else {
        setCreateUserError(data.error || 'Failed');
      }
    } catch {
      setCreateUserError('Network error');
    }
    setCreateUserLoading(false);
  };

  const loadFaculty = (dept?: string) => {
    const params = new URLSearchParams();
    if (dept || facultyDeptFilter) params.set('department', dept || facultyDeptFilter);
    if (facultyTitleFilter) params.set('title', facultyTitleFilter);
    fetch(`/api/faculty?${params}`)
      .then(r => r.json())
      .then(data => setFacultyList(data.members || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (activeTab === 'faculty') loadFaculty();
  }, [activeTab, facultyDeptFilter, facultyTitleFilter]);

  const handleAddFaculty = async () => {
    if (!facultyForm.department || !facultyForm.name) {
      showToast('Department and name are required', 'error');
      return;
    }
    setFacultySaving(true);
    try {
      const res = await fetch('/api/faculty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(facultyForm),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${facultyForm.name} added to faculty`, 'success');
        setFacultyForm({ department: '', name: '', title: '', email: '', phone: '', shortForm: '', memberType: 'faculty' });
        loadFaculty(facultyForm.department);
      } else {
        showToast(data.error || 'Failed to add', 'error');
      }
    } catch {
      showToast('Failed to add faculty', 'error');
    } finally {
      setFacultySaving(false);
    }
  };

  const handleDeleteFaculty = async (id: string, name: string) => {
    if (!await confirm({ message: `Remove ${name} from faculty?`, danger: true, title: 'Remove Faculty' })) return;
    try {
      const res = await fetch(`/api/faculty?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`${name} removed`, 'success');
        loadFaculty();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Failed', 'error');
    }
  };

  const handleSaveFacultyEdit = async (id: string, form: { name: string; title: string; email: string; phone: string; shortForm: string; memberType: string }) => {
    setFacultySaving(true);
    try {
      const res = await fetch('/api/faculty', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...form }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Updated successfully', 'success');
        loadFaculty();
        return true;
      }
      showToast(data.error || 'Update failed', 'error');
      return false;
    } catch {
      showToast('Update failed', 'error');
      return false;
    } finally {
      setFacultySaving(false);
    }
  };

  // Mirrors canManageFaculty so custom "Manage Faculty" permission holders get
  // the edit button (scoped to their own department when they have one).
  const canEditFacultyMember = (m: any) => {
    if (!(isAdmin || isManager || effectiveRole === 'teacher' || has('manageFaculty'))) return false;
    if (effectiveRole === 'admin' || effectiveRole === 'teacher') return true;
    if (profile?.department) return resolveDepartment(m.department) === resolveDepartment(profile.department);
    return true;
  };

  const handleBulkImport = async () => {
    if (!bulkInput.trim()) {
      showToast('Paste JSON or CSV data first', 'error');
      return;
    }
    setBulkImporting(true);
    setBulkResult(null);
    try {
      let members: any[] = [];
      const trimmed = bulkInput.trim();
      if (trimmed.startsWith('[')) {
        members = JSON.parse(trimmed);
      } else {
        const lines = trimmed.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(',').map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
          members.push(obj);
        }
      }
      if (members.length === 0) {
        showToast('No records found', 'error');
        setBulkImporting(false);
        return;
      }
      const res = await fetch('/api/faculty/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members, mode: 'skip' }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkResult(data);
        showToast(`Imported: ${data.inserted} new, ${data.updated} updated, ${data.skipped} skipped`, 'success');
        loadFaculty();
      } else {
        showToast(data.error || 'Import failed', 'error');
      }
    } catch (e: any) {
      showToast(`Import error: ${e.message}`, 'error');
    } finally {
      setBulkImporting(false);
    }
  };

  const loadFacultyRequests = () => {
    fetch('/api/faculty/request?status=pending')
      .then(r => r.json())
      .then(data => setFacultyRequests(data.requests || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (activeTab === 'faculty') loadFacultyRequests();
  }, [activeTab]);

  const handleToggleVisibility = async (id: string, currentVisible: boolean) => {
    try {
      const res = await fetch('/api/faculty', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isVisible: !currentVisible }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Now ${!currentVisible ? 'visible' : 'hidden'} publicly`, 'success');
        loadFaculty();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Failed to update visibility', 'error');
    }
  };

  const handleBulkVisibility = async (department: string, visible: boolean) => {
    if (!await confirm({ message: `${visible ? 'Show' : 'Hide'} ALL faculty in this department publicly?`, title: 'Bulk Visibility' })) return;
    try {
      const res = await fetch('/api/faculty', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department, isVisible: visible }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${data.count} members ${visible ? 'shown' : 'hidden'}`, 'success');
        loadFaculty();
      } else {
        showToast(data.error || 'Failed', 'error');
      }
    } catch {
      showToast('Failed', 'error');
    }
  };

  const groupedFaculty = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of facultyList) {
      const dept = getDepartmentDisplayName(m.department || 'Unknown');
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(m);
    }
    return map;
  }, [facultyList]);

  const availableTitles = useMemo(() => {
    const titles = new Set<string>();
    for (const m of facultyList) {
      if (m.title) titles.add(m.title);
    }
    return Array.from(titles).sort();
  }, [facultyList]);

  if (accessLoading) {
    return (
      <section className="mb-5">
        <div className="text-center py-20">
          <i className="fas fa-spinner fa-spin text-2xl text-qsis"></i>
          <p className="text-dark-text2 mt-2 text-sm">Checking access...</p>
        </div>
      </section>
    );
  }

  if (!hasAdminAccess) {
    return (
      <section className="mb-5">
        <div className="text-center py-20">
          <i className="fas fa-shield-alt text-4xl text-red-400 mb-4 block opacity-30"></i>
          <p className="text-[1rem] text-dark-text2 mb-2">Access Denied</p>
          <p className="text-[0.82rem] text-dark-text2 opacity-60">You need admin, manager, or teacher privileges to view this page.</p>
          <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-qsis text-white rounded-lg text-sm">Go Home</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-5">
      <div className="mb-5">
        <div className="flex items-center gap-3">
          {useSidebar && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-dark-border bg-dark-bg3 text-dark-text cursor-pointer text-[0.9rem]"
              aria-label="Open admin menu"
            >
              <i className="fas fa-bars"></i>
            </button>
          )}
          <h2 className="text-xl font-bold text-dark-text flex items-center gap-2">
            <i className="fas fa-shield-alt text-qsis"></i>Admin Panel
          </h2>
        </div>
        <p className="text-[0.82rem] text-dark-text2 mt-1">
          {isAdmin ? 'Full admin access' : isManager ? 'Manager access — you can manage users but cannot change admin roles' : effectiveRole === 'teacher' ? 'Teacher access — you can manage faculty, courses, rooms, and batches' : 'Custom access — granted by explicit permissions'}
        </p>
      </div>

      {loading && (
        <div className="text-center py-10">
          <i className="fas fa-spinner fa-spin text-2xl text-qsis"></i>
          <p className="text-dark-text2 mt-2 text-sm">Loading admin data...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
          <i className="fas fa-exclamation-triangle text-red-400 mr-2"></i>
          <span className="text-red-400 text-sm">{error}</span>
        </div>
      )}

      {/* Navigation — sidebar is the single nav for every role (when not embedded in the dashboard) */}
      <div className="flex gap-4 mb-5">
        {useSidebar && (
          <AdminSidebar
            activeTab={activeTab}
            setActiveTab={setTabWithUrl}
            groups={navGroups}
            mobileOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex-1 min-w-0">
        <div>
      {/* Overview Tab */}
      {activeTab === 'overview' && stats && (
        <OverviewTab
          stats={stats}
          activities={activities}
          overviewFacultyCount={overviewFacultyCount}
          recentLogins={recentLogins}
          setActiveTab={setTabWithUrl}
          setUserSubTab={setSubWithUrl}
        />
      )}

      {/* All Users Tab with Sub-tabs */}
      {activeTab === 'users' && (
        <UsersTab
          users={users}
          totalUsers={totalUsers}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          loading={loading}
          loadingMore={loadingMore}
          firebaseNextPageToken={firebaseNextPageToken}
          firebaseListFailed={firebaseListFailed}
          firebaseOnlyCount={firebaseOnlyCount}
          userSubTab={userSubTab}
          setUserSubTab={setSubWithUrl}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showCreateUser={showCreateUser}
          setShowCreateUser={setShowCreateUser}
          createUserForm={createUserForm}
          setCreateUserForm={setCreateUserForm}
          createUserLoading={createUserLoading}
          createUserError={createUserError}
          createUserSuccess={createUserSuccess}
          showAddAdmin={showAddAdmin}
          setShowAddAdmin={setShowAddAdmin}
          newAdminEmail={newAdminEmail}
          setNewAdminEmail={setNewAdminEmail}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
          isManager={isManager}
          canViewExternalUsers={canViewExternalUsers}
          canApprovePending={canApprovePending}
          email={email}
          actionLoading={actionLoading}
          handleCreateUser={handleCreateUser}
          handleAddAdmin={handleAddAdmin}
          handleToggleCR={handleToggleCR}
          handleToggleACR={handleToggleACR}
          handleSetRole={handleSetRole}
          handleBan={handleBan}
          customRoles={customRoles}
          handleToggleManager={handleToggleManager}
          handleApprove={handleApprove}
          handleReject={handleReject}
          handleDeleteUser={handleDeleteUser}
          handleSendToPending={handleSendToPending}
          handleEmail={setEmailTarget}
          handleLinkEmail={handleLinkEmail}
          handleBulkEmail={() => setBulkEmailOpen(true)}
          handleApproveAll={handleApproveAll}
          approveAllLoading={approveAllLoading}
          loadUsers={loadUsers}
          setCreateUserError={setCreateUserError}
          setCreateUserSuccess={setCreateUserSuccess}
          activeGender={activeGender}
          onGenderChange={handleGenderChange}
          genderParam={userSubTab === 'pending' ? pendingGenderParam : undefined}
        />
      )}

      {/* Email Settings Tab */}
      {activeTab === 'email' && (
        <EmailSettingsTab email={email} profileName={profile.name} profileWhatsapp={profile.whatsapp} profileTelegram={profile.telegramId} onOpenBulk={() => setBulkEmailOpen(true)} />
      )}

      {/* Faculty Tab */}
      {activeTab === 'faculty' && (
        <FacultyTab
          facultyList={facultyList}
          facultyForm={facultyForm}
          setFacultyForm={setFacultyForm}
          facultySaving={facultySaving}
          bulkMode={bulkMode}
          setBulkMode={setBulkMode}
          bulkInput={bulkInput}
          setBulkInput={setBulkInput}
          bulkImporting={bulkImporting}
          bulkResult={bulkResult}
          facultyRequests={facultyRequests}
          facultyDeptFilter={facultyDeptFilter}
          setFacultyDeptFilter={setFacultyDeptFilter}
          facultyTitleFilter={facultyTitleFilter}
          setFacultyTitleFilter={setFacultyTitleFilter}
          groupedFaculty={groupedFaculty}
          availableTitles={availableTitles}
          handleAddFaculty={handleAddFaculty}
          handleBulkImport={handleBulkImport}
          handleToggleVisibility={handleToggleVisibility}
          handleBulkVisibility={handleBulkVisibility}
          handleDeleteFaculty={handleDeleteFaculty}
          handleSaveFacultyEdit={handleSaveFacultyEdit}
          canEditFacultyMember={canEditFacultyMember}
          loadFaculty={loadFaculty}
          loadFacultyRequests={loadFacultyRequests}
        />
      )}

      {/* Faculty & Departments Tab */}
      {activeTab === 'facultyDept' && <FacultyDeptTab effectiveRole={effectiveRole} profile={profile} canManage={canManageFacultyDepts} />}

      {/* Courses Tab */}
      {activeTab === 'courses' && <CoursesTab effectiveRole={effectiveRole} profile={profile} />}

      {/* Rooms Tab */}
      {activeTab === 'rooms' && <RoomsTab effectiveRole={effectiveRole} />}

      {/* Batches Tab */}
      {activeTab === 'batches' && <BatchesTab effectiveRole={effectiveRole} profile={profile} />}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && <PermissionsTab customRoles={customRoles} />}

      {/* Roles Tab */}
      {activeTab === 'roles' && <RolesTab />}

      {/* Contributors Tab */}
      {activeTab === 'contributors' && <ContributorsTab />}

      {/* Telegram Tab */}
      {activeTab === 'telegram' && (
        <TelegramTab isOwner={isOwner} effectiveRole={effectiveRole} />
      )}

      {/* Activity Log Tab */}
      {activeTab === 'activity' && <ActivityLogTab activities={activities} />}

      {activeTab === 'notices' && <NoticesTab />}

      {activeTab === 'cronJobs' && <CronJobTab />}
      {activeTab === 'blog' && <BlogTab email={email} effectiveRole={effectiveRole} isCR={profile?.isCR || false} customPermissions={profile?.customPermissions || {}} />}

      {activeTab === 'clubs' && <ClubsTab email={email} effectiveRole={effectiveRole} profile={profile} customPermissions={profile?.customPermissions || {}} />}
        </div>{/* end content */}
        </div>{/* end flex-1 min-w-0 */}
      </div>{/* end flex gap-4 */}
      {confirmDialog}
      {emailTarget && (
        <EmailComposer
          user={emailTarget}
          senderEmail={email}
          senderName={profile.name}
          senderWhatsapp={profile.whatsapp}
          senderTelegram={profile.telegramId}
          onClose={() => setEmailTarget(null)}
        />
      )}
      {bulkEmailOpen && (
        <BulkEmailComposer
          senderEmail={email}
          senderName={profile.name}
          senderWhatsapp={profile.whatsapp}
          senderTelegram={profile.telegramId}
          onClose={() => setBulkEmailOpen(false)}
        />
      )}

      {linkUser && (
        <div className="modal active">
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
              <h2 className="text-base font-semibold"><i className="fas fa-link"></i> Link Email to Profile</h2>
              <button className="text-dark-text2 cursor-pointer bg-transparent border-none hover:text-dark-text" onClick={() => { setLinkUser(null); setLinkMsg(''); }}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-5">
              <p className="text-[0.8rem] text-dark-text2 mb-4">
                Linking a personal email to <span className="text-dark-text font-semibold">{linkUser.name || linkUser.email}</span> ({linkUser.email})
                lets <span className="text-dark-text">{linkUser.name || 'this user'}</span> sign in with that email too (e.g. when the university email no longer works).
              </p>
              <p className="text-[0.72rem] text-amber-400 mb-3"><i className="fas fa-shield-alt mr-1"></i>Only do this after confirming the email belongs to them.</p>
              <label className="block text-[0.78rem] font-medium text-dark-text2 mb-1.5">Personal email to link</label>
              <input
                type="email"
                value={linkEmail}
                onChange={e => { setLinkEmail(e.target.value); setLinkError(''); setLinkMsg(''); }}
                placeholder="theirpersonal@gmail.com"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.85rem] outline-none focus:border-qsis transition-colors mb-1"
              />
              <p className="text-[0.68rem] text-dark-text3 mb-3">University emails cannot be linked. A set-password email is sent to this inbox so they can log in.</p>
              {linkError && <p className="text-[0.75rem] text-red-400 mb-2"><i className="fas fa-exclamation-circle mr-1"></i>{linkError}</p>}
              {linkMsg && <p className="text-[0.75rem] text-green-400 mb-2"><i className="fas fa-check-circle mr-1"></i>{linkMsg}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => { setLinkUser(null); setLinkMsg(''); }}
                  className="px-4 py-2 rounded-xl border border-dark-border bg-transparent text-dark-text2 text-[0.82rem] font-semibold cursor-pointer hover:text-dark-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmLink}
                  disabled={linkSubmitting || !linkEmail.trim()}
                  className="px-4 py-2 rounded-xl bg-qsis text-white text-[0.82rem] font-semibold cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {linkSubmitting ? <><i className="fas fa-spinner fa-spin mr-1"></i>Linking...</> : <><i className="fas fa-link mr-1"></i>Link Email</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
