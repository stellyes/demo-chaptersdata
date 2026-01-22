'use client';

import { useState, useEffect, useCallback } from 'react';

const DISPLAY_NAME_KEY = 'chapters_display_name';
const PROFILE_KEY = 'chapters_profile';

export function useDisplayName(userId: string | undefined) {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    const fetchDisplayName = async () => {
      let storedName: string | null = null;

      // First, try to fetch from API/server
      try {
        timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const profile = data.profile;
          if (profile?.displayName && typeof profile.displayName === 'string') {
            storedName = profile.displayName as string;
            // Cache locally
            localStorage.setItem(`${DISPLAY_NAME_KEY}_${userId}`, storedName as string);
          }
        }
      } catch (error) {
        // Ignore abort errors - they're expected on unmount or timeout
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch display name from API:', error);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Fallback to localStorage if API didn't have it
      if (!storedName) {
        storedName = localStorage.getItem(`${DISPLAY_NAME_KEY}_${userId}`);
      }

      // Also check profile storage if not found
      if (!storedName) {
        const profileData = localStorage.getItem(`${PROFILE_KEY}_${userId}`);
        if (profileData) {
          try {
            const parsed = JSON.parse(profileData);
            if (parsed.displayName && typeof parsed.displayName === 'string') {
              storedName = parsed.displayName as string;
              // Sync to display name storage
              localStorage.setItem(`${DISPLAY_NAME_KEY}_${userId}`, storedName as string);
            }
          } catch {
            // Invalid JSON, ignore
          }
        }
      }

      if (storedName) {
        setDisplayName(storedName);
        setNeedsSetup(false);
      } else {
        setNeedsSetup(true);
      }
      setIsLoading(false);
    };

    fetchDisplayName();

    // Cleanup: abort any pending requests on unmount
    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [userId]);

  const saveDisplayName = useCallback(async (name: string) => {
    if (!userId) return;

    // Save to localStorage immediately for responsiveness
    localStorage.setItem(`${DISPLAY_NAME_KEY}_${userId}`, name);
    setDisplayName(name);
    setNeedsSetup(false);

    // Also sync to API/server in background
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        await fetch('/api/profile/display-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, displayName: name }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Failed to sync display name to server:', error);
      // Still works locally, so no need to revert
    }
  }, [userId]);

  const clearDisplayName = useCallback(() => {
    if (!userId) return;

    localStorage.removeItem(`${DISPLAY_NAME_KEY}_${userId}`);
    setDisplayName(null);
    setNeedsSetup(true);
  }, [userId]);

  return {
    displayName,
    isLoading,
    needsSetup,
    saveDisplayName,
    clearDisplayName,
  };
}
