'use client';

/**
 * Session Sync Module
 *
 * SECURITY MODEL:
 * - This module handles session COORDINATION across tabs/subdomains, NOT authentication
 * - Actual authentication is handled by AWS Cognito with secure httpOnly cookies
 * - The session token stored here only contains:
 *   - userId: Cognito user ID (not PII, just an identifier)
 *   - sessionId: Random UUID for this login session
 *   - timestamp: When session was created
 *
 * - Email and other PII are NOT stored persistently
 * - If XSS occurs, attackers only get the userId which is useless without Cognito tokens
 * - The real security boundary is Cognito's encrypted tokens
 */

// Session management constants
const SESSION_STORAGE_KEY = 'chapters_session_token';
const SESSION_COOKIE_NAME = 'chapters_session_sync';
const LOGOUT_COOKIE_NAME = 'chapters_logout_token';
const BROADCAST_CHANNEL_NAME = 'chapters_session_channel';

// Session token structure - minimal data for coordination only
export interface SessionToken {
  userId: string;     // Cognito user ID (not PII)
  sessionId: string;  // Random UUID for this session
  timestamp: number;  // When session was created
}

// Message types for BroadcastChannel (same-origin tabs)
export type SessionMessage =
  | { type: 'SESSION_CREATED'; payload: SessionToken }
  | { type: 'SESSION_DESTROYED'; payload: { userId: string; sessionId: string } }
  | { type: 'SESSION_CHECK'; payload: null }
  | { type: 'SESSION_RESPONSE'; payload: SessionToken | null };

// Transient session info (for UI display, not persisted)
export interface SessionDisplayInfo {
  email?: string;
}

// Generate a unique session ID
export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Get the cookie domain based on current hostname
function getCookieDomain(): string {
  if (typeof window === 'undefined') return '';

  const hostname = window.location.hostname;

  // Production: use .chaptersdata.com for cross-subdomain sharing
  if (hostname.endsWith('chaptersdata.com')) {
    return '.chaptersdata.com';
  }

  // Development: use localhost (no subdomain sharing)
  return hostname;
}

// Cookie utilities
function setCookie(name: string, value: string, days: number = 30): void {
  if (typeof document === 'undefined') return;

  const domain = getCookieDomain();
  const secure = window.location.protocol === 'https:';
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();

  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; domain=${domain};${secure ? ' secure;' : ''} samesite=lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;

  const domain = getCookieDomain();
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
}

// Session token storage (localStorage)
export function getLocalSessionToken(): SessionToken | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setLocalSessionToken(token: SessionToken): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(token));
}

export function clearLocalSessionToken(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// Cross-domain session cookie (for sync between subdomains)
export function getSessionCookie(): SessionToken | null {
  const value = getCookie(SESSION_COOKIE_NAME);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function setSessionCookie(token: SessionToken): void {
  setCookie(SESSION_COOKIE_NAME, JSON.stringify(token), 30);
}

export function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE_NAME);
}

// Logout token (to propagate logout across domains)
export function setLogoutToken(userId: string, sessionId: string): void {
  const token = `${userId}:${sessionId}:${Date.now()}`;
  setCookie(LOGOUT_COOKIE_NAME, token, 1); // 1 day expiry
}

export function getLogoutToken(): { userId: string; sessionId: string; timestamp: number } | null {
  const value = getCookie(LOGOUT_COOKIE_NAME);
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length < 3) return null;

  const [userId, sessionId, timestampStr] = parts;
  const timestamp = parseInt(timestampStr, 10);

  return userId && sessionId && !isNaN(timestamp)
    ? { userId, sessionId, timestamp }
    : null;
}

export function clearLogoutToken(): void {
  deleteCookie(LOGOUT_COOKIE_NAME);
}

// BroadcastChannel manager (for same-origin tabs)
export class SessionBroadcastChannel {
  private channel: BroadcastChannel | null = null;
  private listeners: ((message: SessionMessage) => void)[] = [];

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        this.listeners.forEach((listener) => listener(event.data));
      };
    }
  }

  postMessage(message: SessionMessage): void {
    this.channel?.postMessage(message);
  }

  addListener(listener: (message: SessionMessage) => void): void {
    this.listeners.push(listener);
  }

  removeListener(listener: (message: SessionMessage) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  close(): void {
    this.channel?.close();
    this.listeners = [];
  }
}

// Storage event listener (for cross-tab localStorage changes)
export function createStorageListener(
  callback: (newToken: SessionToken | null, oldToken: SessionToken | null) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: StorageEvent) => {
    if (event.key === SESSION_STORAGE_KEY) {
      const newToken = event.newValue ? JSON.parse(event.newValue) : null;
      const oldToken = event.oldValue ? JSON.parse(event.oldValue) : null;
      callback(newToken, oldToken);
    }
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

// Check if session is valid (not logged out, same user)
export function isSessionValid(
  localToken: SessionToken | null,
  cookieToken: SessionToken | null
): { valid: boolean; reason?: 'logged_out' | 'different_user' | 'no_session' } {
  // No session at all
  if (!localToken && !cookieToken) {
    return { valid: false, reason: 'no_session' };
  }

  // Check for logout token
  const logoutToken = getLogoutToken();
  if (logoutToken && localToken) {
    // If this session was logged out
    if (logoutToken.sessionId === localToken.sessionId &&
        logoutToken.timestamp > localToken.timestamp) {
      return { valid: false, reason: 'logged_out' };
    }
    // If the same user logged out from a different session
    if (logoutToken.userId === localToken.userId &&
        logoutToken.timestamp > localToken.timestamp) {
      return { valid: false, reason: 'logged_out' };
    }
  }

  // Check for user mismatch (different user logged in on another tab/app)
  if (localToken && cookieToken) {
    // Different user entirely
    if (localToken.userId !== cookieToken.userId) {
      return { valid: false, reason: 'different_user' };
    }

    // Same user but newer session (logged in again elsewhere)
    if (cookieToken.sessionId !== localToken.sessionId &&
        cookieToken.timestamp > localToken.timestamp) {
      // This is fine - update local to match cookie
      return { valid: true };
    }
  }

  return { valid: true };
}
