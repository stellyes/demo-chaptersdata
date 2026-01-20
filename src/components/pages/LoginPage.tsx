'use client';

import { useState } from 'react';
import { Activity, Lock, User, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/app-store';

export function LoginPage() {
  const { setUser } = useAppStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (result.success) {
        setUser(result.data.user);
      } else {
        setError(result.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
      {/* Noise Overlay */}
      <div className="noise-overlay"></div>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-lg bg-[var(--accent)] flex items-center justify-center mb-4">
            <Activity className="w-8 h-8 text-[var(--paper)]" />
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[var(--ink)] tracking-tight">
            Chapters
          </h1>
          <p className="text-sm text-[var(--muted)]">Analytics Dashboard</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-lg p-8 shadow-[0_4px_30px_rgba(0,0,0,0.06)]">
          <h2 className="font-serif text-2xl font-medium text-[var(--ink)] mb-6 text-center">
            Sign In
          </h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                Username
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full pl-10 pr-4 py-3 border border-[var(--border)] rounded text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full pl-10 pr-4 py-3 border border-[var(--border)] rounded text-sm"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-sm text-[var(--error)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)] rounded font-medium disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--muted)] text-center">
              Default credentials: admin / changeme123
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--muted)] mt-6">
          Chapters Analytics Dashboard for Cannabis Retail
        </p>
      </div>
    </div>
  );
}
