'use client';

import { useEffect } from 'react';
import { configureAmplify } from '@/lib/amplify-config';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  useEffect(() => {
    configureAmplify();
  }, []);

  return <>{children}</>;
}
