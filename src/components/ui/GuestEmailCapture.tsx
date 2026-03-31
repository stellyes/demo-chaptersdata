'use client';

import { useState, useEffect } from 'react';
import { X, ArrowRight, Loader2 } from 'lucide-react';

const SESSION_KEY = 'chapters_email_capture_done';
const DELAY_MS = 30_000;

export function GuestEmailCapture() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) {
      return;
    }

    const timer = setTimeout(() => setVisible(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(SESSION_KEY, '1');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setSubmitting(true);
    try {
      const utm = typeof window !== 'undefined' ? sessionStorage.getItem('chapters_utm') : null;
      await fetch('/api/lead-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, utm }),
      });
    } catch {
      // Fire-and-forget — don't block UX on failure
    } finally {
      setSubmitting(false);
      setSubmitted(true);
      sessionStorage.setItem(SESSION_KEY, '1');
      setTimeout(() => setVisible(false), 2500);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-[var(--white)] rounded-lg shadow-[0_8px_40px_rgba(0,0,0,0.12)] border border-[var(--border)] p-5 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 p-1 text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      {submitted ? (
        <div className="text-center py-2">
          <p className="font-medium text-[var(--ink)] text-sm">Thanks — we&apos;ll be in touch.</p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-[var(--ink)] mb-1 pr-5">
            Want a version built for your store?
          </p>
          <p className="text-xs text-[var(--muted)] mb-4">Leave your email and we&apos;ll reach out.</p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourstore.com"
              className="flex-1 min-w-0 px-3 py-2 border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
              autoFocus
              required
            />
            <button
              type="submit"
              disabled={submitting || !email}
              className="flex items-center justify-center px-3 py-2 bg-[var(--ink)] text-[var(--paper)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
              aria-label="Submit"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
