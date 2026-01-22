'use server';

/**
 * User Profile Database Operations
 *
 * This module provides user profile operations using Prisma.
 * Uses the same Aurora PostgreSQL database as chapters-website.
 */

import { prisma } from '../prisma';

export interface UserProfile {
  userId: string;
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

// Helper to convert Prisma profile to app type
function toUserProfile(dbProfile: {
  userId: string;
  displayName: string | null;
  organizationName: string | null;
  organizationType: string | null;
  licenseNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
}): UserProfile {
  return {
    userId: dbProfile.userId,
    displayName: dbProfile.displayName || '',
    organizationName: dbProfile.organizationName || '',
    organizationType: dbProfile.organizationType || '',
    licenseNumber: dbProfile.licenseNumber || '',
    address: dbProfile.address || '',
    city: dbProfile.city || '',
    state: dbProfile.state || '',
    zipCode: dbProfile.zipCode || '',
    phone: dbProfile.phone || '',
  };
}

// Get user profile by userId
// Returns null if not found
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      console.log('[Profile] No profile found for user:', userId);
      return null;
    }

    console.log('[Profile] Successfully loaded profile from database');
    return toUserProfile(profile);
  } catch (error) {
    console.error('[Profile] Error fetching profile:', error);
    throw error;
  }
}

// Create or update user profile
export async function saveUserProfile(
  userId: string,
  profile: Omit<UserProfile, 'userId'>
): Promise<UserProfile | null> {
  try {
    const savedProfile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        displayName: profile.displayName || null,
        organizationName: profile.organizationName || null,
        organizationType: profile.organizationType || null,
        licenseNumber: profile.licenseNumber || null,
        address: profile.address || null,
        city: profile.city || null,
        state: profile.state || null,
        zipCode: profile.zipCode || null,
        phone: profile.phone || null,
      },
      create: {
        userId,
        displayName: profile.displayName || null,
        organizationName: profile.organizationName || null,
        organizationType: profile.organizationType || null,
        licenseNumber: profile.licenseNumber || null,
        address: profile.address || null,
        city: profile.city || null,
        state: profile.state || null,
        zipCode: profile.zipCode || null,
        phone: profile.phone || null,
      },
    });

    console.log('[Profile] Successfully saved profile to database');
    return toUserProfile(savedProfile);
  } catch (error) {
    console.error('[Profile] Error saving profile:', error);
    throw error;
  }
}

// Update display name only (for quick updates)
export async function updateDisplayName(userId: string, displayName: string): Promise<boolean> {
  try {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { displayName },
      create: {
        userId,
        displayName,
        organizationName: null,
        organizationType: null,
        licenseNumber: null,
        address: null,
        city: null,
        state: null,
        zipCode: null,
        phone: null,
      },
    });

    return true;
  } catch (error) {
    console.error('[Profile] Error updating display name:', error);
    return false;
  }
}
