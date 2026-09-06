import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '@/lib/get-user';
import { encrypt, decrypt, isEncrypted } from '@/lib/crypto';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withDbRetry } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.profile);
  if (!rl.success) return rl.response!;
  try {
    const email = await getUserEmail(req);
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized — not signed in' }, { status: 401 });
    }

    const userId = email;
    const profile = await withDbRetry(async () => {
      const { prisma } = await import('@/lib/prisma');
      return prisma.profile.findUnique({
        where: { userId },
        select: {
          userId: true, email: true, name: true, title: true, shortForm: true, image: true,
          department: true, semester: true, section: true, session: true, batchId: true,
          universityId: true, gender: true, whatsapp: true, telegramId: true, isCR: true, isACR: true,
          facebook: true, twitter: true, linkedin: true, website: true,
          company: true, companyUrl: true, publicEmail: true, profileType: true,
          hideWhatsapp: true, hideUniversityId: true, hideSemester: true, hideEmail: true, hideCompany: true,
          hideFacebook: true, hideTwitter: true, hideLinkedin: true, hideWebsite: true,
          showInContributors: true, role: true,
          githubLogin: true, githubToken: true, githubAvatar: true, githubInstallationId: true,
          totpMethods: true, linkedEmails: true, isBanned: true,
        }
      });
    });

    if (profile) {
      try { (profile as any).totpMethods = JSON.parse(profile.totpMethods as string); } catch { (profile as any).totpMethods = ['email']; }
      try { (profile as any).linkedEmails = JSON.parse(profile.linkedEmails as string); } catch { (profile as any).linkedEmails = []; }
    }

    // Compute hasGithubToken from the raw DB value, then strip the actual token
    const hasGithubToken = !!(profile as any)?.githubToken;
    const { githubToken: _tok, ...safeProfile } = (profile || { userId, email }) as any;

    // Fetch club memberships
    let clubMemberships: any[] = [];
    try {
      const { prisma } = await import('@/lib/prisma');
      const memberships = await prisma.clubMember.findMany({
        where: { userId },
        include: { club: { select: { name: true, slug: true, department: true, logoUrl: true } } },
        orderBy: { createdAt: 'desc' },
      });
      clubMemberships = memberships.map(m => ({
        clubName: m.club.name,
        clubSlug: m.club.slug,
        department: m.club.department,
        logoUrl: m.club.logoUrl,
        role: m.role,
        joinedAt: m.createdAt,
      }));
    } catch {}

    const result = { ...safeProfile, hasGithubToken, clubMemberships };
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.profile);
  if (!rl.success) return rl.response!;

  // Skip Turnstile for profile updates — already authenticated via session/token

  try {
    const { prisma } = await import('@/lib/prisma');
    const email = await getUserEmail(req);
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized — not signed in' }, { status: 401 });
    }

    const userId = email;
    const body = await req.json();

    // Build update object — only include fields that are explicitly provided
    const updateData: Record<string, any> = {};
    const { roleForEmail } = await import('@/lib/roles');
    const createData: Record<string, any> = { userId, email, role: roleForEmail(email) };

    const fields = [
      'name', 'title', 'shortForm', 'department', 'isCR', 'universityId', 'gender', 'whatsapp', 'telegramId', 'semester', 'section', 'image', 'batchId', 'session',
      'profileType',
      'facebook', 'twitter', 'linkedin', 'website', 'company', 'companyUrl', 'publicEmail',
      'hideWhatsapp', 'hideUniversityId', 'hideSemester', 'hideEmail', 'hideCompany',
      'hideFacebook', 'hideTwitter', 'hideLinkedin', 'hideWebsite',
      'showInContributors',
      'githubLogin', 'githubToken', 'githubInstallationId', 'githubAvatar',
    ];

    // Fields that can be cleared by sending empty string (disconnect flow)
    const clearableFields = new Set(['githubLogin', 'githubToken', 'githubInstallationId', 'githubAvatar']);

    for (const field of fields) {
      if (field in body) {
        const val = body[field];
        if (typeof val === 'boolean') {
          updateData[field] = val;
          createData[field] = val;
        } else if (val !== undefined && val !== null && val !== '') {
          // Encrypt githubToken before storing
          if (field === 'githubToken' && typeof val === 'string') {
            updateData[field] = isEncrypted(val) ? val : encrypt(val);
            createData[field] = updateData[field];
          } else {
            updateData[field] = val;
            createData[field] = val;
          }
        } else if ((val === '' || val === null) && clearableFields.has(field)) {
          // Only clear github fields on explicit empty (disconnect)
          updateData[field] = null;
          createData[field] = null;
        }
        // For non-clearable fields with empty/null values, simply skip — don't overwrite existing data
      }
    }

    const saved = await withDbRetry(async () => {
      const { prisma } = await import('@/lib/prisma');
      return prisma.profile.upsert({
        where: { userId },
        update: updateData,
        create: createData as any,
        select: {
          userId: true, email: true, name: true, title: true, shortForm: true, image: true,
          department: true, semester: true, section: true, session: true, batchId: true,
          universityId: true, gender: true, whatsapp: true, telegramId: true, isCR: true, isACR: true,
          facebook: true, twitter: true, linkedin: true, website: true,
          company: true, companyUrl: true, publicEmail: true, profileType: true,
          hideWhatsapp: true, hideUniversityId: true, hideSemester: true, hideEmail: true, hideCompany: true,
          hideFacebook: true, hideTwitter: true, hideLinkedin: true, hideWebsite: true,
          showInContributors: true, role: true,
          githubLogin: true, githubAvatar: true, githubInstallationId: true, githubToken: true,
          totpMethods: true, linkedEmails: true, isBanned: true,
        }
      });
    });

    // Strip the actual token, return hasGithubToken boolean instead
    const hasGithubToken = !!(saved as any).githubToken;
    const { githubToken: _tok, ...safe } = saved as any;
    return NextResponse.json({ ...safe, hasGithubToken });
  } catch (err: any) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
}
