'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useAppStore } from '@/store/app-store';

export function LoginPage() {
  const { setUser } = useAppStore();

  // Capture UTM parameter for session attribution
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
