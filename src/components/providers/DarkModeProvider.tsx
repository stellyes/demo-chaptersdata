'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/app-store';

export function DarkModeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((state) => state.darkMode);

  useEffect(() => {
    // Apply dark class to the document element
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return <>{children}</>;
}
