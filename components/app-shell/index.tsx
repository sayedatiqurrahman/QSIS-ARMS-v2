'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { useAppStore } from '@/lib/store';
import { getOnboardingData, hasDismissedOnboarding, dismissOnboarding } from '@/lib/onboarding-storage';
import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut, signIn } from 'next-auth/react';
import { config } from '@/lib/config';
import { checkAndBustCache, forceResetApp, checkForAppUpdate, startUpdateWatcher, applyAppUpdate } from '@/lib/cache';
import { purgeExpiredCache } from '@/lib/file-cache';
import { useConfirm } from '@/components/ConfirmModal';
import OperationProgress from '@/components/OperationProgress';
import { isStandalone, isInBrowser, isIOSBrowser, type BeforeInstallPromptEvent } from '@/lib/standalone';
import { useTurnstile } from '@/lib/useTurnstile';
import { useUserAccess } from '@/lib/useUserAccess';
import { useScheduledPublishPoller } from '@/hooks/useScheduledPublishPoller';
import { handleGoogleRedirectResult } from '@/lib/firebase';
import dynamic from 'next/dynamic';
const DocumentViewer = dynamic(() => import('./DocumentViewer'), { ssr: false });
const InstallAppButton = dynamic(() => import('@/components/dashboard/InstallAppButton'), { ssr: false });
const FloatingFocus = dynamic(() => import('@/components/FloatingFocus'), { ssr: false });
// Modals only load their JS when actually opened — keeps the always-loaded
// shell light so the installed app starts fast on low-end devices.
const LoginModal = dynamic(() => import('@/components/LoginModal'), { ssr: false });
const UploadModal = dynamic(() => import('@/components/upload-modal'), { ssr: false });
const OnboardingModal = dynamic(() => import('@/components/OnboardingModal'), { ssr: false });

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  // Poll scheduled-publish jobs every 5 min (replaces Vercel cron on Hobby plan)
  useScheduledPublishPoller();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);
  const { confirm, confirmDialog } = useConfirm();
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const mq2 = window.matchMedia?.('(display-mode: window-controls-overlay)');
    const update = () => setStandalone(isStandalone());
    if (mq) {
      mq.addEventListener?.('change', update);
      mq2?.addEventListener?.('change', update);
      return () => {
        mq.removeEventListener?.('change', update);
        mq2?.removeEventListener?.('change', update);
      };
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, [pathname]);

  const handleCheckUpdate = async () => {
    const { showToast } = await import('@/lib/utils');
    showToast('Checking for updates...', 'info');
    const hasUpdate = await checkForAppUpdate();
    if (hasUpdate) {
      await installUpdate();
    } else {
      showToast('You are up to date!', 'success');
    }
  };

  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);
  const [canInstall, setCanInstall] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('qsis-install-banner-dismissed') === 'true') setInstallBannerDismissed(true);
    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      setCanInstall(e);
    };
    const onAppInstalled = () => {
      setCanInstall(null);
      setInstallBannerDismissed(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const showInstallBanner = isInBrowser() && !installBannerDismissed && (canInstall !== null || isIOSBrowser());

  // Pre-render Turnstile when Sign In is clicked
  const turnstileContainerId = 'pre-login-turnstile-container';
  const { renderWidget: renderTurnstile, getToken: getTurnstileToken, remove: removeTurnstile } = useTurnstile();
  const [preRenderedTurnstile, setPreRenderedTurnstile] = useState(false);

  const handleOpenLogin = useCallback(() => {
    setLoginModalOpen(true);
    if (!preRenderedTurnstile) {
      setTimeout(() => {
        renderTurnstile(turnstileContainerId, 'LOGIN').then(() => setPreRenderedTurnstile(true));
      }, 100);
    }
  }, [preRenderedTurnstile, renderTurnstile]);

  // Handle Google redirect result (for Brave/browsers that block popup)
  useEffect(() => {
    handleGoogleRedirectResult().then(async (result) => {
      if (result?.idToken) {
        const res = await signIn('credentials', { idToken: result.idToken, redirect: false });
        if (res?.ok) {
          window.location.reload();
        }
      }
    }).catch(() => {});
  }, []);

  const goHome = useAppStore(s => s.goHome);
  const setUploadOpen = useAppStore(s => s.setUploadOpen);
  const uploadOpen = useAppStore(s => s.uploadOpen);
  const uploadBg = useAppStore(s => s.uploadBg);
  const operationLabel = useAppStore(s => s.operationLabel);
  const viewerOpen = useAppStore(s => s.viewerOpen);
  const viewerItem = useAppStore(s => s.viewerItem);
  const closeViewer = useAppStore(s => s.closeViewer);
  const profile = useAppStore(s => s.profile);
  const appEmail = (session as any)?.user?.email || profile.email || '';
  const appEffectiveRole = config.getEffectiveRole(appEmail, profile.role);
  const { hasAdminPanelAccess } = useUserAccess(
    appEmail,
    appEffectiveRole,
    profile?.isCR || false,
    profile?.customPermissions || {}
  );
  const loadTree = useAppStore(s => s.loadTree);
  const loadCourses = useAppStore(s => s.loadCourses);
  const loadProfile = useAppStore(s => s.loadProfile);
  const loadRecentReads = useAppStore(s => s.loadRecentReads);
  const navigateToDashboard = useAppStore(s => s.navigateToDashboard);
  const loadOnboarding = useAppStore(s => s.loadOnboarding);
  const setStoreOnboarding = useAppStore(s => s.setOnboardingData);
  const updateProfile = useAppStore(s => s.updateProfile);

  // ─── GitHub connect prompt (shown before opening upload panel when not connected) ───
  // "Connected" = any GitHub connection (PAT, GitHub App install, login, or session token).
  const isGithubConnected = !!profile.hasGithubToken || !!profile.githubInstallationId || !!profile.githubLogin || !!(session as any)?.accessToken;
  const [patPromptOpen, setPatPromptOpen] = useState(false);
  const [patPromptWarn, setPatPromptWarn] = useState(false);
  const [patInputToken, setPatInputToken] = useState('');
  const [patSaving, setPatSaving] = useState(false);
  const [patAskCount, setPatAskCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return Number(localStorage.getItem('patAskCount') || 0);
  });
  const [patSkipForever, setPatSkipForever] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('patSkipForever') === 'true';
  });

  const handleOpenUpload = useCallback(() => {
    if (!isGithubConnected) {
      if (patSkipForever) { setUploadOpen(true); return; }
      const nextCount = patAskCount + 1;
      setPatAskCount(nextCount);
      if (typeof window !== 'undefined') localStorage.setItem('patAskCount', String(nextCount));
      setPatPromptWarn(nextCount >= 3);
      setPatPromptOpen(true);
      return;
    }
    setUploadOpen(true);
  }, [isGithubConnected, patSkipForever, patAskCount, setUploadOpen]);

  const handlePatUploadAnyway = () => {
    setPatPromptOpen(false);
    setUploadOpen(true);
  };

  const handlePatSkipForever = () => {
    setPatSkipForever(true);
    if (typeof window !== 'undefined') localStorage.setItem('patSkipForever', 'true');
    setPatPromptOpen(false);
    setUploadOpen(true);
  };

  const handlePatSaveAndContinue = async () => {
    if (!patInputToken.trim()) return;
    setPatSaving(true);
    try {
      const ghRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `token ${patInputToken.trim()}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!ghRes.ok) {
        const { showToast } = await import('@/lib/utils');
        showToast('Invalid token. Please check and try again.', 'error');
        setPatSaving(false);
        return;
      }
      const ghUser = await ghRes.json();
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubLogin: ghUser.login, githubToken: patInputToken.trim(), githubAvatar: ghUser.avatar_url }),
      });
      const data = await res.json();
      if (data.success || res.ok) {
        useAppStore.setState(s => ({
          profile: { ...s.profile, githubLogin: ghUser.login, hasGithubToken: true, githubAvatar: ghUser.avatar_url },
        }));
        loadProfile();
        setPatPromptOpen(false);
        setUploadOpen(true);
      } else {
        const { showToast } = await import('@/lib/utils');
        showToast(data.error || 'Invalid token', 'error');
      }
    } catch {
      const { showToast } = await import('@/lib/utils');
      showToast('Network error', 'error');
    }
    setPatSaving(false);
  };

  useEffect(() => {
    loadTree(session?.accessToken || '');
    loadCourses();
    loadRecentReads();
    loadOnboarding();
    // Check onboarding — for logged-in users, defer modal until profile loads
    // (profile auto-sync below will create onboarding from profile, skipping the modal)
    const data = getOnboardingData();
    if (data) {
      setOnboardingDone(true);
    } else if (!session || status !== 'authenticated') {
      // Not logged in — show onboarding modal immediately
      if (!hasDismissedOnboarding()) setShowOnboarding(true);
      else setOnboardingDone(true);
    }
    // If logged in but no onboarding data, don't show modal yet —
    // the profileLoaded effect below will handle it.
  }, []);

  // Open PAT modal when ?action=github-token is in the URL (after auth resolves)
  // For non-logged-in users: URL param survives login redirect, modal opens after return.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('action') === 'github-token') {
      if (status === 'authenticated' && !isGithubConnected) {
        setPatPromptOpen(true);
        window.history.replaceState({}, '', window.location.pathname);
      } else if (status !== 'authenticated') {
        // Not logged in yet — don't strip param, let it survive the login redirect
      }
    }
  }, [status, isGithubConnected]);

  // Auto-sync personalization with profile: bidirectional sync between
  // onboarding data (localStorage) and the server profile.
  const profileLoaded = useAppStore(s => s.profileLoaded);
  useEffect(() => {
    if (!profileLoaded) return;
    const dept = profile.department || '';
    const semId = profile.semester || '';
    const semLabel = config.semesters.find(s => s.id === semId)?.label || semId;
    const hasDept = !!dept;
    const hasSem = !!semId && semId !== 'graduated';

    // Case 1: profile is incomplete — show modal (unless already dismissed)
    if (!hasDept || !hasSem) {
      if (status === 'authenticated' && !hasDismissedOnboarding()) {
        setShowOnboarding(true);
      } else {
        setOnboardingDone(true);
      }
      return;
    }

    // Case 2: profile is complete — sync to onboarding data
    const existing = getOnboardingData();
    if (!existing) {
      // No onboarding yet — auto-create from profile (skip modal)
      setStoreOnboarding({
        gender: (profile.gender === 'male' || profile.gender === 'female' ? profile.gender : 'male'),
        department: dept,
        semester: semLabel,
        fileView: 'all-prioritized',
        completedAt: Date.now(),
      });
      setOnboardingDone(true);
      setShowOnboarding(false);
    } else if (existing.department !== dept || existing.semester !== semLabel) {
      // Profile changed (e.g. from settings) — silently update onboarding
      setStoreOnboarding({ ...existing, department: dept, semester: semLabel });
    }
  }, [profileLoaded, profile.department, profile.semester]);

  // Register service worker for offline/PWA support
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Auto-update: detect a newer deploy (on load, focus, and every 5 min) and
  // notify the user with a single update banner that auto-applies after a countdown.
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState(0);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const updateAppliedRef = useRef(false);
  const updateDismissedRef = useRef(false);

  // Single path for applying an update. Keeps the banner visible with
  // "Installing..." feedback while the new build is fetched + activated, then
  // the page reloads.
  const installUpdate = useCallback(async () => {
    if (installingUpdate || updateAppliedRef.current) return;
    updateAppliedRef.current = true;
    setInstallingUpdate(true);
    setShowUpdateBanner(true);
    const { showToast } = await import('@/lib/utils');
    showToast('Update found — installing...', 'info');
    await applyAppUpdate();
    setInstallingUpdate(false);
  }, [installingUpdate]);

  useEffect(() => {
    const updated = checkAndBustCache();
    if (updated) {
      window.location.reload();
      return;
    }
    // Purge file cache entries older than 30 days
    purgeExpiredCache();
    return startUpdateWatcher((hasUpdate) => {
      if (!hasUpdate) return;
      if (updateAppliedRef.current || updateDismissedRef.current) return;
      setShowUpdateBanner(true);
      setUpdateCountdown(20);
    });
  }, []);

  // Auto-apply the update once the countdown reaches zero.
  useEffect(() => {
    if (!showUpdateBanner) return;
    if (updateCountdown <= 0) {
      installUpdate();
      return;
    }
    const t = window.setTimeout(() => setUpdateCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [showUpdateBanner, updateCountdown, installUpdate]);

  // Refresh tree when user returns to tab — only if cache is stale (5min+)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && useAppStore.getState().isTreeCacheStale()) {
        loadTree(session?.accessToken || '');
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [session?.accessToken]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadProfile();
      // Close login modal when session is established (e.g. magic link in another tab)
      setLoginModalOpen(false);
    }
  }, [status]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
      if (exploreRef.current && !exploreRef.current.contains(e.target as Node)) {
        setExploreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ctrl+Shift+R for force reset
  useEffect(() => {
    async function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (await confirmRef.current({ message: 'Reset App? This will clear all cached data and reload.', danger: true, title: 'Force Reset' })) {
          forceResetApp();
        }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const isBrowse = pathname === '/' || pathname.startsWith('/semester');
  const isActive = (path: string) => pathname === path;
  const navItems = [
    { href: '/', match: isBrowse, icon: 'fa-book-open', label: 'Browse' },
    { href: '/routine', match: isActive('/routine'), icon: 'fa-calendar-alt', label: 'Routine' },
    { href: '/studio', match: isActive('/studio'), icon: 'fa-tools', label: 'Studio' },
    { href: '/contributors', match: isActive('/contributors'), icon: 'fa-users', label: 'Team' },
  ];

  const isFullWidthPage = pathname?.startsWith('/clubs/') && pathname !== '/clubs';

  return (
    <div className="min-h-screen bg-dark-bg text-dark-text">
      {(session as any)?.accountStatus === 'pending' && (
        <div className="bg-yellow-500/15 border-b border-yellow-500/30 px-4 py-2 text-center text-[0.8rem] font-medium text-yellow-300 flex items-center justify-center gap-3 z-[200] relative">
          <i className="fas fa-clock"></i>
          <span>Your account is pending approval — you have <strong>no access</strong> until an Admin, Manager, or Teacher approves it.</span>
          <button onClick={() => signOut({ callbackUrl: '/' })} className="px-3 py-1 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border-none cursor-pointer text-yellow-200 text-[0.75rem] font-semibold transition-colors">
            Sign Out
          </button>
        </div>
      )}
      {showUpdateBanner && (
        <div className="bg-gradient-to-r from-qsis to-accent text-white px-4 py-2 text-center text-[0.82rem] font-medium flex items-center justify-center gap-3 z-[200] relative flex-wrap">
          <i className={`fas ${installingUpdate ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
          <span>{installingUpdate ? 'Installing the latest version...' : 'New update available!'}</span>
          <button
            onClick={installUpdate}
            disabled={installingUpdate}
            className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 border-none cursor-pointer text-white text-[0.78rem] font-semibold transition-colors disabled:opacity-60 disabled:cursor-default"
          >
            {installingUpdate ? (
              <><i className="fas fa-spinner fa-spin mr-1"></i>Installing...</>
            ) : (
              <><i className="fas fa-sync-alt mr-1"></i>Update Now{updateCountdown > 0 ? ` (${updateCountdown}s)` : ''}</>
            )}
          </button>
          {!installingUpdate && (
            <button
              onClick={() => { updateDismissedRef.current = true; setShowUpdateBanner(false); }}
              className="px-2 py-1 rounded-lg bg-transparent hover:bg-white/10 border-none cursor-pointer text-white/70 text-[0.78rem] transition-colors"
            >
              Later
            </button>
          )}
        </div>
      )}
      {/* NAVBAR */}
      <nav className={`sticky top-0 z-[100] bg-dark-bg2 border-b border-dark-border wco-aware wco-drag${standalone ? ' app-titlebar' : ''}`}>
        <div className="max-w-[1200px] mx-auto px-5 py-2.5 flex items-center justify-between gap-4 tb-inner">
          <Link href="/" className="flex items-center gap-3 no-underline wco-no-drag tb-logo-wrap" onClick={(e) => { e.preventDefault(); goHome(); router.push('/'); }}>
            <Image src="/arms-logo-icon.png" alt="IIUC-ARMS" width={40} height={40} className="w-10 h-10 p-1 rounded-full border-2 border-qsis object-contain bg-white tb-logo" priority />
            <div>
              <h1 className="text-[1.1rem] font-bold bg-gradient-to-br from-qsis to-accent bg-clip-text text-transparent tb-title">IIUC-ARMS</h1>
              <span className="text-[0.7rem] text-dark-text2 hidden md:block tb-subtitle">Academic Resource System</span>
            </div>
          </Link>
          <div className="hidden md:flex items-center gap-1 wco-no-drag tb-nav">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-[5px] px-3 py-1.5 rounded-lg text-[0.78rem] font-medium border-none cursor-pointer transition-all no-underline ${item.match ? 'bg-qsis/15 text-qsis' : 'bg-transparent text-dark-text2 hover:text-dark-text hover:bg-dark-bg3'}`}
              >
                <i className={`fas ${item.icon}`}></i> {item.label}
              </Link>
            ))}
            {/* Explore dropdown */}
            <div className="relative" ref={exploreRef}>
              <button
                onClick={() => setExploreOpen(!exploreOpen)}
                className={`inline-flex items-center gap-[5px] px-3 py-1.5 rounded-lg text-[0.78rem] font-medium border-none cursor-pointer transition-all ${isActive('/faculty') || isActive('/history') || isActive('/notices') || isActive('/blog') ? 'bg-qsis/15 text-qsis' : 'bg-transparent text-dark-text2 hover:text-dark-text hover:bg-dark-bg3'}`}
                aria-haspopup="true"
                aria-expanded={exploreOpen}
              >
                <i className="fas fa-compass"></i> <span>Explore</span>
                <i className={`fas fa-chevron-down text-[0.6rem] transition-transform ${exploreOpen ? 'rotate-180' : ''}`}></i>
              </button>
              {exploreOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-dark-bg2 border border-dark-border rounded-xl shadow-2xl p-1.5 z-[110]">
                  <Link href="/notices" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-bullhorn w-4 text-center text-amber-400"></i><span>Notice Board</span>
                  </Link>
                  <Link href="/blog" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-pen-nib w-4 text-center text-emerald-400"></i><span>Blog</span>
                  </Link>
                  <Link href="/faculty" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-chalkboard-teacher w-4 text-center text-green-400"></i><span>Faculty</span>
                  </Link>
                  <Link href="/clubs" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-users w-4 text-center text-blue-400"></i><span>Clubs</span>
                  </Link>
                  <Link href="/history" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-history w-4 text-center text-orange-400"></i><span>History</span>
                  </Link>
                  <div className="border-t border-dark-border my-1"></div>
                  <Link href="/support" onClick={() => setExploreOpen(false)} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[0.78rem] hover:text-qsis hover:bg-white/5 transition-colors no-underline text-dark-text2">
                    <i className="fas fa-headset w-4 text-center text-qsis"></i><span>Support</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 wco-no-drag tb-actions">
            <button className="hidden md:inline-flex items-center gap-[5px] px-3 py-1.5 rounded-lg text-[0.78rem] font-medium border border-qsis/30 bg-qsis/10 text-qsis cursor-pointer hover:bg-qsis/20 transition-all" onClick={handleOpenUpload}>
              <i className="fas fa-upload"></i> Upload
            </button>
            {standalone && (
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  className="hidden md:inline-flex items-center gap-[5px] px-3 py-1.5 rounded-lg text-[0.78rem] font-medium border border-dark-border bg-dark-bg3 text-dark-text2 cursor-pointer hover:text-dark-text hover:bg-dark-bg2 transition-all more-trigger"
                  aria-haspopup="true"
                  aria-expanded={moreOpen}
                >
                  {status !== 'loading' && session ? (
                    <Image src={profile.image || (session as any)?.user?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent((session as any)?.user?.name || 'User')}&background=22c55e&color=fff&bold=true&size=80`} alt="" width={24} height={24} className="w-6 h-6 rounded-full border border-qsis object-cover" />
                  ) : (
                    <i className="fas fa-ellipsis-h"></i>
                  )}
                  <span>More</span>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full mt-2 w-72 max-h-[80vh] overflow-y-auto bg-dark-bg2 border border-dark-border rounded-xl shadow-2xl p-2 z-[110] text-dark-text2">
                    {status !== 'loading' && session && (
                      <>
                        <div className="flex items-center gap-3 px-2 py-2 mb-1 border-b border-dark-border">
                          <Image src={profile.image || (session as any)?.user?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent((session as any)?.user?.name || 'User')}&background=22c55e&color=fff&bold=true&size=80`} alt="" width={40} height={40} className="w-10 h-10 rounded-full border-2 border-qsis object-cover" />
                          <div className="min-w-0">
                            <p className="text-[0.8rem] font-semibold text-dark-text truncate">{(session as any)?.user?.name || 'User'}</p>
                            <p className="text-[0.68rem] text-dark-text2 truncate">{(session as any)?.user?.email || ''}</p>
                          </div>
                        </div>
                        <Link href="/dashboard" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-th-large w-4 text-center"></i><span>Dashboard</span></Link>
                        {hasAdminPanelAccess && (
                          <Link href="/admin" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-shield-alt w-4 text-center text-qsis"></i><span>Admin Panel</span></Link>
                        )}
                        <button onClick={() => { setMoreOpen(false); fetch('/api/auth/firebase-session', { method: 'DELETE' }); signOut({ callbackUrl: '/' }); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] text-red-400 hover:bg-red-500/10 transition-colors text-left bg-transparent border-none cursor-pointer"><i className="fas fa-sign-out-alt w-4 text-center"></i><span>Logout</span></button>
                        <div className="my-1 h-px bg-dark-border" />
                      </>
                    )}
                    {status !== 'loading' && !session && (
                      <>
                        <button onClick={() => { setMoreOpen(false); handleOpenLogin(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] text-qsis hover:bg-white/5 transition-colors text-left bg-transparent border-none cursor-pointer"><i className="fas fa-sign-in-alt w-4 text-center"></i><span>Sign In</span></button>
                        <div className="my-1 h-px bg-dark-border" />
                      </>
                    )}
                    <div className="px-2 pt-1 pb-1 text-[0.65rem] uppercase tracking-wider text-dark-muted font-semibold">App</div>
                    <button onClick={async () => { setMoreOpen(false); if (await confirm({ message: 'Reset App? This will clear all cached data and reload.', danger: true, title: 'Force Reset' })) forceResetApp(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] text-red-400 hover:bg-red-500/10 transition-colors text-left bg-transparent border-none cursor-pointer"><i className="fas fa-trash-alt w-4 text-center"></i><span>Reset App</span></button>
                    <button onClick={() => { setMoreOpen(false); handleCheckUpdate(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors text-left bg-transparent border-none cursor-pointer"><i className="fas fa-cloud-arrow-down w-4 text-center"></i><span>Check Update</span></button>
                    <div className="my-1 h-px bg-dark-border" />
                    <div className="px-2 pt-1 pb-1 text-[0.65rem] uppercase tracking-wider text-dark-muted font-semibold">Go To</div>
                    <Link href="/" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-home w-4 text-center"></i><span>Dashboard</span></Link>
                    <button onClick={() => { setMoreOpen(false); handleOpenUpload(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors text-left bg-transparent border-none cursor-pointer"><i className="fas fa-upload w-4 text-center"></i><span>Upload Files</span></button>
                    <Link href="/history" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-history w-4 text-center"></i><span>History</span></Link>
                    <Link href="/routine" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-calendar-alt w-4 text-center"></i><span>Routine</span></Link>
                    <Link href="/notices" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-bullhorn w-4 text-center text-amber-400"></i><span>Notice Board</span></Link>
                    <Link href="/blog" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-pen-nib w-4 text-center text-emerald-400"></i><span>Blog</span></Link>
                    <Link href="/contributors" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-users w-4 text-center"></i><span>Contributors</span></Link>
                    <Link href="/faculty" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-chalkboard-teacher w-4 text-center"></i><span>Faculty</span></Link>
                    <Link href="/clubs" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-users w-4 text-center text-blue-400"></i><span>Clubs</span></Link>
                    <Link href="/studio" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-tools w-4 text-center"></i><span>Studio</span></Link>
                    <Link href="/settings" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-cog w-4 text-center"></i><span>Settings</span></Link>
                    <div className="my-1 h-px bg-dark-border" />
                    <div className="px-2 pt-1 pb-1 text-[0.65rem] uppercase tracking-wider text-dark-muted font-semibold">Organizations</div>
                    <a href="https://www.iiuc.ac.bd/" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><Image src="/iiuc-logo.png" alt="" width={20} height={20} className="w-5 h-5 rounded object-contain bg-white" /><span className="text-[0.78rem]">IIUC</span></a>
                    <a href="https://www.facebook.com/DQSIS" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><Image src="/qsis-logo.jpg" alt="" width={20} height={20} className="w-5 h-5 rounded object-contain bg-white" /><span className="text-[0.78rem]">Qur&apos;anic Sciences Club</span></a>
                    <a href="https://programming-light.eu.cc" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><Image src="/pl-logo.png" alt="" width={20} height={20} className="w-5 h-5 rounded object-contain bg-white" /><span className="text-[0.78rem]">Programming Light</span></a>
                    <div className="my-1 h-px bg-dark-border" />
                    <div className="px-2 pt-1 pb-1 text-[0.65rem] uppercase tracking-wider text-dark-muted font-semibold">Community</div>
                    <a href="https://whatsapp.com/channel/0029VbD78MI3gvWcocoFdR1g" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><i className="fab fa-whatsapp w-4 text-center text-green-400"></i><span className="text-[0.78rem]">WhatsApp Channel</span></a>
                    <a href="https://chat.whatsapp.com/JQbkkwbDTvj9G0Xly9N771" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><i className="fab fa-whatsapp w-4 text-center text-green-400"></i><span className="text-[0.78rem]">WhatsApp Community</span></a>
                    <a href="https://t.me/iiuc_arms" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><i className="fab fa-telegram w-4 text-center text-blue-400"></i><span className="text-[0.78rem]">Telegram Channel</span></a>
                    <a href="https://t.me/iiuc_arms_chat" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><i className="fab fa-telegram w-4 text-center text-blue-400"></i><span className="text-[0.78rem]">Telegram Group</span></a>
                    <a href="https://t.me/iiuc_arms_bot" target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"><i className="fas fa-robot w-4 text-center text-blue-400"></i><span className="text-[0.78rem]">Telegram Bot</span></a>
                    <div className="my-1 h-px bg-dark-border" />
                    <div className="px-2 pt-1 pb-1 text-[0.65rem] uppercase tracking-wider text-dark-muted font-semibold"><i className="fab fa-github mr-1"></i>GitHub</div>
                    <a href={config.sourceRepoUrl()} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-star w-4 text-center text-yellow-500"></i><span>Star IIUC-ARMS v2</span></a>
                    <a href={config.dataRepoUrl()} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-star w-4 text-center text-yellow-500"></i><span>Star Academic Files</span></a>
                    <a href={`https://github.com/${config.githubStarRepos[2]?.owner}/${config.githubStarRepos[2]?.repo}`} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[0.8rem] hover:text-qsis hover:bg-white/5 transition-colors"><i className="fas fa-star w-4 text-center text-yellow-500"></i><span>Star Creative Hub</span></a>
                  </div>
                )}
              </div>
            )}
            {standalone && session && (
              <button
                onClick={() => setShowMoreSheet(true)}
                className="md:hidden cursor-pointer bg-transparent border-none p-0"
                title="Profile"
                aria-label="Profile"
              >
                <Image src={profile.image || (session as any)?.user?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent((session as any)?.user?.name || 'User')}&background=22c55e&color=fff&bold=true&size=80`} alt="" width={32} height={32} className="w-8 h-8 rounded-full border-2 border-dark-border hover:border-qsis transition-all object-cover" />
              </button>
            )}
            {standalone ? (
              status !== 'loading' && !session && (
                <button className="px-3 py-1.5 rounded-lg text-[0.78rem] font-medium bg-qsis text-white border-none cursor-pointer hover:opacity-90 transition-opacity" onClick={handleOpenLogin}>
                  <i className="fas fa-sign-in-alt mr-1.5"></i> Sign In
                </button>
              )
            ) : (
              <>
                {status === 'loading' ? (
                  <div className="w-9 h-9 rounded-full bg-dark-bg3 animate-pulse"></div>
                ) : session ? (
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                      className="cursor-pointer bg-transparent border-none p-0 mt-2"
                    >
                      <Image src={profile.image || (session as any)?.user?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent((session as any)?.user?.name || 'User')}&background=22c55e&color=fff&bold=true&size=80`} alt="" width={36} height={36} className="w-9 h-9 rounded-full border-2 border-dark-border hover:border-qsis transition-all object-cover" />
                    </button>
                    {profileDropdownOpen && (
                      <div className="absolute right-0 top-full mt-2 w-48 bg-dark-bg2 border border-dark-border rounded-xl shadow-lg py-2 z-[110]">
                        <div className="px-4 py-2 border-b border-dark-border">
                          <p className="text-[0.78rem] font-semibold text-dark-text truncate">{(session as any)?.user?.name || 'User'}</p>
                          <p className="text-[0.68rem] text-dark-text2 truncate">{(session as any)?.user?.email || ''}</p>
                        </div>
                        <button
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[0.8rem] text-dark-text hover:bg-dark-bg3 cursor-pointer bg-transparent border-none text-left transition-colors"
                          onClick={() => { setProfileDropdownOpen(false); router.push('/dashboard'); }}
                        >
                          <i className="fas fa-th-large w-4 text-center text-dark-text2"></i> Dashboard
                        </button>
                        {hasAdminPanelAccess && (
                          <button
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[0.8rem] text-dark-text hover:bg-dark-bg3 cursor-pointer bg-transparent border-none text-left transition-colors"
                            onClick={() => { setProfileDropdownOpen(false); router.push('/admin'); }}
                          >
                            <i className="fas fa-shield-alt w-4 text-center text-qsis"></i> Admin Panel
                          </button>
                        )}
                        <button
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[0.8rem] text-red-400 hover:bg-red-500/10 cursor-pointer bg-transparent border-none text-left transition-colors"
                          onClick={() => { setProfileDropdownOpen(false); fetch('/api/auth/firebase-session', { method: 'DELETE' }); signOut({ callbackUrl: '/' }); }}
                        >
                          <i className="fas fa-sign-out-alt w-4 text-center"></i> Logout
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button className="px-3 py-1.5 rounded-lg text-[0.78rem] font-medium bg-qsis text-white border-none cursor-pointer hover:opacity-90 transition-opacity" onClick={handleOpenLogin}>
                    <i className="fas fa-sign-in-alt mr-1.5"></i> Sign In
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className={`${isFullWidthPage ? 'min-h-[calc(100vh-60px)] pb-24 md:pb-0' : 'max-w-[1200px] min-h-[calc(100vh-120px)] mx-auto px-5 py-5 pb-24 md:pb-5'}`}>
        {children}
      </main>

      {/* MOBILE BOTTOM NAV */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-[90] bg-dark-bg2 border-t border-dark-border safe-bottom">
        <div className="flex items-center justify-around py-2 px-1">
          <Link href="/" className={`flex flex-col items-center gap-[2px] px-2 py-1 rounded-lg border-none cursor-pointer transition-all no-underline ${isBrowse ? 'bg-qsis/15 text-qsis' : 'bg-transparent text-dark-text2'}`}>
            <i className="fas fa-book-open text-[1rem]"></i>
            <span className="text-[0.62rem] font-medium">Browse</span>
          </Link>
          <Link href="/routine" className={`flex flex-col items-center gap-[2px] px-2 py-1 rounded-lg border-none cursor-pointer transition-all no-underline ${isActive('/routine') ? 'bg-qsis/15 text-qsis' : 'bg-transparent text-dark-text2'}`}>
            <i className="fas fa-calendar-alt text-[1rem]"></i>
            <span className="text-[0.62rem] font-medium">Routine</span>
          </Link>
          <button className="flex flex-col items-center gap-[2px] px-2 py-1 rounded-lg border-none cursor-pointer transition-all bg-transparent text-qsis" onClick={handleOpenUpload}>
            <div className="w-9 h-9 -mt-4 rounded-full bg-qsis flex items-center justify-center shadow-lg shadow-qsis/30">
              <i className="fas fa-plus text-white text-[0.9rem]"></i>
            </div>
            <span className="text-[0.62rem] font-medium">Upload</span>
          </button>
          <Link href="/studio" className={`flex flex-col items-center gap-[2px] px-2 py-1 rounded-lg border-none cursor-pointer transition-all no-underline ${isActive('/studio') ? 'bg-qsis/15 text-qsis' : 'bg-transparent text-dark-text2'}`}>
            <i className="fas fa-tools text-[1rem]"></i>
            <span className="text-[0.62rem] font-medium">Studio</span>
          </Link>
          <button className={`flex flex-col items-center gap-[2px] px-2 py-1 rounded-lg border-none cursor-pointer transition-all bg-transparent ${showMoreSheet ? 'text-qsis' : 'text-dark-text2'}`} onClick={() => setShowMoreSheet(!showMoreSheet)}>
            <i className="fas fa-ellipsis-h text-[1rem]"></i>
            <span className="text-[0.62rem] font-medium">More</span>
          </button>
        </div>
      </div>

      {/* MOBILE MORE SHEET */}
      {showMoreSheet && (
        <div className="md:hidden fixed inset-0 z-[95]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMoreSheet(false)}></div>
          <div className="absolute bottom-0 left-0 right-0 bg-dark-bg2 border-t border-dark-border rounded-t-2xl max-h-[80vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border sticky top-0 bg-dark-bg2 z-10">
              <span className="text-sm font-bold text-dark-text">More</span>
              <button onClick={() => setShowMoreSheet(false)} className="w-8 h-8 rounded-full bg-dark-bg3 flex items-center justify-center text-dark-text2 border-none cursor-pointer">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="p-4 space-y-5">
              {status !== 'loading' && session ? (
                <div className="bg-dark-bg3 border border-dark-border rounded-2xl p-3">
                  <div className="flex items-center gap-3">
                    <Image src={profile.image || (session as any)?.user?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent((session as any)?.user?.name || 'User')}&background=22c55e&color=fff&bold=true&size=80`} alt="" width={44} height={44} className="w-11 h-11 rounded-full border-2 border-qsis object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.85rem] font-semibold text-dark-text truncate">{(session as any)?.user?.name || 'User'}</p>
                      <p className="text-[0.7rem] text-dark-text2 truncate">{(session as any)?.user?.email || ''}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link href="/dashboard" onClick={() => setShowMoreSheet(false)} className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-qsis/15 border border-qsis/30 text-qsis text-[0.78rem] font-semibold no-underline hover:bg-qsis/25 transition-colors">
                      <i className="fas fa-th-large"></i> Dashboard
                    </Link>
                    {hasAdminPanelAccess && (
                      <Link href="/admin" onClick={() => setShowMoreSheet(false)} className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[0.78rem] font-semibold no-underline hover:bg-purple-500/25 transition-colors">
                        <i className="fas fa-shield-alt"></i> Admin Panel
                      </Link>
                    )}
                  </div>
                  <button
                    onClick={() => { setShowMoreSheet(false); fetch('/api/auth/firebase-session', { method: 'DELETE' }); signOut({ callbackUrl: '/' }); }}
                    className="w-full mt-2 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[0.78rem] font-medium hover:bg-red-500/20 transition-colors cursor-pointer"
                  >
                    <i className="fas fa-sign-out-alt"></i> Logout
                  </button>
                </div>
              ) : status !== 'loading' ? (
                <div className="bg-dark-bg3 border border-dark-border rounded-2xl p-3">
                  <button
                    onClick={() => { setShowMoreSheet(false); handleOpenLogin(); }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-qsis text-white text-[0.8rem] font-semibold cursor-pointer border-none hover:opacity-90 transition-opacity"
                  >
                    <i className="fas fa-sign-in-alt"></i> Sign In
                  </button>
                </div>
              ) : null}
              {/* Features — native app style icon grid */}
              <div>
                <h4 className="text-[0.75rem] font-bold text-dark-text3 uppercase tracking-wider mb-2">Features</h4>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    ['home', '/', 'fas fa-house', 'bg-blue-500/15', 'text-blue-400', 'Browse', true, 'link'],
                    ['upload', '', 'fas fa-upload', 'bg-green-500/15', 'text-green-400', 'Upload', false, 'upload'],
                    ['routine', '/routine', 'fas fa-calendar-days', 'bg-purple-500/15', 'text-purple-400', 'Routine', true, 'link'],
                    ['notices', '/notices', 'fas fa-bullhorn', 'bg-amber-500/15', 'text-amber-400', 'Notices', true, 'link'],
                    ['blog', '/blog', 'fas fa-pen-nib', 'bg-emerald-500/15', 'text-emerald-400', 'Blog', true, 'link'],
                    ['studio', '/studio', 'fas fa-tools', 'bg-orange-500/15', 'text-orange-400', 'Studio', true, 'link'],
                    ['history', '/history', 'fas fa-clock-rotate-left', 'bg-yellow-500/15', 'text-yellow-400', 'History', true, 'link'],
                    ['team', '/contributors', 'fas fa-users', 'bg-pink-500/15', 'text-pink-400', 'Team', true, 'link'],
                    ['clubs', '/clubs', 'fas fa-shield-halved', 'bg-qsis/15', 'text-qsis', 'Clubs', true, 'link'],
                    ['faculty', '/faculty', 'fas fa-chalkboard-user', 'bg-teal-500/15', 'text-teal-400', 'Faculty', true, 'link'],
                    ['support', '/support', 'fas fa-headset', 'bg-red-500/15', 'text-red-400', 'Support', true, 'link'],
                  ] as const).map(([key, href, icon, bg, color, label, isLink, kind]) => {
                    const cls = `flex flex-col items-center gap-1.5 p-2.5 rounded-2xl bg-dark-bg3 border border-dark-border transition-colors no-underline ${kind === 'link' ? 'hover:border-qsis/40' : kind === 'upload' ? 'hover:border-green-500/40' : 'hover:border-slate-400/40'}`;
                    const inner = (
                      <>
                        <div className={`w-12 h-12 rounded-2xl ${bg} flex items-center justify-center`}>
                          <i className={`${icon} ${color} text-lg`}></i>
                        </div>
                        <span className="text-[0.6rem] text-dark-text font-medium">{label}</span>
                      </>
                    );
                    if (kind === 'link') return (
                      <Link key={key} href={href} onClick={() => setShowMoreSheet(false)} className={cls}>{inner}</Link>
                    );
                    if (kind === 'upload') return (
                      <button key={key} onClick={() => { handleOpenUpload(); setShowMoreSheet(false); }} className={`${cls} cursor-pointer`}>{inner}</button>
                    );
                    return null;
                  })}
                </div>
              </div>
              {/* GitHub Repos */}
              <div>
                <h4 className="text-[0.75rem] font-bold text-dark-text3 uppercase tracking-wider mb-2"><i className="fab fa-github mr-1"></i>Star Our Repos</h4>
                <p className="text-[0.68rem] text-dark-text3 mb-3">If this project helps you, give us a star — it motivates us to keep building for the IIUC community.</p>
                <div className="space-y-2">
                  {config.githubStarRepos.map((repo, i) => (
                    <a key={i} href={`https://github.com/${repo.owner}/${repo.repo}`} target="_blank" rel="noopener noreferrer" onClick={() => setShowMoreSheet(false)} className="flex items-center gap-3 p-3 rounded-xl bg-dark-bg3 border border-dark-border hover:border-slate-400/40 transition-colors w-full">
                      <div className="w-10 h-10 rounded-xl bg-slate-500/15 flex items-center justify-center flex-shrink-0"><i className="fab fa-github text-slate-300 text-lg"></i></div>
                      <div className="min-w-0 flex-1">
                        <span className="text-[0.78rem] font-semibold text-dark-text block">{repo.label}</span>
                        <span className="text-[0.65rem] text-dark-text3 block">{repo.description}</span>
                        {repo.tags && <span className="mt-0.5 inline-block text-[0.58rem] text-dark-text3 opacity-70">{repo.tags}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
              {/* Organizations */}
              <div>
                <h4 className="text-[0.75rem] font-bold text-dark-text3 uppercase tracking-wider mb-2">Organizations</h4>
                <div className="space-y-2">
                  <a href="https://www.iiuc.ac.bd/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-qsis/40 transition-colors">
                    <Image src="/iiuc-logo.png" alt="IIUC" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                    <span className="text-[0.78rem] text-dark-text">International Islamic University Chittagong</span>
                  </a>
                  <a href="https://www.facebook.com/DQSIS" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-qsis/40 transition-colors">
                    <Image src="/qsis-logo.jpg" alt="QS Club" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                    <span className="text-[0.78rem] text-dark-text">Qur&apos;anic Sciences Club, IIUC</span>
                  </a>
                  <a href="https://programming-light.eu.cc" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-qsis/40 transition-colors">
                    <Image src="/pl-logo.png" alt="Programming Light" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                    <span className="text-[0.78rem] text-dark-text">Presented by <strong className="text-qsis">Programming Light</strong></span>
                  </a>
                </div>
              </div>
              {/* Community */}
              <div>
                <h4 className="text-[0.75rem] font-bold text-dark-text3 uppercase tracking-wider mb-2">Community</h4>
                <div className="space-y-2">
                  <a href="https://whatsapp.com/channel/0029VbD78MI3gvWcocoFdR1g" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-green-500/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-green-500/20 flex items-center justify-center"><i className="fab fa-whatsapp text-green-400 text-sm"></i></div>
                    <div>
                      <span suppressHydrationWarning className="text-[0.78rem] text-dark-text block">WhatsApp Channel</span>
                      <span className="text-[0.6rem] text-dark-text3">Follow for updates & announcements</span>
                    </div>
                  </a>
                  <a href="https://chat.whatsapp.com/JQbkkwbDTvj9G0Xly9N771" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-green-500/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-green-500/20 flex items-center justify-center"><i className="fab fa-whatsapp text-green-400 text-sm"></i></div>
                    <div>
                      <span suppressHydrationWarning className="text-[0.78rem] text-dark-text block">WhatsApp Community</span>
                      <span className="text-[0.6rem] text-dark-text3">Join groups & stay connected</span>
                    </div>
                  </a>
                  <a href="https://t.me/iiuc_arms" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-blue-500/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fab fa-telegram text-blue-400 text-sm"></i></div>
                    <div>
                      <span className="text-[0.78rem] text-dark-text block">Telegram Channel</span>
                      <span className="text-[0.6rem] text-dark-text3">Announcements & updates</span>
                    </div>
                  </a>
                  <a href="https://t.me/iiuc_arms_chat" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-blue-500/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fab fa-telegram text-blue-400 text-sm"></i></div>
                    <div>
                      <span className="text-[0.78rem] text-dark-text block">Telegram Group</span>
                      <span className="text-[0.6rem] text-dark-text3">Discuss & get support</span>
                    </div>
                  </a>
                  <a href="https://t.me/iiuc_arms_bot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-xl bg-dark-bg3 border border-dark-border hover:border-blue-500/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fas fa-robot text-blue-400 text-sm"></i></div>
                    <div>
                      <span className="text-[0.78rem] text-dark-text block">Telegram Bot</span>
                      <span className="text-[0.6rem] text-dark-text3">Search & manage resources</span>
                    </div>
                  </a>
                </div>
              </div>
              {/* About */}
              <div className="text-center pt-2 border-t border-dark-border">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Image src="/arms-logo-icon.png" alt="IIUC-ARMS" width={24} height={24} className="w-6 h-6 rounded-full border border-qsis object-contain bg-white" />
                  <span className="text-[0.82rem] font-bold bg-gradient-to-br from-qsis to-accent bg-clip-text text-transparent">IIUC-ARMS</span>
                </div>
                <p className="text-[0.65rem] text-dark-text3 leading-relaxed">Academic resource &amp; research management<br/>system for IIUC departments.</p>
                <p className="text-[0.6rem] text-dark-text3 mt-2">&copy; {new Date().getFullYear()} IIUC-ARMS</p>
              </div>
              {/* Reset App */}
              <button
                onClick={async () => { if (await confirm({ message: 'Reset App? This will clear all cached data and reload.', danger: true, title: 'Force Reset' })) forceResetApp(); }}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer text-[0.8rem] font-medium"
              >
                <i className="fas fa-trash-alt"></i> Reset App {!standalone && <span className="text-[0.62rem] opacity-60">(Ctrl+Shift+R)</span>}
              </button>
              {/* Check Update */}
              <button
                onClick={handleCheckUpdate}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-qsis/10 border border-qsis/20 text-qsis hover:bg-qsis/20 transition-colors cursor-pointer text-[0.8rem] font-medium"
              >
                <i className="fas fa-cloud-arrow-down"></i> Check Update
              </button>
              {/* Install App */}
              <div className="w-full flex items-center justify-center">
                <InstallAppButton />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER — hidden on mobile + admin/dashboard pages + installed (standalone) app,
          where its contents are surfaced via the desktop "More" menu instead. */}
      {!pathname?.startsWith('/dashboard') && !pathname?.startsWith('/admin') && !standalone && (
      <footer className="hidden md:block bg-dark-bg2 border-t border-dark-border mt-8">
        <div className="max-w-[1200px] mx-auto px-5 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Image src="/arms-logo-icon.png" alt="IIUC-ARMS" width={36} height={36} className="w-9 h-9 rounded-full border-2 border-qsis object-contain bg-white" />
                <div>
                  <h3 className="text-[0.95rem] font-bold bg-gradient-to-br from-qsis to-accent bg-clip-text text-transparent">IIUC-ARMS</h3>
                  <span className="text-[0.68rem] text-dark-text2">Academic Resource &amp; Research System</span>
                </div>
              </div>
              <p className="text-[0.8rem] text-dark-text2 leading-relaxed">A centralized platform for managing and sharing academic resources across all IIUC departments, with built-in research toolkit for scholars and students.</p>
            </div>
            <div>
              <h4 className="text-[0.85rem] font-semibold text-dark-text mb-3">Quick Links</h4>
              <div className="flex flex-col gap-2">
                <Link href="/" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-home mr-2"></i>Dashboard</Link>
                <button className="text-[0.8rem] text-dark-text2 hover:text-qsis text-left bg-transparent border-none cursor-pointer transition-colors" onClick={handleOpenUpload}><i className="fas fa-upload mr-2"></i>Upload Files</button>
                <Link href="/history" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-history mr-2"></i>History</Link>
                <Link href="/routine" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-calendar-alt mr-2"></i>Routine</Link>
                <Link href="/notices" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-bullhorn mr-2 text-amber-400"></i>Notice Board</Link>
                <Link href="/blog" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-pen-nib mr-2 text-emerald-400"></i>Blog</Link>
                <Link href="/contributors" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-users mr-2"></i>Contributors</Link>
                <Link href="/faculty" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-chalkboard-teacher mr-2"></i>Faculty</Link>
                <Link href="/clubs" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-users mr-2 text-blue-400"></i>Clubs</Link>
               <Link href="/studio" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-tools mr-2"></i>Studio</Link>
               <Link href="/settings" className="text-[0.8rem] text-dark-text2 hover:text-qsis no-underline transition-colors"><i className="fas fa-cog mr-2"></i>Settings</Link>
              </div>
            </div>
            <div>
              <h4 className="text-[0.85rem] font-semibold text-dark-text mb-3"><i className="fab fa-github mr-1.5"></i>GitHub</h4>
              <div className="flex flex-col gap-2.5">
                <a href={config.sourceRepoUrl()} target="_blank" rel="noopener noreferrer" className="text-[0.8rem] text-dark-text2 hover:text-qsis transition-colors"><i className="fas fa-star mr-2 text-yellow-500"></i>Star IIUC-ARMS v2</a>
                <a href={config.dataRepoUrl()} target="_blank" rel="noopener noreferrer" className="text-[0.8rem] text-dark-text2 hover:text-qsis transition-colors"><i className="fas fa-star mr-2 text-yellow-500"></i>Star Academic Files</a>
                <a href={`https://github.com/${config.githubStarRepos[2]?.owner}/${config.githubStarRepos[2]?.repo}`} target="_blank" rel="noopener noreferrer" className="text-[0.8rem] text-dark-text2 hover:text-qsis transition-colors"><i className="fas fa-star mr-2 text-yellow-500"></i>Star Creative Hub</a>
              </div>
            </div>
            <div>
              <h4 className="text-[0.85rem] font-semibold text-dark-text mb-3">Organizations</h4>
              <div className="flex flex-col gap-2.5">
                <a href="https://www.iiuc.ac.bd/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <Image src="/iiuc-logo.png" alt="IIUC" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-qsis transition-colors">International Islamic University Chittagong</span>
                </a>
                <a href="https://www.facebook.com/DQSIS" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <Image src="/qsis-logo.jpg" alt="Qur&apos;anic Sciences Club" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-qsis transition-colors">Qur&apos;anic Sciences Club, IIUC</span>
                </a>
              </div>
              <div className="mt-4 pt-3 border-t border-dark-border">
                <a href="https://programming-light.eu.cc" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <Image src="/pl-logo.png" alt="Programming Light" width={28} height={28} className="w-7 h-7 rounded-md object-contain bg-white" />
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-qsis transition-colors">Presented by <strong className="text-qsis">Programming Light</strong></span>
                </a>
              </div>
            </div>
            <div>
              <h4 className="text-[0.85rem] font-semibold text-dark-text mb-3">Community</h4>
              <div className="flex flex-col gap-2.5">
                <a href="https://whatsapp.com/channel/0029VbD78MI3gvWcocoFdR1g" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <div className="w-7 h-7 rounded-md bg-green-500/20 flex items-center justify-center"><i className="fab fa-whatsapp text-green-400 text-sm"></i></div>
                  <span suppressHydrationWarning className="text-[0.78rem] text-dark-text2 group-hover:text-green-400 transition-colors">WhatsApp Channel</span>
                </a>
                <a href="https://chat.whatsapp.com/JQbkkwbDTvj9G0Xly9N771" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <div className="w-7 h-7 rounded-md bg-green-500/20 flex items-center justify-center"><i className="fab fa-whatsapp text-green-400 text-sm"></i></div>
                  <span suppressHydrationWarning className="text-[0.78rem] text-dark-text2 group-hover:text-green-400 transition-colors">WhatsApp Community</span>
                </a>
                <p className="text-[0.62rem] text-dark-text3 mt-0.5 ml-9.5">
                  <i className="fas fa-info-circle mr-1 text-green-400/60"></i>Your info stays hidden until you join a group
                </p>
                <a href="https://t.me/iiuc_arms" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fab fa-telegram text-blue-400 text-sm"></i></div>
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-blue-400 transition-colors">Telegram Channel</span>
                </a>
                <a href="https://t.me/iiuc_arms_chat" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fab fa-telegram text-blue-400 text-sm"></i></div>
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-blue-400 transition-colors">Telegram Group</span>
                </a>
                <a href="https://t.me/iiuc_arms_bot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
                  <div className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><i className="fas fa-robot text-blue-400 text-sm"></i></div>
                  <span className="text-[0.78rem] text-dark-text2 group-hover:text-blue-400 transition-colors">Telegram Bot</span>
                </a>
              </div>
              <p className="text-[0.65rem] text-dark-text3 mt-2">Get updates &amp; discuss support</p>
            </div>
          </div>
          <div className="border-t border-dark-border mt-6 pt-5 pb-8  flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[0.72rem] text-dark-text2">&copy; {new Date().getFullYear()} IIUC-ARMS. All rights reserved.</p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              <InstallAppButton />
              <button
                onClick={async () => { if (await confirm({ message: 'Reset App? This will clear all cached data and reload.', danger: true, title: 'Force Reset' })) forceResetApp(); }}
                className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[0.65rem] sm:text-[0.72rem] text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                title="Force Reset App (Ctrl+Shift+R)"
              >
                <i className="fas fa-trash-alt"></i> Reset App
              </button>
              <button
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-qsis/10 border border-qsis/20 text-[0.65rem] sm:text-[0.72rem] text-qsis hover:bg-qsis/20 transition-all cursor-pointer"
                title="Check for new updates and install them"
              >
                <i className="fas fa-cloud-arrow-down"></i> Check Update
              </button>
              <a href={config.dataRepoUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-dark-bg3 border border-dark-border text-[0.65rem] sm:text-[0.72rem] text-dark-text2 hover:text-qsis hover:border-qsis transition-all">
                <i className="fas fa-star text-yellow-500"></i> Star Files Repo
              </a>
              <a href={config.dataRepoUrl('/fork')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-dark-bg3 border border-dark-border text-[0.65rem] sm:text-[0.72rem] text-dark-text2 hover:text-qsis hover:border-qsis transition-all">
                <i className="fas fa-code-fork text-qsis"></i> Fork to Contribute
              </a>
              <a href={config.sourceRepoUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-dark-bg3 border border-dark-border text-[0.65rem] sm:text-[0.72rem] text-dark-text2 hover:text-qsis hover:border-qsis transition-all">
                <i className="fab fa-github"></i> Source Code
              </a>
            </div>
          </div>
        </div>
      </footer>
      )}

      {/* FLOATING UPLOAD INDICATOR — shown when upload runs in background */}
      {uploadBg?.active && !uploadOpen && (
        <button
          onClick={() => setUploadOpen(true)}
          className="fixed bottom-5 right-5 z-[190] bg-qsis text-white rounded-xl px-4 py-3 shadow-lg shadow-qsis/20 border border-qsis/50 flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform"
        >
          <i className="fas fa-spinner fa-spin text-sm"></i>
          <div className="flex flex-col items-start text-left">
            <span className="text-[0.72rem] font-semibold truncate max-w-[180px]">{uploadBg.progress?.label || 'Uploading...'}</span>
            {uploadBg.progress && uploadBg.progress.percent > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="w-20 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <span className="block h-full bg-white rounded-full transition-all" style={{ width: `${Math.max(3, uploadBg.progress.percent)}%` }}></span>
                </span>
                <span className="text-[0.65rem] font-bold tabular-nums">{Math.round(uploadBg.progress.percent)}%</span>
              </div>
            )}
          </div>
        </button>
      )}
      {uploadBg?.result && !uploadBg?.active && !uploadOpen && (
        <button
          onClick={() => {
            if (uploadBg.result?.success) useAppStore.getState().setUploadBg(null);
            else setUploadOpen(true);
          }}
          className={`fixed bottom-5 right-5 z-[190] rounded-xl px-4 py-3 shadow-lg border flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform ${
            uploadBg.result.success
              ? 'bg-emerald-600 text-white border-emerald-500/50 shadow-emerald-600/20'
              : 'bg-red-600 text-white border-red-500/50 shadow-red-600/20'
          }`}
        >
          <i className={`fas ${uploadBg.result.success ? 'fa-check-circle' : 'fa-exclamation-circle'} text-sm`}></i>
          <span className="text-[0.75rem] font-semibold">
            {uploadBg.result.success ? 'Upload complete — tap to dismiss' : (uploadBg.result.error?.slice(0, 60) || 'Upload failed — tap to retry')}
          </span>
        </button>
      )}

      {/* UPLOAD MODAL */}
      {uploadOpen && <UploadModal
        session={session}
        status={status}
        profile={profile}
        onLogin={() => { setUploadOpen(false); handleOpenLogin(); }}
        onClose={() => setUploadOpen(false)}
      />}

      {/* PAT PROMPT (GitHub connect) */}
      {patPromptOpen && (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" onClick={() => setPatPromptOpen(false)}>
          <div className="bg-dark-bg2 w-full max-w-[420px] rounded-2xl border border-dark-border p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[0.95rem] font-bold text-dark-text flex items-center gap-2">
                {patPromptWarn
                  ? <><i className="fas fa-exclamation-triangle text-amber-400"></i> One Last Reminder</>
                  : <><i className="fab fa-github text-purple-400"></i> Connect GitHub</>}
              </h3>
              <button className="w-7 h-7 rounded-lg bg-dark-bg3 border border-dark-border flex items-center justify-center text-dark-text2 cursor-pointer hover:text-dark-text" onClick={() => setPatPromptOpen(false)}>
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>

            {patPromptWarn && (
              <div className="mb-3">
                <p className="text-[0.72rem] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-2">
                  <i className="fas fa-exclamation-triangle mr-1"></i>
                  You&apos;ve skipped connecting GitHub a few times. This is the last time we&apos;ll ask — you can dismiss it forever below.
                </p>
                <p className="text-[0.72rem] text-dark-text2 bg-purple-500/10 border border-purple-500/25 rounded-lg p-2.5">
                  <i className="fas fa-graduation-cap mr-1 text-purple-400"></i>
                  <strong className="text-dark-text">Why it matters:</strong> every upload you make is real academic work. Linked to your own GitHub profile, it builds a verifiable contribution history — which many <strong className="text-dark-text">international scholarship committees</strong> review to judge applicants. Skipping this means your work stays invisible and won&apos;t strengthen your scholarship profile.
                </p>
              </div>
            )}

            <p className="text-[0.75rem] text-dark-text2 mb-3">
              You&apos;re not connected to GitHub. Uploads via the shared account won&apos;t show your name on the <strong className="text-dark-text">Contributors list</strong>. Paste your <strong className="text-dark-text">Personal Access Token (PAT)</strong> to get credit, or continue anyway.
            </p>

            <label className="text-[0.7rem] text-dark-text2 block mb-1">GitHub Personal Access Token</label>
            <input
              type="password"
              placeholder="ghp_xxxxxxxxxxxx or github_pat_xxxx"
              className="w-full px-3 py-2.5 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] font-mono outline-none focus:border-qsis mb-2"
              value={patInputToken}
              onChange={e => setPatInputToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePatSaveAndContinue()}
            />
            <a href="https://github.com/settings/tokens/new?scopes=repo,user:follow&description=IIUC-ARMS" target="_blank" rel="noopener noreferrer" className="text-[0.65rem] text-qsis hover:underline inline-block mb-3">
              Create a classic token — Note <code className="bg-dark-bg3 px-1 rounded">IIUC-ARMS</code> and <code className="bg-dark-bg3 px-1 rounded">repo</code> scope are pre-filled
            </a>

            <button
              className="w-full py-2.5 rounded-xl bg-qsis text-white text-[0.82rem] font-semibold border-none cursor-pointer hover:opacity-90 disabled:opacity-50 mb-2"
              onClick={handlePatSaveAndContinue}
              disabled={patSaving || !patInputToken.trim()}
            >
              {patSaving ? <><i className="fas fa-spinner fa-spin mr-1"></i>Saving...</> : <><i className="fab fa-github mr-2"></i>Connect & Upload</>}
            </button>
            <button
              className="w-full py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text2 text-[0.82rem] font-semibold cursor-pointer hover:bg-dark-bg2 transition-colors"
              onClick={handlePatUploadAnyway}
            >
              Upload Anyway
            </button>
            {patPromptWarn && (
              <button
                className="w-full mt-2 py-2.5 rounded-xl border border-amber-500/40 text-amber-400 text-[0.82rem] font-semibold cursor-pointer hover:bg-amber-500/10 transition-colors"
                onClick={handlePatSkipForever}
              >
                <i className="fas fa-check-circle mr-2"></i>Skip Forever — Don&apos;t Ask Again
              </button>
            )}
          </div>
        </div>
      )}

      {/* VIEWER OVERLAY */}
      {viewerOpen && viewerItem && (
        <div className="viewer-overlay active">
          <div className="viewer-container">
            <DocumentViewer item={viewerItem} onClose={closeViewer} />
          </div>
        </div>
      )}

      {/* ONBOARDING MODAL */}
      {showOnboarding && (
        <OnboardingModal
          initialDept={profile.department || undefined}
          initialSemester={profile.semester ? (config.semesters.find(s => s.id === profile.semester)?.label || profile.semester) : undefined}
          onComplete={(data) => {
            setStoreOnboarding(data);
            dismissOnboarding();
            setShowOnboarding(false);
            setOnboardingDone(true);
            // Bidirectional sync: save department + semester + gender to server profile
            const semId = config.semesters.find(s => s.label === data.semester)?.id || data.semester;
            updateProfile({ department: data.department, semester: semId, gender: data.gender });
          }}
          onClose={() => { dismissOnboarding(); setShowOnboarding(false); setOnboardingDone(true); }}
        />
      )}

      {/* Pre-rendered Turnstile (hidden, starts verifying immediately) */}
      <div className="fixed top-0 left-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
        <div id={turnstileContainerId}></div>
      </div>

      {/* LOGIN MODAL */}
      <LoginModal isOpen={loginModalOpen} onClose={() => setLoginModalOpen(false)} preRenderedTurnstileContainer={preRenderedTurnstile ? turnstileContainerId : undefined} />
      {confirmDialog}

      {/* GLOBAL OPERATION PROGRESS (delete / rename / create course) */}
      <OperationProgress label={operationLabel} />

      {/* GLOBAL FLOATING FOCUS TIMER — hidden on /focus page (iframe has its own) */}
      {pathname !== '/focus' && <FloatingFocus />}
    </div>
  );
}