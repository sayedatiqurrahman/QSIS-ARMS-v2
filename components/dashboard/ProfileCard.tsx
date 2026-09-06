'use client';

import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { FACULTIES } from '@/lib/departments';
import { config } from '@/lib/config';
import CustomSelect from '@/components/CustomSelect';
import BatchSelector from './BatchSelector';
import SessionSelector from './SessionSelector';
import TeacherInfoSection from './TeacherInfoSection';
import SocialLinks from './SocialLinks';
import { normalizeUniversityId } from '@/lib/utils';

function extractUniversityId(email: string): string {
  const match = email.match(/^(q\d+)/i);
  return match ? match[1].toUpperCase() : '';
}

interface ProfileCardProps {
  profile: any;
  displayImage: string;
  displayName: string;
  displayEmail: string;
  hasGitHub: boolean;
  ghUser: any;
  isStudent: boolean;
  isTeacherOrAbove: boolean;
  isTeacherUser: boolean;
  isAdmin: boolean;
  isNonVersityAdmin: boolean;
  showStudentSection: boolean;
  showTeacherSection: boolean;
  editingProfile: boolean;
  editingSocials: boolean;
  profileForm: any;
  setProfileForm: React.Dispatch<React.SetStateAction<any>>;
  setEditingProfile: (v: boolean) => void;
  setEditingSocials: (v: boolean) => void;
  updateProfile: (data: any) => void;
  socialLinks: { icon: string; label: string; url: string }[];
  uploadingAvatar: boolean;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function ProfileCard({
  profile, displayImage, displayName, displayEmail,
  hasGitHub, ghUser, isStudent, isTeacherOrAbove, isTeacherUser, isAdmin, isNonVersityAdmin, showStudentSection, showTeacherSection,
  editingProfile, editingSocials,
  profileForm, setProfileForm, setEditingProfile, setEditingSocials,
  updateProfile, socialLinks,
  uploadingAvatar, avatarInputRef, handleAvatarUpload,
}: ProfileCardProps) {
  const { data: session } = useSession();
  const email = profile.email || (session as any)?.user?.email || '';
  // University email is auto-derived from the login email.
  const universityEmail = /@(?:ugrad\.)?iiuc\.ac\.bd$/i.test(email) ? email : '';
  // Company / organization is student- and external-user-only; admins, managers
  // and teachers show their department instead.
  const showCompany = isStudent || !isTeacherOrAbove;

  // While editing, a non-versity admin's section follows the live selection.
  const effStudentSection = isNonVersityAdmin ? profileForm.profileType === 'student' : showStudentSection;
  const effTeacherSection = isNonVersityAdmin ? profileForm.profileType === 'teacher' : showTeacherSection;

  const startEdit = () => {
    const autoId = profile.universityId || extractUniversityId(email);
    setProfileForm({
      universityId: autoId,
      name: profile.name || '',
      title: profile.title || '',
      shortForm: profile.shortForm || '',
      whatsapp: profile.whatsapp,
      telegramId: profile.telegramId || '',
      semester: profile.semester,
      section: profile.section || '',
      department: profile.department || '',
      batchId: (profile as any).batchId || '',
      session: (profile as any).session || '',
      facebook: profile.facebook,
      twitter: profile.twitter,
      linkedin: profile.linkedin,
      website: profile.website,
      company: profile.company,
      companyUrl: profile.companyUrl,
      publicEmail: profile.publicEmail,
      hideWhatsapp: profile.hideWhatsapp,
      hideUniversityId: profile.hideUniversityId,
      hideSemester: profile.hideSemester,
      hideEmail: profile.hideEmail,
      hideCompany: (profile as any).hideCompany || false,
      showInContributors: (profile as any).showInContributors !== false,
      profileType: (profile as any).profileType || '',
    });
    setEditingProfile(true);
  };

  return (
    <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-5 mb-4">

      {/* Top: Avatar + Name + Role + GitHub badge, Edit button below on mobile */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="relative group cursor-pointer flex-shrink-0" onClick={() => avatarInputRef.current?.click()}>
            <Image src={displayImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=22c55e&color=fff&bold=true&size=200`} alt="" width={64} height={64} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-qsis object-cover" />
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {uploadingAvatar ? <i className="fas fa-spinner fa-spin text-white text-sm"></i> : <i className="fas fa-camera text-white text-sm"></i>}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="text-[1.1rem] font-bold truncate">{displayName}</h4>
              {hasGitHub && ghUser && (
                <a href={`https://github.com/${ghUser.login}`} target="_blank" rel="noopener noreferrer" className="text-[0.7rem] text-dark-text2 hover:text-qsis transition-colors flex items-center gap-1 flex-shrink-0">
                  <i className="fab fa-github"></i> @{ghUser.login}
                </a>
              )}
            </div>
            <p className="text-[0.82rem] text-dark-text2 truncate">{displayEmail}</p>
            {!isTeacherUser && !isAdmin && profile.company && (
              <p className="text-[0.72rem] text-dark-text2 mt-0.5 truncate">
                <i className="fas fa-building mr-1"></i>
                {profile.companyUrl ? (
                  <a href={profile.companyUrl} target="_blank" rel="noopener noreferrer" className="hover:text-qsis transition-colors">{profile.company}</a>
                ) : profile.company}
              </p>
            )}
            {/* Social icons row */}
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {socialLinks.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.label} className="w-7 h-7 rounded-full bg-dark-bg3 border border-dark-border flex items-center justify-center text-dark-text2 hover:text-qsis hover:border-qsis transition-all">
                    <i className={`${s.icon} text-[0.7rem]`}></i>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
        {!editingProfile && (
          <button className="w-full sm:w-auto sm:ml-auto px-3 py-2 rounded-lg border border-dark-border bg-dark-bg3 text-dark-text text-[0.75rem] font-semibold cursor-pointer hover:border-qsis transition-all" onClick={startEdit}>
            <i className="fas fa-pen mr-1"></i> Edit Profile
          </button>
        )}
      </div>

      {/* Profile Completion */}
      {(() => {
        const studentFields = [profile.name, profile.universityId, profile.whatsapp, profile.semester, profile.section];
        const teacherFields = [profile.name, profile.whatsapp];
        const isStudentLike = isNonVersityAdmin ? effStudentSection : isStudent;
        const fields = isStudentLike ? studentFields : teacherFields;
        const filled = fields.filter(Boolean).length;
        const pct = Math.round((filled / fields.length) * 100);
        return (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[0.78rem] text-dark-text2">Profile Completion</span>
              <span className="text-[0.78rem] font-semibold text-qsis">{pct}%</span>
            </div>
            <div className="w-full h-2 bg-dark-bg3 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-qsis to-accent rounded-full transition-all" style={{ width: `${pct}%` }}></div>
            </div>
          </div>
        );
      })()}

      {editingProfile ? (
        <div className="bg-dark-bg3 border border-dark-border rounded-xl p-4">
          <h5 className="text-[0.85rem] font-semibold mb-3"><i className="fas fa-user-edit text-qsis mr-2"></i>Edit Profile</h5>

          {/* ─── BASIC INFO ─── */}
          <p className="text-[0.72rem] font-bold text-qsis uppercase tracking-wider mb-2"><i className="fas fa-id-card mr-1"></i>Basic Info</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1">Full Name</label>
              <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. Sayed Atiqur Rahman" value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fab fa-whatsapp mr-1"></i>WhatsApp</label>
              <input type="tel" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. +8801XXXXXXXXX" value={profileForm.whatsapp} onChange={e => setProfileForm(p => ({ ...p, whatsapp: e.target.value }))} />
            </div>
            <div>
              <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-envelope mr-1"></i>Public Email <span className="text-dark-text3">(shown on profile)</span></label>
              <input type="email" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. yourmail@gmail.com" value={profileForm.publicEmail} onChange={e => setProfileForm(p => ({ ...p, publicEmail: e.target.value }))} />
              <p className="text-[0.65rem] text-dark-text3 mt-0.5">Leave empty to use login email</p>
            </div>
          </div>

          {/* ─── ACADEMIC / VERSITY INFO ─── */}
          {(effStudentSection || effTeacherSection) && (
            <p className="text-[0.72rem] font-bold text-qsis uppercase tracking-wider mb-2"><i className="fas fa-university mr-1"></i>Versity Info</p>
          )}

          {isNonVersityAdmin && (
            <div className="border border-dark-border rounded-lg p-3 mb-3">
              <p className="text-[0.7rem] font-semibold text-dark-text2 mb-2"><i className="fas fa-user-tag mr-1"></i>I am a</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'student', label: 'Student', icon: 'fa-graduation-cap' },
                  { value: 'teacher', label: 'Teacher', icon: 'fa-chalkboard-teacher' },
                  { value: 'maintainer', label: 'Maintainer', icon: 'fa-wrench' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setProfileForm(p => ({ ...p, profileType: opt.value }))}
                    className={`px-3 py-1.5 rounded-lg text-[0.72rem] font-semibold border cursor-pointer transition-all flex items-center gap-1.5 ${
                      profileForm.profileType === opt.value
                        ? 'bg-qsis/15 border-qsis/40 text-qsis'
                        : 'bg-dark-bg border-dark-border text-dark-text2 hover:border-qsis/30 hover:text-dark-text'
                    }`}
                  >
                    <i className={`fas ${opt.icon}`}></i> {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[0.62rem] text-dark-text3 mt-2">You signed in with a personal email. Pick whether you are a student, teacher, or just a maintainer so we show the right info section.</p>
            </div>
          )}

          {effStudentSection && (
            <div className="border border-dark-border rounded-lg p-3 mb-3">
              <p className="text-[0.7rem] font-semibold text-dark-text2 mb-2"><i className="fas fa-graduation-cap mr-1"></i>Student Info</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-building mr-1"></i>Department</label>
                  <CustomSelect
                    value={profileForm.department}
                    onChange={value => setProfileForm(p => ({ ...p, department: value }))}
                    placeholder="Select department..."
                    options={FACULTIES.flatMap(f => f.departments.map(d => ({ value: d.id, label: `${d.shortName} — ${d.name}`, icon: 'fa-building', group: `${f.shortName} — ${f.name}` })))}
                  />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-calendar mr-1"></i>Current Semester</label>
                  <CustomSelect
                    value={profileForm.semester}
                    onChange={value => setProfileForm(p => ({ ...p, semester: value }))}
                    placeholder="Select semester..."
                    options={[
                      ...config.semesters.map(s => ({ value: s.id, label: s.label, icon: 'fa-calendar' })),
                      { value: 'graduated', label: '🎓 Graduated', icon: 'fa-graduation-cap' },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1">University ID</label>
                  <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. Q233099 (auto from email)" value={profileForm.universityId} onChange={e => setProfileForm(p => ({ ...p, universityId: e.target.value }))} onBlur={e => setProfileForm(p => ({ ...p, universityId: normalizeUniversityId(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-envelope-open mr-1"></i>University Email</label>
                  <input type="email" readOnly className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg/50 text-dark-text2 text-[0.82rem] outline-none cursor-not-allowed" placeholder={universityEmail || 'Auto from login email'} value={universityEmail} />
                  <p className="text-[0.65rem] text-dark-text3 mt-0.5">Auto-filled from your login email</p>
                </div>
                <SessionSelector value={profileForm.session} onChange={session => setProfileForm(p => ({ ...p, session }))} />
                {profileForm.department && (
                  <BatchSelector
                    department={profileForm.department}
                    value={profileForm.batchId}
                    onChange={batchId => setProfileForm(p => ({ ...p, batchId }))}
                  />
                )}
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1">Section</label>
                  <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. A, B, C" value={profileForm.section} onChange={e => setProfileForm(p => ({ ...p, section: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {effTeacherSection && (
            <div className="border border-dark-border rounded-lg p-3 mb-3">
              <p className="text-[0.7rem] font-semibold text-dark-text2 mb-2"><i className="fas fa-chalkboard-teacher mr-1"></i>Teacher Info</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-building mr-1"></i>Department</label>
                  <CustomSelect
                    value={profileForm.department}
                    onChange={value => setProfileForm(p => ({ ...p, department: value }))}
                    placeholder="Select department..."
                    options={FACULTIES.flatMap(f => f.departments.map(d => ({ value: d.id, label: `${d.shortName} — ${d.name}`, icon: 'fa-building', group: `${f.shortName} — ${f.name}` })))}
                  />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-graduation-cap mr-1"></i>Designation</label>
                  <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. Assistant Professor" value={profileForm.title} onChange={e => setProfileForm(p => ({ ...p, title: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-user-tag mr-1"></i>Short Form</label>
                  <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. MA Rahman" value={profileForm.shortForm} onChange={e => setProfileForm(p => ({ ...p, shortForm: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-envelope-open mr-1"></i>University Contact Email</label>
                  <input type="email" readOnly className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg/50 text-dark-text2 text-[0.82rem] outline-none cursor-not-allowed" placeholder={universityEmail || 'Auto from login email'} value={universityEmail} />
                  <p className="text-[0.65rem] text-dark-text3 mt-0.5">Auto-filled from your login email</p>
                </div>
              </div>
              <div className="mt-3">
                <TeacherInfoSection email={email} profile={profile} />
              </div>
            </div>
          )}

          {/* Company / Organization */}
          {showCompany && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-building mr-1"></i>Company / Organization</label>
                <input type="text" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="e.g. Programming Light" value={profileForm.company} onChange={e => setProfileForm(p => ({ ...p, company: e.target.value }))} />
              </div>
              <div>
                <label className="text-[0.72rem] text-dark-text2 block mb-1"><i className="fas fa-link mr-1"></i>Company URL</label>
                <input type="url" className="w-full px-2.5 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors" placeholder="https://..." value={profileForm.companyUrl} onChange={e => setProfileForm(p => ({ ...p, companyUrl: e.target.value }))} />
              </div>
            </div>
          )}

          {/* Privacy Toggles */}
          <div className="mb-3 p-3 rounded-lg bg-dark-bg border border-dark-border">
            <p className="text-[0.72rem] text-dark-text2 mb-2"><i className="fas fa-eye-slash mr-1"></i>Privacy Settings</p>
            {effStudentSection && (
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input type="checkbox" checked={profileForm.hideUniversityId} onChange={e => setProfileForm(p => ({ ...p, hideUniversityId: e.target.checked }))} className="accent-qsis" />
                <span className="text-[0.78rem] text-dark-text">Hide University ID from public profile</span>
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={profileForm.hideWhatsapp} onChange={e => setProfileForm(p => ({ ...p, hideWhatsapp: e.target.checked }))} className="accent-qsis" />
              <span className="text-[0.78rem] text-dark-text">Hide WhatsApp from public profile</span>
            </label>
            {effStudentSection && (
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input type="checkbox" checked={profileForm.hideSemester} onChange={e => setProfileForm(p => ({ ...p, hideSemester: e.target.checked }))} className="accent-qsis" />
                <span className="text-[0.78rem] text-dark-text">Hide Semester from public profile</span>
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={profileForm.hideEmail} onChange={e => setProfileForm(p => ({ ...p, hideEmail: e.target.checked }))} className="accent-qsis" />
              <span className="text-[0.78rem] text-dark-text">Hide Email from public profile</span>
            </label>
            {showCompany && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={profileForm.hideCompany} onChange={e => setProfileForm(p => ({ ...p, hideCompany: e.target.checked }))} className="accent-qsis" />
                <span className="text-[0.78rem] text-dark-text">Hide Company from public profile</span>
              </label>
            )}
            <div className="border-t border-dark-border my-2"></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={profileForm.showInContributors} onChange={e => setProfileForm(p => ({ ...p, showInContributors: e.target.checked }))} className="accent-qsis" />
              <span className="text-[0.78rem] text-dark-text">Show me on Contributors page</span>
            </label>
          </div>

          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-xl bg-gradient-to-br from-qsis to-qsis-dark text-white border-none font-semibold text-[0.8rem] cursor-pointer hover:opacity-90 transition-opacity" onClick={() => {
              updateProfile(profileForm);
              setEditingProfile(false);
            }}>
              <i className="fas fa-save mr-1"></i> Save Profile
            </button>
            <button className="px-4 py-2 rounded-xl border border-dark-border bg-dark-bg text-dark-text font-semibold text-[0.8rem] cursor-pointer hover:border-qsis transition-all" onClick={() => setEditingProfile(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {showStudentSection && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">University ID</span>
                <span className={`text-[0.85rem] font-semibold ${profile.universityId ? 'text-qsis' : 'text-dark-text2'}`}>
                  {profile.universityId || 'Not set'}
                </span>
              </div>
            )}
            {profile.department && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Department</span>
                <span className="text-[0.85rem] font-semibold">{(() => {
                  const found = FACULTIES.flatMap(f => f.departments.map(d => ({ ...d, faculty: f.shortName }))).find(d => d.id === profile.department);
                  return found ? `${found.shortName} — ${found.faculty}` : profile.department;
                })()}</span>
              </div>
            )}
            {profile.shortForm && showTeacherSection && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Short Form</span>
                <span className="text-[0.85rem] font-semibold text-qsis">{profile.shortForm}</span>
              </div>
            )}
            {showTeacherSection && profile.title && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Designation</span>
                <span className="text-[0.85rem] font-semibold text-qsis">{profile.title}</span>
              </div>
            )}
            <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
              <span className="text-[0.7rem] text-dark-text2 block mb-1">WhatsApp</span>
              <span className={`text-[0.85rem] font-semibold ${profile.whatsapp ? '' : 'text-dark-text2'}`}>
                {profile.whatsapp || 'Not set'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
              <span className="text-[0.7rem] text-dark-text2 block mb-1"><i className="fas fa-envelope mr-1 text-blue-400"></i>Public Email</span>
              <span className={`text-[0.85rem] font-semibold ${profile.publicEmail ? '' : 'text-dark-text2'}`}>
                {profile.publicEmail || profile.email || 'Not set'}
              </span>
              <p className="text-[0.6rem] text-dark-text3 mt-0.5">Shown on public contributors profile</p>
            </div>
            {showStudentSection && profile.semester && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Semester</span>
                <span className="text-[0.85rem] font-semibold">{profile.semester === 'graduated' ? '🎓 Graduated' : config.semesters.find(s => s.id === profile.semester)?.label || profile.semester}</span>
              </div>
            )}
            {showStudentSection && (profile as any).session && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Session</span>
                <span className="text-[0.85rem] font-semibold">{config.sessions.find(s => s.id === (profile as any).session)?.label || (profile as any).session}</span>
              </div>
            )}
            {profile.section && showStudentSection && (
              <div className="p-3 rounded-lg bg-dark-bg3 border border-dark-border">
                <span className="text-[0.7rem] text-dark-text2 block mb-1">Section</span>
                <span className="text-[0.85rem] font-semibold">{profile.section}</span>
              </div>
            )}
          </div>

          {/* Edit Social Links */}
          <SocialLinks
            profile={profile}
            profileForm={profileForm}
            setProfileForm={setProfileForm}
            editingSocials={editingSocials}
            setEditingSocials={setEditingSocials}
            updateProfile={updateProfile}
          />

          {/* Club Memberships */}
          {Array.isArray((profile as any).clubMemberships) && (profile as any).clubMemberships.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-dark-bg3 border border-dark-border">
              <p className="text-[0.72rem] text-dark-text2 mb-2"><i className="fas fa-users mr-1 text-qsis"></i>Club Memberships</p>
              <div className="space-y-2">
                {(profile as any).clubMemberships.map((m: any, i: number) => (
                  <a key={i} href={`/clubs/${m.clubSlug}`} className="flex items-center gap-2 p-2 rounded-lg bg-dark-bg border border-dark-border hover:border-qsis/40 transition-colors group">
                    {m.logoUrl ? (
                      <div className="w-6 h-6 rounded-full bg-white border border-dark-border overflow-hidden flex items-center justify-center shrink-0">
                        <img src={m.logoUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-qsis/15 flex items-center justify-center">
                        <i className="fas fa-users text-[0.55rem] text-qsis"></i>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.78rem] font-semibold truncate group-hover:text-qsis transition-colors">{m.clubName}</p>
                      <p className="text-[0.62rem] text-dark-text3 capitalize">{m.role.replace(/_/g, ' ')}</p>
                    </div>
                    <i className="fas fa-chevron-right text-[0.55rem] text-dark-text3 group-hover:text-qsis transition-colors"></i>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
