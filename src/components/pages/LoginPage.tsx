'use client';

import { useState, useEffect } from 'react';
import { Lock, Loader2, Check, X } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/app-store';

export function LoginPage() {
  const { confirmNewPassword, isLoading, error, needsNewPassword, isAuthenticated, user, checkAuth } = useAuth();
  const { setUser, setCurrentOrganization } = useAppStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Password validation helpers
  const passwordChecks = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
  };

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  // Track when initial auth check is complete
  useEffect(() => {
    if (!isLoading) {
      setIsCheckingAuth(false);
    }
  }, [isLoading]);

  // When Cognito authentication succeeds, update the app store
  useEffect(() => {
    if (isAuthenticated && user) {
      const appUser = {
        username: user.username,
        role: user.isGlobalAdmin ? 'admin' as const : 'analyst' as const,
        userId: user.userId,
        email: user.email,
        organizations: user.organizations || [],
        isGlobalAdmin: user.isGlobalAdmin,
      };
      setUser(appUser);
      if (user.organizations && user.organizations.length > 0) {
        setCurrentOrganization(user.organizations[0]);
      }
    }
  }, [isAuthenticated, user, setUser, setCurrentOrganization]);

  // Capture UTM parameter and store for session attribution
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const utm = params.get('utm');
      if (utm) {
        sessionStorage.setItem('chapters_utm', utm);
      }
    }
  }, []);

  const handleGuestAccess = () => {
    setUser({
      username: 'guest',
      role: 'analyst',
      userId: 'guest',
      organizations: [],
      isGlobalAdmin: false,
    });
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!isPasswordValid) {
      setLocalError('Please meet all password requirements');
      return;
    }
    if (!passwordsMatch) {
      setLocalError('Passwords do not match');
      return;
    }

    try {
      await confirmNewPassword(newPassword);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('Password does not conform')) {
          setLocalError('Password does not meet requirements. Please include uppercase, lowercase, and numbers.');
        } else {
          setLocalError(err.message);
        }
      } else {
        setLocalError('Password change failed');
      }
    }
  };

  const displayError = localError || error;

  const PasswordCheck = ({ met, label }: { met: boolean; label: string }) => (
    <div className={`flex items-center gap-2 text-xs ${met ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>
      {met ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </div>
  );

  // Show loading screen while checking existing auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
        <div className="noise-overlay"></div>
        <div className="flex flex-col items-center">
          <Image
            src="/chapters-logo.svg"
            alt="Chapters Logo"
            width={64}
            height={64}
            className="mb-4 logo-dark-invert"
          />
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      </div>
    );
  }

  // New password form (Cognito first-login flow — admin path only)
  if (needsNewPassword) {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
        <div className="noise-overlay"></div>

        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/chapters-logo.svg"
              alt="Chapters Logo"
              width={64}
              height={64}
              className="mb-4 logo-dark-invert"
            />
            <h1 className="font-serif text-3xl font-semibold text-[var(--ink)] tracking-tight leading-none">
              Chapters
            </h1>
            <p className="text-[0.65rem] text-[var(--muted)] leading-none mt-1">Data & Marketing Consulting, LLC</p>
          </div>

          <div className="bg-[var(--white)] rounded-lg p-8 shadow-[0_4px_30px_rgba(0,0,0,0.06)]">
            <h2 className="font-serif text-2xl font-medium text-[var(--ink)] mb-2 text-center">
              Create Your Password
            </h2>
            <p className="text-sm text-[var(--muted)] text-center mb-6">
              Your account requires a new password. Please create a secure password to continue.
            </p>

            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">New Password</label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full pl-10 pr-4 py-3 border border-[var(--border)] rounded text-sm"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">Confirm Password</label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className={`w-full pl-10 pr-4 py-3 border rounded text-sm ${
                      confirmPassword.length > 0
                        ? passwordsMatch
                          ? 'border-[var(--success)]'
                          : 'border-[var(--error)]'
                        : 'border-[var(--border)]'
                    }`}
                    required
                  />
                </div>
              </div>

              <div className="p-3 bg-[var(--cream)] rounded space-y-1.5">
                <p className="text-xs font-medium text-[var(--muted)] mb-2">Password requirements:</p>
                <PasswordCheck met={passwordChecks.length} label="At least 8 characters" />
                <PasswordCheck met={passwordChecks.uppercase} label="One uppercase letter" />
                <PasswordCheck met={passwordChecks.lowercase} label="One lowercase letter" />
                <PasswordCheck met={passwordChecks.number} label="One number" />
              </div>

              {displayError && (
                <div className="p-3 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-sm text-[var(--error)]">
                  {displayError}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !isPasswordValid || !passwordsMatch}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)] rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Setting password...
                  </>
                ) : (
                  'Set Password & Continue'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Guest access landing
  return (
    <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
      <div className="noise-overlay"></div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/chapters-logo.svg"
            alt="Chapters Logo"
            width={64}
            height={64}
            className="mb-4 logo-dark-invert"
          />
          <h1 className="font-serif text-3xl font-semibold text-[var(--ink)] tracking-tight leading-none">
            Chapters
          </h1>
          <p className="text-[0.65rem] text-[var(--muted)] leading-none mt-1">Data & Marketing Consulting, LLC</p>
        </div>

        <div className="bg-[var(--white)] rounded-lg p-8 shadow-[0_4px_30px_rgba(0,0,0,0.06)] text-center">
          <h2 className="font-serif text-2xl font-medium text-[var(--ink)] mb-3">
            Retail Intelligence
          </h2>
          <p className="text-sm text-[var(--muted)] mb-8 leading-relaxed">
            This dashboard runs on synthetic data. Your version trains on your actual store data.
          </p>
          <button
            onClick={handleGuestAccess}
            className="w-full px-4 py-3 bg-[var(--ink)] text-[var(--paper)] rounded font-medium hover:opacity-90 transition-opacity"
          >
            View the Demo Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
