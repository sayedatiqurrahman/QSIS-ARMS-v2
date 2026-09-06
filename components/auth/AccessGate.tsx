'use client';

import { useState } from 'react';
import { normalizeUniversityId } from '@/lib/utils';

interface AccessGateProps {
  email?: string;
  status?: string | null;
  onClose?: () => void;
  showBackToHome?: boolean;
}

// Shown when someone tries to log in with a non-university, non-linked email
// that isn't approved yet. Forcefully asks them to use their university email
// first; if they don't have one, they can request access by submitting their
// student/university ID.
export default function AccessGate({ email: initialEmail = '', status, onClose, showBackToHome = false }: AccessGateProps) {
  const [mode, setMode] = useState<'gate' | 'form' | 'sent'>('gate');
  const [gateEmail, setGateEmail] = useState(initialEmail);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [contact, setContact] = useState('');
  const [gender, setGender] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [idError, setIdError] = useState('');
  const [savedId, setSavedId] = useState('');

  const statusPending = status === 'pending';
  const statusRejected = status === 'rejected';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const rawId = id.trim();
    const hasBadChars = /[\s_-]/.test(rawId);
    if (!rawId || rawId.length < 3) {
      setError('Please enter your student/university ID so a manager can verify you.');
      return;
    }
    if (hasBadChars) {
      setIdError('Enter your ID as one block, e.g. Q233099 — no dashes, spaces or underscores.');
      return;
    }
    const trimmedId = normalizeUniversityId(rawId);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gateEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    const trimmedContact = contact.trim();
    if (trimmedContact && !/^\+?[0-9][0-9\s\-]{6,20}$/.test(trimmedContact)) {
      setError('Enter your WhatsApp/Telegram number with country code, e.g. +8801XXXXXXXXX.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: gateEmail, name: name.trim(), id: trimmedId, contact: trimmedContact, gender }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedId(trimmedId);
        setMode('sent');
      } else {
        setError(data.error || 'Failed to submit. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  const handleIdBlur = () => {
    const raw = id.trim();
    if (!raw) { setIdError(''); return; }
    if (/[\s_-]/.test(raw)) {
      setIdError('Enter your ID as one block, e.g. Q233099 — no dashes, spaces or underscores.');
      return;
    }
    const clean = normalizeUniversityId(raw);
    if (clean !== id) setId(clean);
    setIdError('');
  };

  const close = () => {
    if (typeof onClose === 'function') { onClose(); return; }
    setMode('gate'); setError('');
  };

  return (
    <div className="bg-dark-bg2 border border-dark-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
      {mode === 'sent' ? (
        <>
          <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center mb-3 mx-auto">
            <i className="fas fa-check text-green-400"></i>
          </div>
          <h2 className="text-[0.95rem] font-bold text-dark-text text-center mb-1">Request submitted!</h2>
          <p className="text-[0.8rem] text-dark-text2 text-center mb-4">
            A manager will verify your student ID{' '}
            <strong className="text-dark-text">#{savedId}</strong> and approve your account if it matches. You&apos;ll be
            able to log in with <strong className="text-dark-text">{gateEmail}</strong> once approved.
          </p>
          {showBackToHome ? (
            <a href="/" className="block w-full py-2 rounded-lg bg-dark-bg border border-dark-border text-dark-text2 text-[0.8rem] font-semibold cursor-pointer hover:text-dark-text transition-colors text-center no-underline">
              <i className="fas fa-arrow-left mr-1"></i> Back to Home
            </a>
          ) : (
            <button onClick={close} className="w-full py-2 rounded-lg bg-dark-bg border border-dark-border text-dark-text2 text-[0.8rem] font-semibold cursor-pointer hover:text-dark-text transition-colors">
              Back to login
            </button>
          )}
        </>
      ) : mode === 'form' ? (
        <>
          <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mb-3 mx-auto">
            <i className="fas fa-id-card text-amber-400"></i>
          </div>
          <h2 className="text-[0.95rem] font-bold text-dark-text text-center mb-1">Request access</h2>
          <p className="text-[0.8rem] text-dark-text2 text-center mb-4">
            Submit your details and a manager will verify your student ID, then approve your account.
          </p>
          <form onSubmit={submit}>
            <div className="space-y-2">
              <input
                type="email"
                value={gateEmail}
                onChange={e => setGateEmail(e.target.value)}
                placeholder="Your email"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors"
              />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full name as on your university certificate"
                required
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors"
              />
              <input
                type="text"
                value={id}
                onChange={e => {
                  const v = e.target.value;
                  setId(v);
                  const raw = v.trim();
                  if (raw && /[\s_-]/.test(raw)) {
                    setIdError('Enter your ID as one block, e.g. Q233099 — no dashes, spaces or underscores.');
                  } else {
                    setIdError('');
                  }
                }}
                onBlur={handleIdBlur}
                placeholder="Student / University ID (e.g. C211086)"
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors"
              />
              {idError && (
                <p className="px-2 text-red-400 text-[0.68rem]">
                  <i className="fas fa-exclamation-circle mr-1"></i>{idError}
                </p>
              )}
              <input
                type="text"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="WhatsApp / Telegram number with country code (e.g. +8801XXXXXXXXX)"
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors"
              />
              <select
                value={gender}
                onChange={e => setGender(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-dark-text text-[0.82rem] outline-none focus:border-qsis transition-colors"
              >
                <option value="">Select gender (optional)</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            {error && (
              <p className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[0.72rem]">
                <i className="fas fa-exclamation-circle mr-1"></i>{error}
              </p>
            )}
            <button type="submit" disabled={loading}
              className="w-full mt-3 py-2.5 rounded-lg bg-qsis text-white text-[0.82rem] font-semibold border-none cursor-pointer hover:opacity-90 disabled:opacity-50 transition-opacity">
              {loading ? <><i className="fas fa-spinner fa-spin mr-1"></i>Submitting...</> : <><i className="fas fa-paper-plane mr-1"></i>Request Access</>}
            </button>
            <button type="button" onClick={() => { setMode('gate'); setError(''); }}
              className="w-full mt-2 py-2 rounded-lg bg-transparent text-dark-text2 text-[0.75rem] font-semibold cursor-pointer hover:text-dark-text transition-colors border-none">
              <i className="fas fa-arrow-left mr-1"></i> Back
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1">
            <div className="w-12 h-12 rounded-full bg-yellow-500/15 flex items-center justify-center">
              <i className="fas fa-user-lock text-yellow-400"></i>
            </div>
            {!showBackToHome && typeof onClose === 'function' && (
              <button onClick={onClose} className="text-dark-text2 bg-transparent border-none cursor-pointer hover:text-dark-text" title="Close">
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
          <h2 className="text-[0.95rem] font-bold text-dark-text mb-1">University email required</h2>
          <p className="text-[0.8rem] text-dark-text2 mb-3">
            Sign-in is only for IIUC university emails
            {' '}<strong className="text-dark-text">@ugrad.iiuc.ac.bd</strong> or <strong className="text-dark-text">@iiuc.ac.bd</strong>. Personal emails can only be used after a manager approves the account.
          </p>
          {(statusPending || statusRejected) && (
            <div className={`p-2.5 rounded-lg text-[0.72rem] mb-3 ${statusPending ? 'bg-amber-500/10 border border-amber-500/25 text-amber-300' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
              {statusPending
                ? <><i className="fas fa-clock mr-1"></i>Your request is under review — a manager is verifying the student ID you submitted.</>
                : <><i className="fas fa-ban mr-1"></i>Your request was rejected. Contact an admin if you believe this is a mistake, or submit a new request below.</>}
            </div>
          )}
          <div className="space-y-2">
            <button onClick={() => { if (typeof onClose === 'function') onClose(); }}
              className="w-full py-2.5 rounded-lg bg-qsis text-white text-[0.82rem] font-semibold border-none cursor-pointer hover:opacity-90 transition-opacity">
              <i className="fas fa-graduation-cap mr-1"></i> I have a university email — sign in with it
            </button>
            <button onClick={() => { setMode('form'); setError(''); }}
              className="w-full py-2.5 rounded-lg border border-qsis text-qsis text-[0.82rem] font-semibold cursor-pointer hover:bg-qsis/10 transition-colors">
              <i className="fas fa-id-card mr-1"></i> I don&apos;t have one — request access with my ID
            </button>
            {showBackToHome && (
              <a href="/" className="block w-full py-1.5 rounded-lg bg-transparent text-dark-text2 text-[0.75rem] font-semibold cursor-pointer hover:text-dark-text transition-colors text-center no-underline">
                <i className="fas fa-arrow-left mr-1"></i> Back to Home
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}