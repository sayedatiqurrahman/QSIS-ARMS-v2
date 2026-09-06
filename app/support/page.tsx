'use client';

import { useState, useMemo } from 'react';
import { FACULTIES } from '@/lib/departments';
import CustomSelect from '@/components/CustomSelect';
import type { CustomSelectOption } from '@/components/CustomSelect';
import { normalizeUniversityId } from '@/lib/utils';

const ISSUE_TYPES = [
  'Account Access',
  'File Not Found',
  'Upload Problem',
  'Routine Issue',
  'Certificate Problem',
  'Club Related',
  'Technical Bug',
  'Feature Request',
  'Other',
];

const deptOptions: CustomSelectOption[] = FACULTIES.flatMap(f =>
  f.departments.map(d => ({
    value: d.shortName,
    label: d.name,
    group: f.shortName,
  }))
);

const issueOptions: CustomSelectOption[] = ISSUE_TYPES.map(t => ({
  value: t,
  label: t,
}));

const COUNTRY_CODES = [
  { code: '+880', label: 'Bangladesh' },
  { code: '+91', label: 'India' },
  { code: '+92', label: 'Pakistan' },
  { code: '+977', label: 'Nepal' },
  { code: '+94', label: 'Sri Lanka' },
  { code: '+95', label: 'Myanmar' },
  { code: '+60', label: 'Malaysia' },
  { code: '+65', label: 'Singapore' },
  { code: '+971', label: 'UAE' },
  { code: '+974', label: 'Qatar' },
  { code: '+966', label: 'Saudi Arabia' },
  { code: '+973', label: 'Bahrain' },
  { code: '+968', label: 'Oman' },
  { code: '+993', label: 'Turkmenistan' },
  { code: '+965', label: 'Kuwait' },
  { code: '+44', label: 'United Kingdom' },
  { code: '+1', label: 'USA / Canada' },
];

// Combine the selected country code with the typed local number. A number the
// user already typed WITH its own "+..." code is left untouched.
function buildWhatsappNumber(code: string, raw: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  return `${code}${trimmed.replace(/^0+/, '')}`;
}

export default function SupportPage() {
  const [form, setForm] = useState({
    name: '',
    universityId: '',
    department: '',
    gender: '' as '' | 'male' | 'female',
    issueType: '',
    issue: '',
    whatsapp: '',
    whatsappCode: '+880',
    telegram: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.gender || !form.issue.trim()) return;

    setSubmitting(true);
    setResult(null);

    try {
      const fullIssue = form.issueType
        ? `[${form.issueType}] ${form.issue}`
        : form.issue;

      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          universityId: form.universityId.trim() || undefined,
          department: form.department || undefined,
          gender: form.gender,
          issue: fullIssue,
          whatsapp: buildWhatsappNumber(form.whatsappCode, form.whatsapp) || undefined,
          telegram: form.telegram.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResult({ ok: true, message: `Your request has been sent to ${data.groupName}. A team member will respond shortly.` });
        setForm({ name: '', universityId: '', department: '', gender: '', issueType: '', issue: '', whatsapp: '', whatsappCode: '+880', telegram: '' });
      } else {
        setResult({ ok: false, message: data.error || 'Failed to submit' });
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = form.name.trim() && form.gender && form.issue.trim() && !submitting;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-dark-text flex items-center gap-2">
          <i className="fas fa-headset text-qsis"></i>
          Support & Contact
        </h1>
        <p className="text-sm text-dark-text2 mt-1">
          Having issues? Fill out this form and our team will help you via Telegram.
        </p>
      </div>

      {result && (
        <div className={`mb-5 p-4 rounded-xl border text-sm ${result.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          <i className={`fas ${result.ok ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2`}></i>
          {result.message}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-3 lg:gap-8 lg:items-start">

      <form onSubmit={handleSubmit} className="space-y-4 lg:col-span-2">
        {/* Gender */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-2">Gender *</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => update('gender', 'male')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition ${
                form.gender === 'male'
                  ? 'bg-blue-500/15 border-blue-500/50 text-blue-400'
                  : 'bg-dark-bg3 border-dark-border text-dark-text2 hover:border-dark-text2'
              }`}
            >
              <i className="fas fa-mars"></i> Male
            </button>
            <button
              type="button"
              onClick={() => update('gender', 'female')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition ${
                form.gender === 'female'
                  ? 'bg-pink-500/15 border-pink-500/50 text-pink-400'
                  : 'bg-dark-bg3 border-dark-border text-dark-text2 hover:border-dark-text2'
              }`}
            >
              <i className="fas fa-venus"></i> Female
            </button>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-1.5">Full Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Enter your full name"
            className="w-full px-4 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm placeholder:text-dark-text2/50 focus:outline-none focus:border-qsis transition"
            required
          />
        </div>

        {/* University ID */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-1.5">University ID</label>
          <input
            type="text"
            value={form.universityId}
            onChange={e => update('universityId', e.target.value)}
            onBlur={e => update('universityId', normalizeUniversityId(e.target.value))}
            placeholder="e.g. eb263013"
            className="w-full px-4 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm placeholder:text-dark-text2/50 focus:outline-none focus:border-qsis transition"
          />
        </div>

        {/* Department — CustomSelect */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-1.5">Department</label>
          <CustomSelect
            options={deptOptions}
            value={form.department}
            onChange={v => update('department', v)}
            placeholder="Select department"
            searchable
            showEmpty
            size="md"
          />
        </div>

        {/* Issue Type — CustomSelect */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-1.5">Issue Type</label>
          <CustomSelect
            options={issueOptions}
            value={form.issueType}
            onChange={v => update('issueType', v)}
            placeholder="Select issue type"
            searchable
            showEmpty
            size="md"
          />
        </div>

        {/* Issue */}
        <div>
          <label className="block text-sm font-medium text-dark-text mb-1.5">Issue Description *</label>
          <textarea
            value={form.issue}
            onChange={e => update('issue', e.target.value)}
            placeholder="Describe your issue in detail..."
            rows={4}
            className="w-full px-4 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm placeholder:text-dark-text2/50 focus:outline-none focus:border-qsis transition resize-none"
            required
          />
        </div>

        {/* Contact */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark-text mb-1.5">WhatsApp</label>
            <div className="flex gap-3">
              <select
                value={form.whatsappCode}
                onChange={e => update('whatsappCode', e.target.value)}
                className="shrink-0 px-3 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm focus:outline-none focus:border-qsis transition"
              >
                {COUNTRY_CODES.map(c => (
                  <option key={c.code} value={c.code}>{c.label} {c.code}</option>
                ))}
              </select>
              <input
                type="tel"
                value={form.whatsapp}
                onChange={e => update('whatsapp', e.target.value)}
                placeholder={form.whatsappCode === '+880' ? 'e.g. 1XXXXXXXXX' : 'Your phone number'}
                className="flex-1 w-full px-4 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm placeholder:text-dark-text2/50 focus:outline-none focus:border-qsis transition"
              />
            </div>
            <p className="text-[0.6rem] text-dark-text2/60 mt-1">
              Bangladesh (+880) is selected by default. The country code is added automatically — type only your local number (e.g. 1XXXXXXXXX).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-text mb-1.5">Telegram</label>
            <input
              type="text"
              value={form.telegram}
              onChange={e => update('telegram', e.target.value)}
              placeholder="@username or +880..."
              className="w-full px-4 py-2.5 rounded-xl bg-dark-bg3 border border-dark-border text-dark-text text-sm placeholder:text-dark-text2/50 focus:outline-none focus:border-qsis transition"
            />
            <p className="text-[0.6rem] text-dark-text2/60 mt-1">Username or phone with country code</p>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-3 rounded-xl bg-qsis hover:bg-qsis/90 text-white font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><i className="fas fa-spinner fa-spin"></i> Submitting...</>
          ) : (
            <><i className="fas fa-paper-plane"></i> Submit Support Request</>
          )}
        </button>
      </form>

      {/* Quick links */}
      <div className="mt-8 lg:mt-0 p-4 rounded-xl bg-dark-bg3 border border-dark-border lg:sticky lg:top-24">
        <p className="text-xs font-semibold text-dark-text2 mb-3 uppercase tracking-wider">Quick Links</p>
        <div className="space-y-2">
          <a href="https://t.me/iiuc_arms_bot" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-dark-bg2 transition text-sm text-dark-text2 hover:text-dark-text no-underline">
            <i className="fab fa-telegram text-emerald-400 w-5 text-center"></i>
            <span>
              🤖 IIUC-ARMS Bot — Fastest way to get a reply
              <span className="block text-xs text-dark-text2/70">Message the bot for instant answers & upload course files</span>
            </span>
          </a>
          <a href="https://t.me/iiuc_arms_chat" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-dark-bg2 transition text-sm text-dark-text2 hover:text-dark-text no-underline">
            <i className="fab fa-telegram text-blue-400 w-5 text-center"></i>
            Telegram Group
          </a>
          <a href="https://t.me/iiuc_arms" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-dark-bg2 transition text-sm text-dark-text2 hover:text-dark-text no-underline">
            <i className="fab fa-telegram-plane text-cyan-400 w-5 text-center"></i>
            Telegram Channel
          </a>
          <a href="https://chat.whatsapp.com/IIUC-ARMS" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-dark-bg2 transition text-sm text-dark-text2 hover:text-dark-text no-underline">
            <i className="fab fa-whatsapp text-emerald-400 w-5 text-center"></i>
            WhatsApp Community
          </a>
        </div>
      </div>
      </div>
    </div>
  );
}
