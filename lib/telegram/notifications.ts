import { sendMessage } from './api';
import { config } from '@/lib/config';

// ─── Helpers ───────────────────────────────────────────────────────

// Convert a routine/exam semester value (label or id, possibly with a
// gender suffix like "1st Semester (Male)") into the profile semester id
// used on Profile.semester (e.g. "1st-semister").
export function semesterLabelToId(semester: string): string | null {
  if (!semester) return null;
  let s = semester.trim().toLowerCase().replace(/\s*\((male|female)\)\s*$/i, '').trim();
  const m = s.match(/^(\d+)\s*(st|nd|rd|th)?\s*-?\s*(semester|semister)?\s*$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num < 1 || num > 8) return null;
  const suffix = m[2] || (num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th');
  const id = `${num}${suffix}-semister`;
  return config.semesters.some(s => s.id === id) ? id : null;
}

// Map a routine semester value to its readable label.
export function semesterLabel(semester: string): string {
  const id = semesterLabelToId(semester);
  return config.semesters.find(s => s.id === id)?.label || semester || '';
}

export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\b(dr|prof|professor|prof|mr|mrs|ms|md|sir|engr|eng)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameMatches(profileName: string, teacherName: string): boolean {
  const p = normalizeName(profileName);
  const t = normalizeName(teacherName);
  if (!p || !t) return false;
  if (p === t) return true;
  if (p.includes(t) || t.includes(p)) return p.length >= 3 && t.length >= 3;
  const pParts = p.split(' ');
  const tParts = t.split(' ');
  return pParts[pParts.length - 1] === tParts[tParts.length - 1] && (pParts.length >= 2 || tParts.length >= 2);
}

export function rollInRange(roll: string, from: string, to: string): boolean {
  const r = (roll || '').toUpperCase().trim();
  const f = (from || '').toUpperCase().trim();
  const t = (to || '').toUpperCase().trim();
  if (!r) return false;
  if (!f) return true;
  const rm = r.match(/^(.*?)(\d+)$/);
  const fm = f.match(/^(.*?)(\d+)$/);
  const tm = t.match(/^(.*?)(\d+)$/);
  if (!rm || !fm) return r === f;
  if (rm[1] !== fm[1]) return false;
  const rn = parseInt(rm[2], 10);
  const fn = parseInt(fm[2], 10);
  const tn = tm ? parseInt(tm[2], 10) : Infinity;
  return rn >= fn && rn <= tn;
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

// ─── Department-wise Notification Helpers ─────────────────────────

export interface NotificationLogEntry {
  department: string;
  type: string;
  title: string;
  message: string;
  sentBy?: string;
  recipientCount: number;
}

export interface DepartmentNotificationOptions {
  type?: string;
  title?: string;
  sentBy?: string;
  delayMs?: number;
  semester?: string;
  // Filter recipients to these semester ids (Profile.semester). Ignored when empty.
  semesters?: string[];
}

export async function sendDepartmentNotifications(
  departments: string[],
  message: string,
  options?: DepartmentNotificationOptions
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { prisma } = await import('@/lib/prisma');
  const type = options?.type || 'routine_update';
  const title = options?.title || 'Notification';
  const delayMs = options?.delayMs ?? 100;

  const where: any = { telegramChatId: { not: null } };

  if (!departments.includes('ALL')) {
    where.department = { in: departments };
  }

  if (options?.semester) {
    where.semester = options.semester;
  }

  if (options?.semesters?.length) {
    where.semester = { in: options.semesters };
  }

  const profiles = await prisma.profile.findMany({
    where,
    select: { telegramChatId: true, name: true, department: true, userId: true },
  });

  if (profiles.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  let sent = 0;
  let failed = 0;

  for (const p of profiles) {
    if (!p.telegramChatId) continue;
    try {
      const chatId = Number(p.telegramChatId);
      if (isNaN(chatId)) continue;
      await sendMessage(chatId, message, { disable_web_page_preview: true });
      sent++;
    } catch {
      failed++;
    }
    // Rate limit: 100ms between sends to avoid Telegram API limits
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Log to database
  try {
    await prisma.telegramNotification.create({
      data: {
        department: departments.join(','),
        type,
        title,
        message: message.substring(0, 2000),
        sentBy: options?.sentBy || null,
        recipientCount: sent,
      },
    });
  } catch (err: any) {
    console.error('[TG] Failed to log notification:', err?.message);
  }

  return { sent, failed, skipped: profiles.length - sent - failed };
}

// ─── Teacher-wise Notification Helpers ────────────────────────────

export interface TeacherNotificationOptions {
  type?: string;
  title?: string;
  sentBy?: string;
  delayMs?: number;
}

export async function sendTeacherNotifications(
  teacherNames: string[],
  message: string,
  options?: TeacherNotificationOptions
): Promise<{ sent: number; failed: number; matched: number }> {
  const { prisma } = await import('@/lib/prisma');
  const names = Array.from(new Set((teacherNames || []).map(n => (n || '').trim()).filter(Boolean)));
  if (names.length === 0) return { sent: 0, failed: 0, matched: 0 };

  const delayMs = options?.delayMs ?? 100;
  const type = options?.type || 'teacher_notification';
  const title = options?.title || 'Notification';

  const profiles = await prisma.profile.findMany({
    where: { telegramChatId: { not: null } },
    select: { telegramChatId: true, name: true, email: true, department: true, shortForm: true },
  });

  // Faculty directory: used to resolve a teacher's canonical name from their
  // linked short form (Profile.shortForm === FacultyMember.shortForm), so a
  // teacher who claimed their profile is matched even if the routine spells
  // their name slightly differently or their Profile.name differs.
  const members = await prisma.facultyMember.findMany({
    select: { name: true, shortForm: true, department: true },
  });
  const memberByShortForm = new Map<string, string>();
  for (const m of members) {
    if (m.shortForm && !memberByShortForm.has(m.shortForm.toUpperCase())) {
      memberByShortForm.set(m.shortForm.toUpperCase(), m.name);
    }
  }

  // Only notify accounts that are actually teachers / staff (iiuc.ac.bd email)
  const targets = profiles.filter(p => {
    if (!p.name) return false;
    if (!/@iiuc\.ac\.bd$/i.test(p.email || '')) return false;
    // 1) Prefer the claimed faculty profile (linked via short form)
    const linkedName = p.shortForm ? memberByShortForm.get(String(p.shortForm).toUpperCase()) : undefined;
    if (linkedName && names.some(n => nameMatches(linkedName, n))) return true;
    // 2) Fall back to matching the account name directly
    return names.some(n => nameMatches(p.name!, n));
  });

  let sent = 0;
  let failed = 0;
  for (const p of targets) {
    if (!p.telegramChatId) continue;
    const chatId = Number(p.telegramChatId);
    if (isNaN(chatId)) continue;
    try {
      await sendMessage(chatId, message, { disable_web_page_preview: true });
      sent++;
    } catch {
      failed++;
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  try {
    await prisma.telegramNotification.create({
      data: {
        department: 'teachers',
        type,
        title,
        message: message.substring(0, 2000),
        sentBy: options?.sentBy || null,
        recipientCount: sent,
      },
    });
  } catch {}

  return { sent, failed, matched: targets.length };
}

// ─── Room / Seat Assignment Notification Helpers ──────────────────

export interface RoomAssignment {
  department: string;
  semester?: string;
  room: string;
  rollFrom: string;
  rollTo: string;
  date: string;
  slot?: string;
  examType?: string;
  course?: string;
}

export interface RoomAssignmentOptions {
  type?: string;
  title?: string;
  sentBy?: string;
  delayMs?: number;
}

export async function sendRoomAssignmentNotifications(
  assignments: RoomAssignment[],
  messageBuilder: (mine: RoomAssignment[], profile: { universityId: string | null; name: string | null; department: string | null }) => string,
  options?: RoomAssignmentOptions
): Promise<{ sent: number; failed: number; matched: number }> {
  const { prisma } = await import('@/lib/prisma');
  const valid = (assignments || []).filter(a => a && a.department && a.room);
  if (valid.length === 0) return { sent: 0, failed: 0, matched: 0 };

  const depts = Array.from(new Set(valid.map(a => a.department)));
  const profiles = await prisma.profile.findMany({
    where: { telegramChatId: { not: null }, department: { in: depts } },
    select: { telegramChatId: true, universityId: true, name: true, department: true, semester: true },
  });

  let sent = 0;
  let failed = 0;
  let matched = 0;
  const delayMs = options?.delayMs ?? 100;

  for (const p of profiles) {
    if (!p.telegramChatId) continue;
    const chatId = Number(p.telegramChatId);
    if (isNaN(chatId)) continue;

    const mine = valid.filter(a =>
      a.department === p.department &&
      (!a.semester || a.semester === p.semester) &&
      rollInRange(p.universityId || '', a.rollFrom, a.rollTo)
    );
    if (mine.length === 0) continue;

    matched++;
    try {
      const message = messageBuilder(mine, {
        universityId: p.universityId,
        name: p.name,
        department: p.department,
      });
      if (message) {
        await sendMessage(chatId, message, { disable_web_page_preview: true });
        sent++;
      }
    } catch {
      failed++;
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  try {
    await prisma.telegramNotification.create({
      data: {
        department: valid[0].department,
        type: options?.type || 'seat_assignment',
        title: options?.title || 'Exam Room',
        message: 'Room assignment notification',
        sentBy: options?.sentBy || null,
        recipientCount: sent,
      },
    });
  } catch {}

  return { sent, failed, matched };
}

export async function getNotificationHistory(options?: { department?: string; type?: string; limit?: number }) {
  const { prisma } = await import('@/lib/prisma');
  const where: any = {};
  if (options?.department) where.department = options.department;
  if (options?.type) where.type = options.type;

  return prisma.telegramNotification.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    take: options?.limit || 50,
  });
}

export async function getConnectedUsersCount(): Promise<number> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.profile.count({
    where: { telegramChatId: { not: null } },
  });
}

// ─── Pending Account Admin Notification ───────────────────────────

export async function notifyAdminsPendingAccount(email: string, name?: string, universityId?: string, contact?: string, gender?: string): Promise<void> {
  try {
    const { prisma } = await import('@/lib/prisma');

    // Check if notification is enabled
    const settings = await prisma.siteSettings.findUnique({ where: { id: 'site-settings' } });
    const perms = (settings?.permissions as Record<string, any>) || {};
    if (perms.notifyPendingAccounts === false) return;

    // Who gets notified is owner-controlled: pendingNotifTargets (a list of
    // emails) if set, otherwise every admin with Telegram connected.
    const targets = Array.isArray(perms.pendingNotifTargets)
      ? (perms.pendingNotifTargets as string[]).map((e: string) => e.toLowerCase())
      : [];

    let recipients: { telegramChatId: string | null; name: string | null; userId: string }[] = [];
    if (targets.length > 0) {
      recipients = await prisma.profile.findMany({
        where: {
          userId: { in: targets },
          telegramChatId: { not: null },
        },
        select: { telegramChatId: true, name: true, userId: true },
      });
    } else {
      recipients = await prisma.profile.findMany({
        where: {
          role: 'admin',
          telegramChatId: { not: null },
        },
        select: { telegramChatId: true, name: true, userId: true },
      });
    }

    const displayName = name || email.split('@')[0];
    const genderLabel = gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : 'Not specified';
    // Deep link straight into the Pending list with this account pre-filtered,
    // so the reviewer lands on exactly this request (tab=users&sub=pending&q=email).
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://iiuc-arms.eu.cc';
    const reviewLink = `${baseUrl}/admin?tab=users&sub=pending&q=${encodeURIComponent(email)}`;
    const message = [
      `🆕 <b>New Access Request</b>`,
      ``,
      `<b>Email:</b> ${email}`,
      `<b>Name:</b> ${displayName}`,
      `<b>Gender:</b> ${genderLabel}`,
      ...(universityId ? [`<b>Student ID:</b> ${universityId}`] : []),
      ...(contact ? [`<b>WhatsApp/Telegram:</b> ${contact}`] : []),
      ``,
      `A non-university account requested approval with their ID. Verify it, then approve or reject them.`,
      ``,
      `<a href="${reviewLink}">→ Review in Admin Panel (Pending)</a>`,
    ].join('\n');

    // Send to individual admins/managers
    for (const admin of recipients) {
      if (!admin.telegramChatId) continue;
      try {
        const chatId = Number(admin.telegramChatId);
        if (isNaN(chatId)) continue;
        await sendMessage(chatId, message, { disable_web_page_preview: true });
      } catch {}
    }

    // Send to gender-specific support group
    try {
      const supportConfig = (settings?.supportConfig as Record<string, any>) || {};
      if (supportConfig.enabled) {
        const chatId = gender === 'female'
          ? supportConfig.femaleChatId
          : supportConfig.maleChatId;
        if (chatId) {
          const numericId = Number(chatId);
          if (!isNaN(numericId)) {
            await sendMessage(numericId, message, { disable_web_page_preview: true });
          }
        }
      }
    } catch {}
  } catch (err: any) {
    console.error('[TG] Failed to notify about access request:', err?.message);
  }
}

export async function getDepartmentConnectedUsersCount(departments: string[]): Promise<Record<string, number>> {
  const { prisma } = await import('@/lib/prisma');
  const profiles = await prisma.profile.findMany({
    where: {
      department: { in: departments },
      telegramChatId: { not: null },
    },
    select: { department: true },
  });

  const counts: Record<string, number> = {};
  for (const dept of departments) counts[dept] = 0;
  for (const p of profiles) {
    if (p.department && counts[p.department] !== undefined) {
      counts[p.department]++;
    }
  }
  return counts;
}