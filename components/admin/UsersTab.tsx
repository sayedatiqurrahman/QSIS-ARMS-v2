'use client';

import { useMemo, useEffect, useState } from 'react';
import { config } from '@/lib/config';
import { getDepartmentOptions } from '@/lib/utils';
import CustomSelect from '@/components/CustomSelect';
import { type UserRecord, type UserSubTab } from './types';
import UserRow from './UserRow';

const PER_PAGE = 10;

interface UsersTabProps {
  users: UserRecord[];
  totalUsers: number;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  loading: boolean;
  loadingMore: boolean;
  firebaseNextPageToken: string | null;
  firebaseListFailed: boolean;
  firebaseOnlyCount: number;
  userSubTab: UserSubTab;
  setUserSubTab: (tab: UserSubTab) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showCreateUser: boolean;
  setShowCreateUser: (show: boolean) => void;
  createUserForm: { email: string; role: string; department: string; password: string };
  setCreateUserForm: React.Dispatch<React.SetStateAction<{ email: string; role: string; department: string; password: string }>>;
  createUserLoading: boolean;
  createUserError: string;
  createUserSuccess: string;
  showAddAdmin: boolean;
  setShowAddAdmin: (show: boolean) => void;
  newAdminEmail: string;
  setNewAdminEmail: (email: string) => void;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isManager: boolean;
  canApprovePending?: boolean;
  canViewExternalUsers: boolean;
  email: string;
  actionLoading: string;
  handleCreateUser: () => void;
  handleAddAdmin: () => void;
  handleToggleCR: (email: string, current: boolean) => void;
  handleToggleACR: (email: string, current: boolean) => void;
  handleSetRole: (email: string, role: string) => void;
  handleBan: (email: string, isBanned: boolean) => void;
  customRoles?: { key: string; label: string; icon: string; color: string }[];
  handleToggleManager: (email: string, currentRole: string) => void;
  handleApprove: (email: string) => void;
  handleReject: (email: string) => void;
  handleDeleteUser: (email: string) => void;
  handleSendToPending: (email: string) => void;
  handleEmail?: (u: UserRecord) => void;
  handleBulkEmail?: () => void;
  handleLinkEmail?: (u: UserRecord) => void;
  handleApproveAll: () => void;
  approveAllLoading: boolean;
  loadUsers: (role?: string, search?: string, pageToken?: string, append?: boolean, domain?: string, page?: number, gender?: string) => void;
  setCreateUserError: (msg: string) => void;
  setCreateUserSuccess: (msg: string) => void;
  activeGender?: 'all' | 'male' | 'female';
  onGenderChange?: (g: 'all' | 'male' | 'female') => void;
  genderParam?: string;
}

export default function UsersTab({
  users,
  totalUsers,
  currentPage,
  setCurrentPage,
  loading,
  loadingMore,
  firebaseNextPageToken,
  firebaseListFailed,
  firebaseOnlyCount,
  userSubTab,
  setUserSubTab,
  searchQuery,
  setSearchQuery,
  showCreateUser,
  setShowCreateUser,
  createUserForm,
  setCreateUserForm,
  createUserLoading,
  createUserError,
  createUserSuccess,
  showAddAdmin,
  setShowAddAdmin,
  newAdminEmail,
  setNewAdminEmail,
  isSuperAdmin,
  isAdmin,
  isManager,
  canApprovePending = false,
  canViewExternalUsers,
  email,
  actionLoading,
  handleCreateUser,
  handleAddAdmin,
  handleToggleCR,
  handleToggleACR,
  handleSetRole,
  handleBan,
  customRoles = [],
  handleToggleManager,
  handleApprove,
  handleReject,
  handleDeleteUser,
  handleSendToPending,
  handleApproveAll,
  approveAllLoading,
  loadUsers,
  setCreateUserError,
  setCreateUserSuccess,
  handleEmail,
  handleBulkEmail,
  handleLinkEmail,
  activeGender = 'all',
  onGenderChange,
  genderParam,
}: UsersTabProps) {
  const totalPages = Math.ceil(totalUsers / PER_PAGE);

  // Local, instantly-typed search input; the parent query (which triggers the
  // server fetch) is only updated after a short pause — typing no longer fires
  // a request on every keystroke.
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (searchInput === searchQuery) return;
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, searchQuery, setSearchQuery]);

  // Safety net: never surface university / owner / rejected / approved accounts
  // in the pending queue, regardless of what the API returns. Pending =
  // non-university accounts still waiting for approval with no role / privilege
  // assigned (not CR, not ACR, role is null, 'user' or the detected 'external').
  const isPendingTab = userSubTab === 'pending';
  const displayedUsers = useMemo(() => {
    if (!isPendingTab) return users;
    return users.filter(u =>
      u.accountStatus === 'pending' &&
      !/@iiuc\.ac\.bd$/i.test(u.email) &&
      !config.ownerEmails.includes(u.email.toLowerCase()) &&
      !u.isCR &&
      !u.isACR &&
      (!u.role || u.role === 'user' || u.role === 'external')
    );
  }, [isPendingTab, users]);

  const goToPage = (page: number) => {
    const domainFilter = userSubTab === 'student' ? 'student' : userSubTab === 'teacher' ? 'teacher' : userSubTab === 'external' ? 'external' : userSubTab === 'pending' ? 'pending' : undefined;
    const roleFilter = userSubTab === 'admin' ? 'admin' : userSubTab === 'manager' ? 'manager' : undefined;
    setCurrentPage(page);
    loadUsers(roleFilter, searchQuery, undefined, false, domainFilter, page, userSubTab === 'pending' ? genderParam : undefined);
  };

  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const handleSubTabChange = (tab: UserSubTab) => {
    setCurrentPage(1);
    setUserSubTab(tab);
  };

  return (
    <div>
      {/* Sub-tab Navigation */}
      <div className="flex flex-wrap gap-1 mb-4 p-1 bg-dark-bg2 border border-dark-border rounded-xl">
        {([
          { key: 'all' as UserSubTab, label: 'All Users', icon: 'fa-users', color: 'text-dark-text2' },
          { key: 'admin' as UserSubTab, label: 'Admins', icon: 'fa-crown', color: 'text-red-400' },
          { key: 'manager' as UserSubTab, label: 'Managers', icon: 'fa-user-shield', color: 'text-orange-400' },
          { key: 'teacher' as UserSubTab, label: 'Teachers', icon: 'fa-chalkboard-teacher', color: 'text-green-400' },
          { key: 'student' as UserSubTab, label: 'Students', icon: 'fa-user-graduate', color: 'text-blue-400' },
          { key: 'external' as UserSubTab, label: 'External', icon: 'fa-globe', color: 'text-purple-400', show: canViewExternalUsers },
          { key: 'pending' as UserSubTab, label: 'Pending', icon: 'fa-clock', color: 'text-yellow-400', show: isAdmin || isManager || canApprovePending },
        ]).filter(s => s.show !== false).map(sub => (
          <button
            key={sub.key}
            onClick={() => handleSubTabChange(sub.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[0.73rem] font-semibold transition-all cursor-pointer border-none whitespace-nowrap ${
              userSubTab === sub.key ? 'bg-qsis text-white' : 'bg-transparent text-dark-text2 hover:text-dark-text hover:bg-dark-bg3'
            }`}
          >
            <i className={`fas ${sub.icon} ${userSubTab === sub.key ? 'text-white' : sub.color}`}></i>
            {sub.label}
            {userSubTab === sub.key && <span className="ml-1 text-[0.65rem] opacity-80">({userSubTab === 'pending' ? displayedUsers.length : totalUsers})</span>}
          </button>
        ))}
      </div>

      {/* Pending tab explainer */}
      {userSubTab === 'pending' && (
        <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-4 text-[0.72rem] text-yellow-300">
          <i className="fas fa-clock mr-1"></i>
          Non-university accounts that haven&apos;t been approved yet — most requested access by submitting their student ID (and, optionally, a WhatsApp/Telegram number). Verify the ID, then <span className="font-semibold">Approve</span> to let them log in, or <span className="font-semibold">Reject</span> if it doesn&apos;t check out. Assigning a role (Student, Teacher, etc.) or making them CR/ACR also activates them and removes them from this list. Newest requests appear first, and the list starts personalised to your own gender — use <span className="font-semibold">All / Male / Female</span> to watch and analyze the rest of the queue.
        </div>
      )}

      {/* Gender filter for pending tab — defaults to the caller's own gender
          (male managers → male pending, female → female); use the buttons to
          browse or analyze the rest of the queue. */}
      {userSubTab === 'pending' && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => onGenderChange?.('all')}
            className={`px-3 py-1.5 rounded-lg text-[0.72rem] font-semibold cursor-pointer border transition-all ${
              activeGender === 'all'
                ? 'bg-qsis text-white border-qsis'
                : 'bg-dark-bg2 text-dark-text2 border-dark-border hover:text-dark-text hover:border-qsis/30'
            }`}
          >
            <i className="fas fa-users mr-1"></i>All ({displayedUsers.length})
          </button>
          <button
            onClick={() => onGenderChange?.('male')}
            className={`px-3 py-1.5 rounded-lg text-[0.72rem] font-semibold cursor-pointer border transition-all ${
              activeGender === 'male'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-dark-bg2 text-dark-text2 border-dark-border hover:text-blue-400 hover:border-blue-500/30'
            }`}
          >
            <i className="fas fa-mars mr-1"></i>Male ({displayedUsers.filter(u => u.gender === 'male').length})
          </button>
          <button
            onClick={() => onGenderChange?.('female')}
            className={`px-3 py-1.5 rounded-lg text-[0.72rem] font-semibold cursor-pointer border transition-all ${
              activeGender === 'female'
                ? 'bg-pink-500 text-white border-pink-500'
                : 'bg-dark-bg2 text-dark-text2 border-dark-border hover:text-pink-400 hover:border-pink-500/30'
            }`}
          >
            <i className="fas fa-venus mr-1"></i>Female ({displayedUsers.filter(u => u.gender === 'female').length})
          </button>
        </div>
      )}

      {/* External tab explainer */}
      {userSubTab === 'external' && (
        <div className="bg-purple-500/10 border border-purple-500/25 rounded-xl p-3 mb-4 text-[0.72rem] text-purple-300">
          <i className="fas fa-globe mr-1"></i>
          External is a grouping for <span className="font-semibold">every non-university account</span> (not a role) — a quick way to see all outside accounts using the platform. What matters is each account&apos;s assigned role, which decides its access.
        </div>
      )}

      {/* Add Admin (only on admin sub-tab) */}
      {userSubTab === 'admin' && isSuperAdmin && (
        <div className="mb-4">
          <button onClick={() => setShowAddAdmin(!showAddAdmin)} className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[0.75rem] font-semibold cursor-pointer hover:bg-red-500/25 border-none">
            <i className="fas fa-plus mr-1"></i>Add Admin
          </button>
          {showAddAdmin && (
            <div className="bg-dark-bg2 border border-dark-border rounded-xl p-4 mt-3 flex gap-2">
              <input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} placeholder="Email to make admin" className="flex-1 px-3 py-2 rounded-lg bg-dark-bg border border-dark-border text-dark-text text-sm" />
              <button onClick={handleAddAdmin} disabled={!newAdminEmail.trim()} className="px-4 py-2 rounded-lg bg-qsis text-white text-[0.78rem] font-semibold cursor-pointer hover:opacity-90 border-none disabled:opacity-50">Add</button>
            </div>
          )}
        </div>
      )}

      {/* All Users info: this view is sourced from Firebase auth accounts and
          enriched with database profiles; accounts without a DB record still
          appear, auto-labelled Student/Teacher from their email domain. */}
      {userSubTab === 'all' && !firebaseListFailed && firebaseOnlyCount > 0 && (
        <p className="text-[0.72rem] text-cyan-400 mb-3">
          <i className="fas fa-cloud mr-1"></i>
          All Users is pulled from Firebase — {firebaseOnlyCount} of {totalUsers} accounts have no database profile yet and are shown anyway with an auto-detected role.
        </p>
      )}
      {firebaseListFailed && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-[0.72rem] text-red-400">
          <i className="fas fa-exclamation-triangle mr-1"></i>
          Could not load Firebase accounts — showing database users only. Firebase service-account keys are not configured on the server (FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL). Until they are added, <span className="font-semibold">Create User</span> cannot create a real sign-in account, so people you grant access to still won't be able to log in.
        </div>
      )}

      {/* Search + Create User */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
        <h3 className="text-sm font-semibold text-dark-text">
          {userSubTab === 'all' && <><i className="fas fa-users text-dark-text2 mr-1"></i>All Users</>}
          {userSubTab === 'admin' && <><i className="fas fa-crown text-red-400 mr-1"></i>Admins</>}
          {userSubTab === 'manager' && <><i className="fas fa-user-shield text-orange-400 mr-1"></i>Managers</>}
          {userSubTab === 'teacher' && <><i className="fas fa-chalkboard-teacher text-green-400 mr-1"></i>Teachers</>}
          {userSubTab === 'student' && <><i className="fas fa-user-graduate text-blue-400 mr-1"></i>Students</>}
          {userSubTab === 'external' && <><i className="fas fa-globe text-purple-400 mr-1"></i>External Accounts</>}
            {userSubTab === 'pending' && <><i className="fas fa-clock text-yellow-400 mr-1"></i>Pending Approval</>}
          <span className="text-dark-text3 ml-1">({userSubTab === 'pending' ? displayedUsers.length : totalUsers})</span>        </h3>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          {userSubTab === 'pending' && (isAdmin || isManager) && (
            <button
              onClick={handleApproveAll}
              disabled={approveAllLoading || displayedUsers.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[0.78rem] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-50"
            >
              {approveAllLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-double"></i>} Approve Logins
            </button>
          )}
          {(isAdmin || isManager) && handleBulkEmail && (
            <button onClick={handleBulkEmail} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 text-[0.78rem] font-semibold hover:bg-rose-500/25 transition-colors">
              <i className="fas fa-envelope-open-text"></i> Bulk Email
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowCreateUser(!showCreateUser)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-qsis/15 text-qsis text-[0.78rem] font-semibold hover:bg-qsis/25 transition-colors">
              <i className="fas fa-user-plus"></i> Create User
            </button>
          )}
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by name or email..."
            className="px-3 py-1.5 rounded-lg bg-dark-bg border border-dark-border text-dark-text text-[0.78rem] w-full sm:w-60"
          />
        </div>
      </div>

      {/* Create User Form */}
      {showCreateUser && (
        <div className="bg-dark-bg2 border border-qsis/20 rounded-xl p-4 mb-4">
          <h4 className="text-[0.85rem] font-semibold text-dark-text mb-3"><i className="fas fa-user-plus text-qsis mr-1.5"></i>Create New User</h4>
          <p className="text-[0.72rem] text-dark-text3 mb-3">Create an account for any email address (including non-university emails). They can set their password via email.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="sm:col-span-2">
              <label className="text-[0.72rem] text-dark-text2 block mb-1">Email *</label>
              <input type="email" value={createUserForm.email} onChange={e => setCreateUserForm(p => ({ ...p, email: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis" placeholder="user@example.com" />
              <p className="text-[0.65rem] text-dark-text3 mt-1">Any email works — university (<span className="text-dark-text2">@ugrad.iiuc.ac.bd</span>, <span className="text-dark-text2">@iiuc.ac.bd</span>) or personal (Gmail, Outlook, etc.).</p>
            </div>
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1">Password</label>
              <input type="password" value={createUserForm.password} onChange={e => setCreateUserForm(p => ({ ...p, password: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis" placeholder="Leave blank to send setup email" />
            </div>
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1">Role *</label>
              <CustomSelect
                value={createUserForm.role}
                onChange={(val) => setCreateUserForm(p => ({ ...p, role: val }))}
                options={[
                  { value: 'user', label: 'User', icon: 'fa-user' },
                  { value: 'student', label: 'Student', icon: 'fa-user-graduate' },
                  { value: 'teacher', label: 'Teacher', icon: 'fa-chalkboard-teacher' },
                  { value: 'manager', label: 'Manager', icon: 'fa-user-shield' },
                  { value: 'admin', label: 'Admin', icon: 'fa-crown' },
                ]}
              />
            </div>
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1">Department</label>
              <CustomSelect
                value={createUserForm.department}
                onChange={(val) => setCreateUserForm(p => ({ ...p, department: val }))}
                placeholder="None"
                searchable
                options={getDepartmentOptions()}
              />
            </div>
          </div>
          {createUserError && <p className="text-[0.75rem] text-red-400 mb-2"><i className="fas fa-exclamation-circle mr-1"></i>{createUserError}</p>}
          {createUserSuccess && <p className="text-[0.75rem] text-green-400 mb-2"><i className="fas fa-check-circle mr-1"></i>{createUserSuccess}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowCreateUser(false); setCreateUserError(''); setCreateUserSuccess(''); }} className="px-4 py-2 rounded-lg bg-dark-bg border border-dark-border text-dark-text2 text-[0.82rem] hover:bg-dark-bg3 transition-colors">Cancel</button>
            <button onClick={handleCreateUser} disabled={createUserLoading} className="px-4 py-2 rounded-lg bg-qsis text-white text-[0.82rem] font-semibold hover:bg-qsis/90 transition-colors disabled:opacity-50">
              {createUserLoading ? <><i className="fas fa-spinner fa-spin mr-1"></i>Creating...</> : <><i className="fas fa-user-plus mr-1"></i>Create User</>}
            </button>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="flex flex-col gap-2">
        {displayedUsers.map(u => (
          <UserRow
            key={u.email}
            u={u}
            email={email}
            isAdmin={isAdmin}
            isManager={isManager}
            isSuperAdmin={isSuperAdmin}
            canApprovePending={canApprovePending}
            actionLoading={actionLoading}
            isPendingTab={isPendingTab}
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
            handleEmail={handleEmail}
            handleLinkEmail={handleLinkEmail}
          />
        ))}
      </div>
      {displayedUsers.length === 0 && !loading && (
        <div className="text-center py-10">
          <i className="fas fa-users text-3xl text-dark-text3 mb-3"></i>
          <p className="text-dark-text3 text-sm">No users found</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-dark-border">
          <p className="text-[0.72rem] text-dark-text3">
            Showing <span className="text-dark-text2 font-semibold">{(currentPage - 1) * PER_PAGE + 1}</span>
            {' '}–{' '}
            <span className="text-dark-text2 font-semibold">{Math.min(currentPage * PER_PAGE, totalUsers)}</span>
            {' '}of{' '}
            <span className="text-dark-text2 font-semibold">{totalUsers}</span> users
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text2 text-[0.75rem] flex items-center justify-center hover:bg-dark-bg3 hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <i className="fas fa-chevron-left text-[0.6rem]"></i>
            </button>
            {pageNumbers.map((p, i) =>
              typeof p === 'string' ? (
                <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-dark-text3 text-[0.7rem]">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`w-8 h-8 rounded-lg text-[0.75rem] font-semibold flex items-center justify-center transition-all cursor-pointer border ${
                    currentPage === p
                      ? 'bg-qsis text-white border-qsis'
                      : 'border-dark-border bg-dark-bg2 text-dark-text2 hover:bg-dark-bg3 hover:text-dark-text'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="w-8 h-8 rounded-lg border border-dark-border bg-dark-bg2 text-dark-text2 text-[0.75rem] flex items-center justify-center hover:bg-dark-bg3 hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <i className="fas fa-chevron-right text-[0.6rem]"></i>
            </button>
          </div>
        </div>
      )}

      {firebaseNextPageToken && (
        <button
          onClick={() => {
            const domainFilter = userSubTab === 'student' ? 'student' : userSubTab === 'teacher' ? 'teacher' : userSubTab === 'external' ? 'external' : userSubTab === 'pending' ? 'pending' : undefined;
            loadUsers(userSubTab === 'admin' ? 'admin' : userSubTab === 'manager' ? 'manager' : undefined, searchQuery, firebaseNextPageToken, true, domainFilter, undefined, userSubTab === 'pending' ? genderParam : undefined);
          }}
          disabled={loadingMore}
          className="mt-3 w-full py-2.5 rounded-xl border border-dark-border bg-dark-bg2 text-dark-text2 text-[0.78rem] font-semibold hover:bg-dark-bg3 hover:text-dark-text cursor-pointer transition-colors disabled:opacity-50"
        >
          {loadingMore ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Loading more users...</> : <><i className="fas fa-arrow-down mr-1.5"></i>Load more users</>}
        </button>
      )}
      {loadingMore && <p className="text-[0.68rem] text-dark-text3 text-center mt-1">Fetching from Firebase...</p>}
    </div>
  );
}
