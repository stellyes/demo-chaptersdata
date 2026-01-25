'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentUser, signIn, signOut, fetchAuthSession, confirmSignIn } from 'aws-amplify/auth';
import { isAmplifyConfigured } from '@/lib/amplify-config';
import {
  getLocalSessionToken,
  setLocalSessionToken,
  clearLocalSessionToken,
  getSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  setLogoutToken,
  generateSessionId,
  SessionBroadcastChannel,
} from '@/lib/session-sync';

export interface UserOrganization {
  orgId: string;
  name: string;
  role: 'admin' | 'member';
}

export interface CognitoUser {
  username: string;
  userId: string;
  email?: string;
  groups?: string[];
  organizations?: UserOrganization[];
  isGlobalAdmin: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isGlobalAdmin: boolean;
  user: CognitoUser | null;
  error: string | null;
  needsNewPassword: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    isGlobalAdmin: false,
    user: null,
    error: null,
    needsNewPassword: false,
  });

  const broadcastRef = useRef<SessionBroadcastChannel | null>(null);

  // Initialize broadcast channel for session sync
  useEffect(() => {
    broadcastRef.current = new SessionBroadcastChannel();
    return () => {
      broadcastRef.current?.close();
    };
  }, []);

  const fetchUserOrganizations = useCallback(async (userId: string, isGlobalAdmin: boolean): Promise<UserOrganization[]> => {
    try {
      const params = new URLSearchParams({
        userId,
        isAdmin: isGlobalAdmin.toString(),
      });
      const response = await fetch(`/api/auth/organizations?${params}`);
      if (!response.ok) return [];
      const result = await response.json();
      return result.data?.organizations || [];
    } catch (error) {
      console.error('Failed to fetch user organizations:', error);
      return [];
    }
  }, []);

  // Create session token for cross-domain sync
  const createSessionToken = useCallback((userId: string) => {
    const token = {
      userId,
      sessionId: generateSessionId(),
      timestamp: Date.now(),
    };

    setLocalSessionToken(token);
    setSessionCookie(token);

    // Notify other tabs
    broadcastRef.current?.postMessage({
      type: 'SESSION_CREATED',
      payload: token,
    });

    return token;
  }, []);

  // Destroy session token (called before sign out)
  const destroySessionToken = useCallback(() => {
    const currentToken = getLocalSessionToken();

    if (currentToken) {
      // Set logout token for cross-domain propagation
      setLogoutToken(currentToken.userId, currentToken.sessionId);

      // Notify other tabs
      broadcastRef.current?.postMessage({
        type: 'SESSION_DESTROYED',
        payload: {
          userId: currentToken.userId,
          sessionId: currentToken.sessionId,
        },
      });
    }

    clearLocalSessionToken();
    clearSessionCookie();
  }, []);

  const checkAuth = useCallback(async () => {
    if (!isAmplifyConfigured()) {
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        isGlobalAdmin: false,
        user: null,
        error: null,
        needsNewPassword: false,
      });
      return;
    }

    try {
      const user = await getCurrentUser();

      // Fetch session to get groups and email from the ID token
      let groups: string[] = [];
      let email: string | undefined;
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken;
        if (idToken) {
          const payload = idToken.payload;
          groups = (payload['cognito:groups'] as string[]) || [];
          email = payload.email as string | undefined;
        }
      } catch {
        // Failed to get token data, continue without them
      }

      const isGlobalAdmin = groups.includes('Admins');

      // Fetch user's organizations from DynamoDB
      // For global admins, fetch all organizations
      const organizations = await fetchUserOrganizations(user.userId, isGlobalAdmin);

      // Check if we need to create/update session token
      const existingToken = getLocalSessionToken() || getSessionCookie();
      if (!existingToken || existingToken.userId !== user.userId) {
        createSessionToken(user.userId);
      }

      setAuthState({
        isAuthenticated: true,
        isLoading: false,
        isGlobalAdmin,
        user: {
          username: user.username,
          userId: user.userId,
          email,
          groups,
          organizations,
          isGlobalAdmin,
        },
        error: null,
        needsNewPassword: false,
      });
    } catch {
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        isGlobalAdmin: false,
        user: null,
        error: null,
        needsNewPassword: false,
      });
    }
  }, [fetchUserOrganizations, createSessionToken]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleSignIn = useCallback(async (username: string, password: string) => {
    if (!isAmplifyConfigured()) {
      throw new Error('Authentication is not configured');
    }

    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
      const result = await signIn({ username, password });

      if (result.isSignedIn) {
        await checkAuth(); // This will create the session token
        return { isSignedIn: true, nextStep: null };
      } else {
        const nextStep = result.nextStep?.signInStep;

        if (nextStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          setAuthState((prev) => ({
            ...prev,
            isLoading: false,
            needsNewPassword: true,
          }));
          return { isSignedIn: false, nextStep };
        }

        setAuthState((prev) => ({
          ...prev,
          isLoading: false,
        }));
        return { isSignedIn: false, nextStep };
      }
    } catch (error) {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Sign in failed',
      }));
      throw error;
    }
  }, [checkAuth]);

  const handleConfirmNewPassword = useCallback(async (newPassword: string) => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
      const result = await confirmSignIn({ challengeResponse: newPassword });

      if (result.isSignedIn) {
        await checkAuth();
        return { isSignedIn: true };
      }

      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      return { isSignedIn: false };
    } catch (error) {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Password change failed',
      }));
      throw error;
    }
  }, [checkAuth]);

  const handleSignOut = useCallback(async () => {
    if (!isAmplifyConfigured()) {
      return;
    }

    try {
      // Destroy session token BEFORE signing out (for cross-domain sync)
      destroySessionToken();

      await signOut();
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        isGlobalAdmin: false,
        user: null,
        error: null,
        needsNewPassword: false,
      });
    } catch (error) {
      setAuthState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Sign out failed',
      }));
    }
  }, [destroySessionToken]);

  // Force logout (called when session is invalidated externally)
  const forceLogout = useCallback(() => {
    clearLocalSessionToken();
    clearSessionCookie();
    setAuthState({
      isAuthenticated: false,
      isLoading: false,
      isGlobalAdmin: false,
      user: null,
      error: null,
      needsNewPassword: false,
    });
  }, []);

  return {
    ...authState,
    signIn: handleSignIn,
    signOut: handleSignOut,
    confirmNewPassword: handleConfirmNewPassword,
    checkAuth,
    forceLogout,
  };
}
