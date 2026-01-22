'use client';

import { useState, useEffect, useCallback } from 'react';

const PROFILE_KEY = 'chapters_profile';

export interface ProfileData {
  displayName: string;
  organizationName: string;
  organizationType: string;
  licenseNumber: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
}

const defaultProfile: ProfileData = {
  displayName: '',
  organizationName: '',
  organizationType: '',
  licenseNumber: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
};

export function useProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<ProfileData>(defaultProfile);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedProfile, setSavedProfile] = useState<ProfileData>(defaultProfile);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    const loadProfile = async () => {
      // First, try to load from API/server
      try {
        timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const serverProfile = data.profile;
          if (serverProfile) {
            const profileData: ProfileData = {
              displayName: serverProfile.displayName || '',
              organizationName: serverProfile.organizationName || '',
              organizationType: serverProfile.organizationType || '',
              licenseNumber: serverProfile.licenseNumber || '',
              address: serverProfile.address || '',
              city: serverProfile.city || '',
              state: serverProfile.state || '',
              zipCode: serverProfile.zipCode || '',
              phone: serverProfile.phone || '',
            };
            setProfile(profileData);
            setSavedProfile(profileData);
            // Also update localStorage for offline access
            localStorage.setItem(`${PROFILE_KEY}_${userId}`, JSON.stringify(profileData));
            setIsLoading(false);
            return;
          }
        }
      } catch (error) {
        // Ignore abort errors - they're expected on unmount or timeout
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch profile from API:', error);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Fallback to localStorage (also handles migration from old format)
      const stored = localStorage.getItem(`${PROFILE_KEY}_${userId}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          // Handle migration from old format (businessName -> organizationName)
          const migratedProfile: ProfileData = {
            displayName: parsed.displayName || '',
            organizationName: parsed.organizationName || parsed.businessName || '',
            organizationType: parsed.organizationType || parsed.businessType || '',
            licenseNumber: parsed.licenseNumber || '',
            address: parsed.address || '',
            city: parsed.city || '',
            state: parsed.state || '',
            zipCode: parsed.zipCode || '',
            phone: parsed.phone || '',
          };
          setProfile(migratedProfile);
          setSavedProfile(migratedProfile);
        } catch {
          // Invalid JSON, use defaults
        }
      }
      setIsLoading(false);
    };

    loadProfile();

    // Cleanup: abort any pending requests on unmount
    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [userId]);

  const updateField = useCallback(<K extends keyof ProfileData>(field: K, value: ProfileData[K]) => {
    setProfile(prev => {
      const updated = { ...prev, [field]: value };
      // Check if there are changes from saved version
      setHasChanges(JSON.stringify(updated) !== JSON.stringify(savedProfile));
      return updated;
    });
  }, [savedProfile]);

  const saveProfile = useCallback(async (): Promise<{ success: boolean; savedToCloud: boolean }> => {
    if (!userId) return { success: false, savedToCloud: false };

    setIsSaving(true);
    try {
      // Save to API/server first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let response;
      try {
        response = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            profile: {
              displayName: profile.displayName,
              organizationName: profile.organizationName,
              organizationType: profile.organizationType,
              licenseNumber: profile.licenseNumber,
              address: profile.address,
              city: profile.city,
              state: profile.state,
              zipCode: profile.zipCode,
              phone: profile.phone,
            },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const savedToCloud = response.ok;

      if (savedToCloud) {
        console.log('[useProfile] Profile saved to server successfully');
      } else {
        console.warn('[useProfile] Server save failed - response status:', response.status);
      }

      // Also save to localStorage for offline access
      localStorage.setItem(`${PROFILE_KEY}_${userId}`, JSON.stringify(profile));

      // Also update display name in its separate storage for consistency
      if (profile.displayName) {
        localStorage.setItem(`chapters_display_name_${userId}`, profile.displayName);
      }

      setSavedProfile(profile);
      setHasChanges(false);
      return { success: true, savedToCloud };
    } catch (error) {
      console.error('Failed to save profile to server:', error);
      // Even if server fails, save locally
      try {
        localStorage.setItem(`${PROFILE_KEY}_${userId}`, JSON.stringify(profile));
        if (profile.displayName) {
          localStorage.setItem(`chapters_display_name_${userId}`, profile.displayName);
        }
        setSavedProfile(profile);
        setHasChanges(false);
        return { success: true, savedToCloud: false };
      } catch {
        return { success: false, savedToCloud: false };
      }
    } finally {
      setIsSaving(false);
    }
  }, [userId, profile]);

  const resetChanges = useCallback(() => {
    setProfile(savedProfile);
    setHasChanges(false);
  }, [savedProfile]);

  return {
    profile,
    isLoading,
    isSaving,
    hasChanges,
    updateField,
    saveProfile,
    resetChanges,
  };
}
