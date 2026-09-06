import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '@/lib/get-user';
import { config } from '@/lib/config';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { invalidatePermissionsCache } from '@/lib/permissions';
import { canApprovePending } from '@/lib/permissions';
import { invalidateStatusCache } from '@/lib/auth-options';
import { addDeletedEmail, removeDeletedEmail } from '@/lib/deleted-emails';

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.admin);
  if (!rl.success) return rl.response!;
  try {
    const email = await getUserEmail(req);
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const effectiveRole = config.getEffectiveRole(email);
    const isApprover = await canApprovePending(email, effectiveRole);
    if (effectiveRole !== 'admin' && effectiveRole !== 'manager' && !isApprover) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { prisma } = await import('@/lib/prisma');

    let callerDept: string | null = null;
    let callerGender: string | null = null;
    try {
      const callerProfile = await prisma.profile.findUnique({ where: { userId: email } });
      callerDept = callerProfile?.department || null;
      callerGender = callerProfile?.gender || null;
    } catch (e: any) {
      console.error('[Admin Users] Caller profile fetch failed:', e?.message);
    }

    const url = new URL(req.url);
    const filterRole = url.searchParams.get('role');
    const filterSemester = url.searchParams.get('semester');
    const filterDept = url.searchParams.get('department');
    const filterDomain = url.searchParams.get('domain');
    const filterAccountStatus = url.searchParams.get('accountStatus');
    const filterGender = url.searchParams.get('gender');
    const search = url.searchParams.get('search') || '';

    // Gender-personalized Pending list: by default a manager sees the requests
    // that match their own gender (male managers → male pending, female managers
    // → female pending). Accounts with no gender recorded are still shown in both
    // views so nothing ever gets stuck hidden. An explicit `gender` param
    // overrides the default so the admins can still browse/analyze everyone.
    let effectivePendingGender: 'male' | 'female' | null = null;
    if (filterDomain === 'pending') {
      if (filterGender === 'male' || filterGender === 'female') {
        effectivePendingGender = filterGender;
      } else if (!filterGender) {
        effectivePendingGender = callerGender === 'male' || callerGender === 'female' ? callerGender : null;
      }
    }
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    const where: any = {};
    if (filterRole && filterRole !== 'all') {
      where.role = filterRole;
    }
    if (filterSemester && filterSemester !== 'all') {
      where.semester = filterSemester;
    }
    if (filterDept && filterDept !== 'all') {
      where.department = filterDept;
    }
    if (filterDomain && filterDomain !== 'all') {
      if (filterDomain === 'student') {
        // Students = @ugrad.iiuc.ac.bd email OR any account assigned role 'student'
        // (e.g. an external applicant promoted to Student), never pending
        where.AND = [...(where.AND || []), {
          OR: [
            { email: { endsWith: '@ugrad.iiuc.ac.bd' } },
            { role: 'student' },
          ],
        }];
        where.accountStatus = { notIn: ['pending', 'rejected'] };
      } else if (filterDomain === 'teacher') {
        // Teachers = faculty email domain (@iiuc.ac.bd, NOT @ugrad student) OR role 'teacher'
        // @ugrad.iiuc.ac.bd students never appear, regardless of role
        where.AND = [...(where.AND || []), {
          OR: [
            { email: { endsWith: '@iiuc.ac.bd', not: { endsWith: '@ugrad.iiuc.ac.bd' } } },
            { role: 'teacher', email: { not: { endsWith: '@ugrad.iiuc.ac.bd' } } },
          ],
        }];
        where.accountStatus = { notIn: ['pending', 'rejected'] };
      } else if (filterDomain === 'external') {
        // External is NOT a role — it's a grouping of every non-university
        // account (holders of Gmail/Yahoo/etc.), regardless of the role they
        // were given. This is how the admin sees how many outside accounts are
        // using the platform and manages them in one place. Pending/rejected
        // accounts have their own list.
        where.email = { not: { endsWith: '.iiuc.ac.bd' } };
        where.accountStatus = 'active';
      } else if (filterDomain === 'pending') {
        // Pending = accounts waiting to be approved: a non-university account
        // with a pending-request profile (or a Firebase account with no profile
        // at all) that hasn't been given a role yet. Approving (action
        // `approve`), assigning a role, or granting CR/ACR sets accountStatus to
        // 'active', which automatically removes the account from this list.
        where.email = {
          not: { endsWith: '.iiuc.ac.bd' },
          notIn: config.ownerEmails.map(e => e.toLowerCase()),
        };
        where.accountStatus = 'pending';
        where.isCR = false;
        where.isACR = false;
        where.role = { in: ['user', 'external', null] };
        where.AND = [...(where.AND || []), {
          OR: [{ role: 'user' }, { role: 'external' }, { role: null }],
        }];
      }
    }
    // The "All Users" view is the only entry point that must surface EVERY
    // account (including those without an 'active' status — e.g. profiles
    // auto-created when an admin assigns a role, or pending DB-only records).
    // Domain/role/status-filtered views keep excluding pending/rejected.
    const isAllView = !filterDomain && !filterRole && !filterAccountStatus;
    if (!isAllView && filterDomain !== 'pending' && !filterAccountStatus && !where.accountStatus) {
      where.accountStatus = { notIn: ['pending', 'rejected'] };
    }
    if (filterAccountStatus && filterAccountStatus !== 'all') {
      where.accountStatus = filterAccountStatus;
    }
    if (effectiveRole === 'manager' && callerDept) {
      where.department = callerDept;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { userId: { contains: search, mode: 'insensitive' } },
      ];
    }

    let profiles: any[] = [];
    // Auto-heal: university / owner accounts are pre-approved and should never sit
    // in the pending queue. If any are stuck pending, activate them before listing.
    // Same for accounts that were already granted a role, CR or ACR by an admin —
    // being assigned any of those IS approval, so they must leave Pending too.
    if (filterDomain === 'pending') {
      try {
        await prisma.profile.updateMany({
          where: {
            accountStatus: 'pending',
            OR: [
              { email: { endsWith: '@ugrad.iiuc.ac.bd' } },
              { email: { endsWith: '@iiuc.ac.bd', not: { endsWith: '@ugrad.iiuc.ac.bd' } } },
              { email: { in: config.ownerEmails.map(e => e.toLowerCase()) } },
              { role: { in: ['admin', 'manager', 'teacher', 'student'] } },
              { isCR: true },
              { isACR: true },
            ],
          },
          data: { accountStatus: 'active' },
        });
      } catch (e: any) {
        console.error('[Admin Users] Auto-activate pending IIUC accounts failed:', e?.message);
      }
    }
    // Fetch ALL matching DB profiles (not a bounded "page" of them). Bounding the
    // DB query while the Firebase listing below is unbounded caused profiles saved
    // in the DB to silently disappear from the merged "All Users" list beyond the
    // first page. The DB is small (a few thousand rows), so this is safe.
    try {
      profiles = await prisma.profile.findMany({
        where,
        select: {
          userId: true, email: true, name: true, title: true, shortForm: true,
          role: true, isBanned: true, banReason: true, bannedBy: true,
          isCR: true, isACR: true, department: true, universityId: true, whatsapp: true,
          gender: true,
          githubLogin: true, githubAvatar: true, image: true, semester: true,
          section: true, createdAt: true, customPermissions: true,
          telegramId: true, telegramChatId: true, batchId: true,
          accountStatus: true,
          facebook: true, twitter: true, linkedin: true, website: true, company: true, companyUrl: true,
        },
      });
    } catch (e: any) {
      console.error('[Admin Users] Prisma profile query failed:', e?.message);
      profiles = [];
    }

    // Fetch ALL Firebase auth users by walking every page (not just the first
    // 1000), so nobody with a Firebase account is missing from "All Users".
    // The walk is capped so a huge user base never hangs the server/database
    // round-trips for each page (clearOnDeploy notes: the SDK names the
    // next-page field "pageToken" or "nextPageToken" — read both).
    let firebaseUsers: any[] = [];
    let firebaseListFailed = false;
    let firebaseListTruncated = false;
    const FIREBASE_MAX_PAGES = 40;
    try {
      const { getAdminAuth } = await import('@/lib/firebase-admin');
      const auth = getAdminAuth();
      if (auth) {
        let first = await auth.listUsers(1000);
        firebaseUsers = first.users || [];
        let pageToken = first.pageToken ?? first.nextPageToken;
        let guard = 0;
        while (pageToken && guard < FIREBASE_MAX_PAGES) {
          guard++;
          const page = await auth.listUsers(1000, pageToken);
          firebaseUsers = firebaseUsers.concat(page.users || []);
          pageToken = page.pageToken ?? page.nextPageToken;
        }
        if (guard >= FIREBASE_MAX_PAGES && pageToken) firebaseListTruncated = true;
      } else {
        firebaseListFailed = true;
      }
    } catch (err: any) {
      firebaseListFailed = true;
      console.error('[Admin Users] Firebase listUsers failed:', err?.message, err?.code);
    }

    // Secondary (linked) identities — every email a profile has linked. These
    // resolve to their primary account at sign-in, so they must not appear as
    // separate rows in the user list.
    const linkedSet = new Set<string>();
    try {
      const { prisma: q } = await import('@/lib/prisma');
      const linkedProfiles = await q.profile.findMany({
        where: { NOT: [{ linkedEmails: '[]' }, { linkedEmails: null }] },
        select: { linkedEmails: true },
      });
      for (const p of linkedProfiles) {
        let arr: string[] = [];
        try { arr = JSON.parse((p.linkedEmails as string) || '[]'); } catch { arr = []; }
        arr.forEach(e => linkedSet.add((e || '').toLowerCase().trim()));
      }
    } catch {}

    // DB "already allowed" identities: any email/address that has an ACTIVE
    // profile, an assigned (non-default) role, or CR/ACR in the database is by
    // definition approved. A Firebase-only account whose real profile row lives
    // in the DB under one of these addresses must NEVER appear on the Pending
    // list — even when the merge couldn't match it (e.g. legacy rows with a null
    // `email` column). Without this, approved/role-given users would keep
    // re-appearing as "No role · Firebase · pending" forever.
    const approvedSet = new Set<string>();
    if (filterDomain === 'pending') {
      try {
        const approved = await prisma.profile.findMany({
          where: {
            OR: [
              { accountStatus: 'active' },
              { isCR: true },
              { isACR: true },
              { role: { notIn: ['user', 'external'] } },
            ],
          },
          select: { userId: true, email: true },
        });
        for (const a of approved) {
          if (a.email) approvedSet.add(a.email.toLowerCase().trim());
          if (a.userId) approvedSet.add(a.userId.toLowerCase().trim());
        }
      } catch {}
    }

    const profileMap = new Map<string, any>();
    for (const p of profiles) {
      // Index by BOTH email and userId (legacy rows sometimes have a null email
      // column but a valid userId), so a Firebase user always finds its profile.
      const keys = new Set<string>();
      if (p.email) keys.add(p.email.toLowerCase());
      if (p.userId) keys.add(p.userId.toLowerCase());
      keys.forEach(k => { if (!profileMap.has(k)) profileMap.set(k, p); });
    }
    const merged = new Map<string, any>();

    for (const fu of firebaseUsers) {
      const userEmail = (fu.email || fu.phoneNumber || fu.uid || '').toLowerCase();
      if (!userEmail) continue;
      const profile = profileMap.get(userEmail);
      merged.set(userEmail, {
        userId: profile?.userId || userEmail,
        email: userEmail,
        name: profile?.name || fu.displayName || null,
        title: profile?.title || null,
        role: profile?.role || config.detectRole(userEmail),
        isBanned: profile?.isBanned || false,
        banReason: profile?.banReason || null,
        bannedBy: profile?.bannedBy || null,
        isCR: profile?.isCR || false,
        isACR: profile?.isACR || false,
        department: profile?.department || null,
        universityId: profile?.universityId || null,
        whatsapp: profile?.whatsapp || null,
        gender: profile?.gender || null,
        githubLogin: profile?.githubLogin || null,
        githubAvatar: profile?.githubAvatar || null,
        image: profile?.image || fu.photoURL || null,
        semester: profile?.semester || null,
        section: profile?.section || null,
        phone: profile?.phone || null,
        telegramId: profile?.telegramId || null,
        telegramChatId: profile?.telegramChatId || null,
        batchId: profile?.batchId || null,
        hasProfile: !!profile,
        source: profile ? 'db' : 'firebase',
        lastSignIn: fu.lastSignInTime || null,
        createdAt: profile?.createdAt?.toISOString?.() || fu.metadata?.creationTime || null,
        providers: fu.providerData?.map((p: any) => p.providerId) || [],
        customPermissions: profile?.customPermissions || {},
        // A Firebase account with no profile has never been approved — treat it
        // as pending so it only appears on the Pending list until an admin
        // approves it or assigns a role (both create an 'active' profile).
        accountStatus: profile?.accountStatus || 'pending',
        facebook: profile?.facebook || null,
        twitter: profile?.twitter || null,
        linkedin: profile?.linkedin || null,
        website: profile?.website || null,
        company: profile?.company || null,
        companyUrl: profile?.companyUrl || null,
      });
    }

    Array.from(profileMap.entries()).forEach(([emailKey, profile]) => {
      if (!merged.has(emailKey)) {
        merged.set(emailKey, {
          userId: profile.userId,
          email: emailKey,
          name: profile.name || null,
          title: profile.title || null,
          role: profile.role || 'user',
          isBanned: profile.isBanned || false,
          banReason: profile.banReason || null,
          bannedBy: profile.bannedBy || null,
          isCR: profile.isCR || false,
          isACR: profile.isACR || false,
          department: profile.department || null,
          universityId: profile.universityId || null,
          whatsapp: profile.whatsapp || null,
          gender: profile.gender || null,
          githubLogin: profile.githubLogin || null,
          githubAvatar: profile.githubAvatar || null,
          image: profile.image || null,
          semester: profile.semester || null,
          section: profile.section || null,
          telegramId: profile.telegramId || null,
          telegramChatId: profile.telegramChatId || null,
          batchId: profile.batchId || null,
          hasProfile: true,
          source: 'db',
          lastSignIn: null,
          createdAt: profile.createdAt?.toISOString?.() || null,
          providers: [],
          customPermissions: profile.customPermissions || {},
          accountStatus: profile.accountStatus || 'active',
          facebook: profile.facebook || null,
          twitter: profile.twitter || null,
          linkedin: profile.linkedin || null,
          website: profile.website || null,
          company: profile.company || null,
          companyUrl: profile.companyUrl || null,
        });
      }
    });

    let result = Array.from(merged.values());

    // Drop secondary identities: their only purpose is to log into the primary
    // account, so they shouldn't show up as their own users in the list.
    result = result.filter(u => !linkedSet.has((u.email || '').toLowerCase()));

    // Server-side search filter for Firebase users
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u =>
        u.email?.includes(q) || u.name?.toLowerCase().includes(q) || u.githubLogin?.toLowerCase().includes(q)
      );
    }

    // Server-side semester filter for Firebase users
    if (filterSemester && filterSemester !== 'all') {
      result = result.filter(u => u.semester === filterSemester);
    }

    // Server-side department filter for Firebase users
    if (filterDept && filterDept !== 'all') {
      result = result.filter(u => u.department === filterDept);
    }

    // Server-side domain filter for Firebase users.
    // The assigned role is the source of truth: an admin may manually assign a
    // student/teacher role to a non-@ugrad email (e.g. a gmail account), and that
    // assigned role must be honoured — not just the email domain.
    if (filterDomain && filterDomain !== 'all') {
      result = result.filter(u => {
        const eff = config.getEffectiveRole(u.email, u.role);
        if (filterDomain === 'student') {
          return eff === 'student' && u.accountStatus !== 'pending' && u.accountStatus !== 'rejected';
        }
        if (filterDomain === 'teacher') {
          return u.accountStatus !== 'pending' && u.accountStatus !== 'rejected' && eff === 'teacher';
        }
        if (filterDomain === 'external') {
          // External = all non-university accounts (not a role). Any active
          // account whose email isn't a university address belongs here.
          return !u.email?.endsWith('.iiuc.ac.bd') && u.accountStatus === 'active';
        }
        if (filterDomain === 'pending') {
          // An account needs approval unless it has a profile marked 'active'
          // (approve / setRole / CR / ACR all do that), or its address is an
          // approved identity in the database. Firebase-only accounts get the
          // default 'pending' below, so they show here — but once approved or
          // given a role / CR their DB record removes them automatically.
          return u.accountStatus === 'pending' && !u.email?.endsWith('.iiuc.ac.bd') &&
            !config.ownerEmails.includes(u.email?.toLowerCase()) &&
            !approvedSet.has((u.email || '').toLowerCase()) &&
            !u.isCR && !u.isACR &&
            (!u.role || u.role === 'user' || u.role === 'external') &&
            (!effectivePendingGender || !u.gender || u.gender === effectivePendingGender);
        }
        return true;
      });
    }

    // Domain/role/status-filtered views exclude pending/rejected accounts.
    // The "All Users" view (isAllView) surfaces every account.
    if (!isAllView && filterDomain !== 'pending' && !filterAccountStatus) {
      result = result.filter(u => u.accountStatus !== 'pending' && u.accountStatus !== 'rejected');
    }

    // Server-side role filter for merged results (Firebase users have role from detectRole)
    if (filterRole && filterRole !== 'all') {
      result = result.filter(u => u.role === filterRole);
    }

    // Sort the merged list (most recently created first) so pagination is stable
    // and predictable across the All / filtered views.
    result.sort((a, b) => (a.createdAt && b.createdAt ? (b.createdAt < a.createdAt ? -1 : 1) : 0));

    const total = result.length;
    const paged = result.slice(offset, offset + limit);

    return NextResponse.json({
      users: paged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      firebaseUserCount: firebaseUsers.length,
      firebaseOnlyCount: result.filter(u => !u.hasProfile).length,
      firebaseListFailed,
      firebaseListTruncated,
      canApprovePending: isApprover,
      adminGender: callerGender,
      effectiveGender: effectivePendingGender,
    });
  } catch (err: any) {
    console.error('[Admin Users] GET error:', err?.message, err?.stack);
    return NextResponse.json({ error: 'Failed to fetch users', detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.admin);
  if (!rl.success) return rl.response!;
  try {
    const email = await getUserEmail(req);
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const effectiveRole = config.getEffectiveRole(email);
    const isOwner = config.ownerEmails.includes(email.toLowerCase());
    if (effectiveRole !== 'admin' && effectiveRole !== 'teacher' && effectiveRole !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { targetEmail, action } = body;
    const validActions = ['ban', 'unban', 'setRole', 'toggleCR', 'toggleACR', 'grantPermission', 'revokePermission', 'setCustomPermissions', 'approve', 'reject', 'delete', 'sendToPending', 'approveAllPending'];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (action !== 'approveAllPending' && !targetEmail) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (targetEmail && targetEmail.toLowerCase() === email.toLowerCase() && (action === 'ban' || action === 'unban')) {
      return NextResponse.json({ error: 'Cannot ban yourself' }, { status: 400 });
    }

    const { prisma } = await import('@/lib/prisma');

    // ─── APPROVE ALL PENDING EXTERNAL ACCOUNTS ───
    if (action === 'approveAllPending') {
      if (effectiveRole !== 'admin' && effectiveRole !== 'manager') {
        return NextResponse.json({ error: 'Only admins or managers can approve accounts' }, { status: 403 });
      }
      const result = await prisma.profile.updateMany({
        where: {
          accountStatus: 'pending',
          email: { not: { endsWith: '.iiuc.ac.bd' } },
        },
        data: { accountStatus: 'active' },
      });
      return NextResponse.json({
        success: true,
        message: `Approved ${result.count} pending account${result.count === 1 ? '' : 's'}`,
        approved: result.count,
      });
    }

    const callerProfile = await prisma.profile.findUnique({ where: { userId: email } });

    await prisma.profile.upsert({
      where: { userId: targetEmail },
      create: { userId: targetEmail, email: targetEmail },
      update: {},
    });

    const targetProfile = await prisma.profile.findUnique({ where: { userId: targetEmail } });
    const targetEffectiveRole = config.getEffectiveRole(targetEmail, targetProfile?.role || undefined);

    // Manager can only act on users in their own department
    if (effectiveRole === 'manager' && callerProfile?.department) {
      if (targetProfile?.department && targetProfile.department !== callerProfile.department) {
        return NextResponse.json({ error: 'Managers can only manage users in their own department' }, { status: 403 });
      }
    }

    // ─── BAN ───
    if (action === 'ban') {
      const { banReason } = body;
      const banData: Record<string, any> = { isBanned: true, bannedBy: email };
      if (banReason && typeof banReason === 'string' && banReason.trim()) {
        banData.banReason = banReason.trim().slice(0, 500);
      }
      // Admin can ban anyone except other admins (unless owner)
      if (effectiveRole === 'admin') {
        if (targetEffectiveRole === 'admin' && !isOwner) {
          return NextResponse.json({ error: 'Cannot ban an admin' }, { status: 403 });
        }
        if (targetEffectiveRole === 'admin' && isOwner) {
          return NextResponse.json({ error: 'Cannot ban the owner' }, { status: 403 });
        }
        await prisma.profile.update({ where: { userId: targetEmail }, data: banData });
        invalidateStatusCache(targetEmail);
        return NextResponse.json({ success: true, message: 'User banned' });
      }
      // Teacher can ban: students, users, managers (not admins, not other teachers)
      if (effectiveRole === 'teacher') {
        if (targetEffectiveRole === 'admin') {
          return NextResponse.json({ error: 'Teachers cannot ban admins' }, { status: 403 });
        }
        if (targetEffectiveRole === 'teacher') {
          return NextResponse.json({ error: 'Teachers cannot ban other teachers' }, { status: 403 });
        }
        await prisma.profile.update({ where: { userId: targetEmail }, data: banData });
        invalidateStatusCache(targetEmail);
        return NextResponse.json({ success: true, message: 'User banned' });
      }
      // Manager can ban: students, users only (not teachers, not managers, not admins)
      if (effectiveRole === 'manager') {
        if (targetEffectiveRole === 'admin' || targetEffectiveRole === 'teacher' || targetEffectiveRole === 'manager') {
          return NextResponse.json({ error: 'Managers cannot ban admins, teachers, or other managers' }, { status: 403 });
        }
        await prisma.profile.update({ where: { userId: targetEmail }, data: banData });
        return NextResponse.json({ success: true, message: 'User banned' });
      }
    }

    // ─── UNBAN ───
    if (action === 'unban') {
      if (effectiveRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can unban' }, { status: 403 });
      }
      await prisma.profile.update({ where: { userId: targetEmail }, data: { isBanned: false, banReason: null, bannedBy: null } });
      invalidateStatusCache(targetEmail);
      return NextResponse.json({ success: true, message: 'User unbanned' });
    }

    // ─── SET ROLE ───
    if (action === 'setRole') {
      const { newRole } = body;
      const { getCustomRoles } = await import('@/lib/permissions');
      const customRoles = await getCustomRoles();
      const customRoleKeys = customRoles.map(r => r.key);
      if (!['admin', 'manager', 'teacher', 'student', 'user', ...customRoleKeys].includes(newRole)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      // Admins can set any role; managers can only set student/teacher/user
      if (effectiveRole !== 'admin' && effectiveRole !== 'manager') {
        return NextResponse.json({ error: 'Only admins or managers can change roles' }, { status: 403 });
      }
      if (effectiveRole === 'manager' && (newRole === 'admin' || newRole === 'manager')) {
        return NextResponse.json({ error: 'Managers cannot assign admin or manager roles' }, { status: 403 });
      }
      if (targetEmail.toLowerCase() === email.toLowerCase() && newRole !== 'admin') {
        return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 });
      }
      // Assigning a role is an explicit admin action — atomically create/repair the
      // profile with the role and an ACTIVE status (so a pending external account
      // stops being pending, shows under its role tab) and lift any deleted-email
      // blocklist so the user can actually sign in (with Google or their password).
      const normalizedTarget = targetEmail.toLowerCase();
      await prisma.profile.upsert({
        where: { userId: normalizedTarget },
        create: { userId: normalizedTarget, email: normalizedTarget, role: newRole, accountStatus: 'active' },
        update: { role: newRole, accountStatus: 'active' },
      });
      await removeDeletedEmail(prisma as any, normalizedTarget);
      invalidateStatusCache(normalizedTarget);
      return NextResponse.json({ success: true, message: `Role set to ${newRole}` });
    }

    // ─── TOGGLE CR ───
    if (action === 'toggleCR') {
      const { isCR } = body;
      if (targetEffectiveRole === 'admin') {
        return NextResponse.json({ error: 'Cannot change CR status of admin' }, { status: 403 });
      }
      // Manager can only make CR in own department
      if (effectiveRole === 'manager' && targetProfile?.department && callerProfile?.department && targetProfile.department !== callerProfile.department) {
        return NextResponse.json({ error: 'Managers can only make CR in their own department' }, { status: 403 });
      }
      if (isCR) {
        // Require department, semester, section to become CR
        if (!targetProfile?.department || !targetProfile?.semester || !targetProfile?.section) {
          return NextResponse.json({ error: 'User must have department, semester, and section set to become CR' }, { status: 400 });
        }
        // Manager: target must be in same department
        if (effectiveRole === 'manager' && targetProfile.department !== callerProfile?.department) {
          return NextResponse.json({ error: 'Managers can only make CR in their own department' }, { status: 403 });
        }
        // Max 2 CRs per section per semester per department
        const crCount = await prisma.profile.count({
          where: {
            isCR: true,
            department: targetProfile.department,
            semester: targetProfile.semester,
            section: targetProfile.section,
            NOT: { userId: targetEmail },
          },
        });
        if (crCount >= 2) {
          return NextResponse.json({ error: `Maximum 2 CRs allowed per section (currently ${crCount}). Remove an existing CR first.` }, { status: 400 });
        }
      }
      await prisma.profile.update({ where: { userId: targetEmail }, data: { isCR: !!isCR, ...(isCR ? { isACR: false } : {}) } });
      // Granting the CR privilege is an explicit admin action — it approves the
      // account too, so a pending external user promoted to CR leaves the
      // Pending queue immediately (matching setRole behaviour).
      if (isCR) {
        await prisma.profile.update({ where: { userId: targetEmail }, data: { accountStatus: 'active' } });
        await removeDeletedEmail(prisma as any, targetEmail);
        invalidateStatusCache(targetEmail.toLowerCase());
      }
      return NextResponse.json({ success: true, message: isCR ? 'Made CR' : 'Removed CR' });
    }

    // ─── TOGGLE ACR ───
    if (action === 'toggleACR') {
      const { isACR } = body;
      if (targetEffectiveRole === 'admin') {
        return NextResponse.json({ error: 'Cannot change ACR status of admin' }, { status: 403 });
      }
      if (effectiveRole === 'manager' && targetProfile?.department && callerProfile?.department && targetProfile.department !== callerProfile.department) {
        return NextResponse.json({ error: 'Managers can only manage ACR in their own department' }, { status: 403 });
      }
      if (isACR) {
        // Require department, semester, section to become ACR
        if (!targetProfile?.department || !targetProfile?.semester || !targetProfile?.section) {
          return NextResponse.json({ error: 'User must have department, semester, and section set to become ACR' }, { status: 400 });
        }
      }
      await prisma.profile.update({ where: { userId: targetEmail }, data: { isACR: !!isACR } });
      // Like CR, granting the ACR privilege is an explicit admin action —
      // approving a pending external user so they leave the Pending queue.
      if (isACR) {
        await prisma.profile.update({ where: { userId: targetEmail }, data: { accountStatus: 'active' } });
        await removeDeletedEmail(prisma as any, targetEmail);
        invalidateStatusCache(targetEmail.toLowerCase());
      }
      return NextResponse.json({ success: true, message: isACR ? 'Made ACR' : 'Removed ACR' });
    }

    // ─── GRANT PERMISSION ───
    if (action === 'grantPermission') {
      if (effectiveRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can grant permissions' }, { status: 403 });
      }
      const { permission } = body;
        const validPerms = ['addCourse', 'addToAnySemester', 'editCourse', 'deleteCourse', 'moveFile', 'copyFile', 'renameFile', 'deleteFile', 'uploadFile', 'manageFaculty', 'manageFacultyDepts', 'publishRoutine', 'manageUsers', 'manageSettings', 'editLinks'];
      if (!permission || !validPerms.includes(permission)) {
        return NextResponse.json({ error: 'Invalid permission' }, { status: 400 });
      }
      const settings = await prisma.siteSettings.findUnique({ where: { id: 'site-settings' } });
      const perms = (settings?.permissions as Record<string, string[]>) || {};
      const target = await prisma.profile.findUnique({ where: { userId: targetEmail } });
      const targetRole = config.getEffectiveRole(targetEmail, target?.role || undefined);
      const perUserKey = `${permission}_users`;
      const allowedUsers = (perms[perUserKey] as string[]) || [];
      if (allowedUsers.includes(targetEmail.toLowerCase())) {
        return NextResponse.json({ success: true, message: 'Already granted' });
      }
      const updatedPerms = { ...perms, [perUserKey]: [...allowedUsers, targetEmail.toLowerCase()] };
      await prisma.siteSettings.upsert({
        where: { id: 'site-settings' },
        create: { id: 'site-settings', permissions: updatedPerms },
        update: { permissions: updatedPerms },
      });
      invalidatePermissionsCache();
      return NextResponse.json({ success: true, message: `Granted "${permission}" to ${targetEmail}` });
    }

    // ─── REVOKE PERMISSION ───
    if (action === 'revokePermission') {
      if (effectiveRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can revoke permissions' }, { status: 403 });
      }
      const { permission } = body;
      if (!permission) {
        return NextResponse.json({ error: 'Invalid permission' }, { status: 400 });
      }
      const settings = await prisma.siteSettings.findUnique({ where: { id: 'site-settings' } });
      const perms = (settings?.permissions as Record<string, string[]>) || {};
      const perUserKey = `${permission}_users`;
      const allowedUsers = (perms[perUserKey] as string[]) || [];
      const updatedUsers = allowedUsers.filter((e: string) => e !== targetEmail.toLowerCase());
      const updatedPerms = { ...perms, [perUserKey]: updatedUsers };
      await prisma.siteSettings.upsert({
        where: { id: 'site-settings' },
        create: { id: 'site-settings', permissions: updatedPerms },
        update: { permissions: updatedPerms },
      });
      invalidatePermissionsCache();
      return NextResponse.json({ success: true, message: `Revoked "${permission}" from ${targetEmail}` });
    }

    // ─── SET CUSTOM PERMISSIONS (per-user scope) ───
    if (action === 'setCustomPermissions') {
      if (effectiveRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can set custom permissions' }, { status: 403 });
      }
      const { customPermissions } = body;
      if (!customPermissions || typeof customPermissions !== 'object') {
        return NextResponse.json({ error: 'customPermissions must be an object' }, { status: 400 });
      }
      const { setCustomPermissions } = await import('@/lib/permissions');
      await setCustomPermissions(targetEmail, customPermissions);
      return NextResponse.json({ success: true, message: `Updated custom permissions for ${targetEmail}` });
    }

    // ─── APPROVE PENDING ACCOUNT ───
    if (action === 'approve') {
      const approver = await canApprovePending(email, effectiveRole);
      if (!approver) {
        return NextResponse.json({ error: 'Only admins or assigned managers can approve accounts' }, { status: 403 });
      }
      await prisma.profile.upsert({
        where: { userId: targetEmail },
        update: { accountStatus: 'active', isBanned: false, banReason: null, bannedBy: null },
        create: { userId: targetEmail, email: targetEmail, accountStatus: 'active' },
      });
      // Approving restores sign-in for a previously deleted email.
      await removeDeletedEmail(prisma as any, targetEmail);
      invalidateStatusCache(targetEmail);
      return NextResponse.json({ success: true, message: `Account approved for ${targetEmail}` });
    }

    // ─── REJECT PENDING ACCOUNT ───
    if (action === 'reject') {
      const approver = await canApprovePending(email, effectiveRole);
      if (!approver) {
        return NextResponse.json({ error: 'Only admins or assigned managers can reject accounts' }, { status: 403 });
      }
      await prisma.profile.upsert({
        where: { userId: targetEmail },
        update: { accountStatus: 'rejected', isBanned: true },
        create: { userId: targetEmail, email: targetEmail, accountStatus: 'rejected', isBanned: true },
      });
      invalidateStatusCache(targetEmail);
      return NextResponse.json({ success: true, message: `Account rejected for ${targetEmail}` });
    }

    // ─── SEND ACTIVE EXTERNAL USER BACK TO PENDING ───
    if (action === 'sendToPending') {
      const approver = await canApprovePending(email, effectiveRole);
      if (!approver) {
        return NextResponse.json({ error: 'Only admins or assigned managers can move accounts back to pending' }, { status: 403 });
      }
      if (/@iiuc\.ac\.bd$/i.test(targetEmail)) {
        return NextResponse.json({ error: 'University accounts are pre-approved and cannot be moved to pending' }, { status: 400 });
      }
      await prisma.profile.upsert({
        where: { userId: targetEmail },
        update: { accountStatus: 'pending', role: 'user' },
        create: { userId: targetEmail, email: targetEmail, accountStatus: 'pending', role: 'user' },
      });
      invalidateStatusCache(targetEmail);
      return NextResponse.json({ success: true, message: `Account ${targetEmail} moved back to pending approval` });
    }

    // ─── DELETE USER (Firebase + DB) ───
    if (action === 'delete') {
      if (effectiveRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can delete users' }, { status: 403 });
      }
      const { banReason: deleteReason } = body;
      if (targetEmail.toLowerCase() === email.toLowerCase()) {
        return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
      }
      // Delete from Firebase Auth
      try {
        const { getAdminAuth } = await import('@/lib/firebase-admin');
        const auth = getAdminAuth();
        if (auth) {
          try {
            const firebaseUser = await auth.getUserByEmail(targetEmail);
            await auth.deleteUser(firebaseUser.uid);
          } catch (fbErr: any) {
            if (fbErr.code !== 'auth/user-not-found') {
              console.error('[Admin Users] Firebase delete error:', fbErr?.message);
            }
          }
        }
      } catch (err: any) {
        console.error('[Admin Users] Firebase delete failed:', err?.message);
      }
      // Delete from DB
      try {
        await prisma.profile.delete({ where: { userId: targetEmail } });
      } catch (dbErr: any) {
        if (dbErr?.code === 'P2025') {
          // Profile already gone — fine.
        } else {
          console.error('[Admin Users] DB delete error:', dbErr?.message);
          return NextResponse.json({
            error: `Firebase account deleted, but the database record could not be removed. You can now use Create User to repair this account.`,
          }, { status: 500 });
        }
      }
      // Block the email so their next Google/Firebase sign-in cannot silently
      // re-create a pending account (the "deleted but shows up again" loop).
      if (!/@iiuc\.ac\.bd$/i.test(targetEmail) && !config.ownerEmails.some(o => o.toLowerCase() === targetEmail.toLowerCase())) {
        await addDeletedEmail(prisma as any, targetEmail);
      }
      return NextResponse.json({ success: true, message: `User ${targetEmail} deleted from Firebase and database` });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Admin action failed' }, { status: 500 });
  }
}
