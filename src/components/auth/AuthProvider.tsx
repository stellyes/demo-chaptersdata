'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { configureAmplify } from '@/lib/amplify-config';
import { useAuth, CognitoUser, UserOrganization } from '@/hooks/useAuth';
import { SessionToast, SessionInvalidReason } from '@/components/ui/SessionToast';
import {
  SessionBroadcastChannel,
  SessionMessage,
  getLocalSessionToken,
  getSessionCookie,
  getLogoutToken,
  clearLogoutToken,
  isSessionValid,
  createStorageListener,
} from '@/lib/session-sync';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isGlobalAdmin: boolean;
  user: CognitoUser | null;
  error: string | null;
  needsNewPassword: boolean;
  signIn: (username: string, password: string) => Promise<{ isSignedIn: boolean; nextStep: string | null }>;
  signOut: () => Promise<void>;
  confirmNewPassword: (newPassword: string) => Promise<{ isSignedIn: boolean }>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
  loginPath?: string;
  pollingInterval?: number; // ms, default 5000
}

export function AuthProvider({
  children,
  loginPath = '/login',
  pollingInterval = 5000,
}: AuthProviderProps) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [sessionInvalidReason, setSessionInvalidReason] = useState<SessionInvalidReason | null>(null);

  const auth = useAuth();
  const broadcastRef = useRef<SessionBroadcastChannel | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const hasHandledInvalidRef = useRef(false);

  // Configure Amplify on mount
  useEffect(() => {
    configureAmplify();
    setIsReady(true);
  }, []);

  // Handle invalid session
  const handleInvalidSession = useCallback((reason: SessionInvalidReason) => {
    if (hasHandledInvalidRef.current) return;
    hasHandledInvalidRef.current = true;

    setSessionInvalidReason(reason);
    auth.forceLogout();

    if (reason === 'logged_out') {
      clearLogoutToken();
    }
  }, [auth]);

  // Initialize BroadcastChannel for same-origin tab sync
  useEffect(() => {
    if (!isReady) return;

    broadcastRef.current = new SessionBroadcastChannel();

    const handleMessage = (message: SessionMessage) => {
      const currentToken = getLocalSessionToken();

      switch (message.type) {
        case 'SESSION_CREATED':
          if (currentToken && currentToken.userId !== message.payload.userId) {
            // Different user logged in on another tab
            handleInvalidSession('different_user');
          }
          break;

        case 'SESSION_DESTROYED':
          if (currentToken && currentToken.userId === message.payload.userId) {
            // Same user logged out on another tab
            handleInvalidSession('logged_out');
          }
          break;
      }
    };

    broadcastRef.current.addListener(handleMessage);

    return () => {
      broadcastRef.current?.close();
    };
  }, [isReady, handleInvalidSession]);

  // Storage event listener for cross-tab sync
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = createStorageListener((newToken, oldToken) => {
      if (!newToken && oldToken) {
        handleInvalidSession('logged_out');
      } else if (newToken && oldToken && newToken.userId !== oldToken.userId) {
        handleInvalidSession('different_user');
      } else if (newToken && !oldToken) {
        // New session created, reset invalid state
        hasHandledInvalidRef.current = false;
        setSessionInvalidReason(null);
      }
    });

    return unsubscribe;
  }, [isReady, handleInvalidSession]);

  // Polling for cross-origin session cookie changes
  useEffect(() => {
    if (!isReady || !auth.isAuthenticated) return;

    const checkSession = () => {
      const localToken = getLocalSessionToken();
      const cookieToken = getSessionCookie();

      const validity = isSessionValid(localToken, cookieToken);

      if (!validity.valid && validity.reason) {
        handleInvalidSession(validity.reason);
      }
    };

    // Initial check
    checkSession();

    // Periodic polling
    pollingRef.current = setInterval(checkSession, pollingInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isReady, auth.isAuthenticated, pollingInterval, handleInvalidSession]);

  // Handle toast close - redirect to login
  const handleToastClose = useCallback(() => {
    setSessionInvalidReason(null);
    hasHandledInvalidRef.current = false;
    router.push(loginPath);
  }, [router, loginPath]);

  if (!isReady) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: auth.isAuthenticated,
        isLoading: auth.isLoading,
        isGlobalAdmin: auth.isGlobalAdmin,
        user: auth.user,
        error: auth.error,
        needsNewPassword: auth.needsNewPassword,
        signIn: auth.signIn,
        signOut: auth.signOut,
        confirmNewPassword: auth.confirmNewPassword,
        checkAuth: auth.checkAuth,
      }}
    >
      {children}

      {/* Session invalidation toast */}
      <SessionToast
        isVisible={!!sessionInvalidReason}
        reason={sessionInvalidReason}
        onClose={handleToastClose}
        redirectingIn={3}
      />
    </AuthContext.Provider>
  );
}
