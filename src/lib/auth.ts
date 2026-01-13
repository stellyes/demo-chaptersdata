// ============================================
// AUTHENTICATION UTILITIES
// ============================================

import CryptoJS from 'crypto-js';
import { User } from '@/types';

// Hash password with SHA-256
export function hashPassword(password: string): string {
  return CryptoJS.SHA256(password).toString();
}

// Verify password against hash
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Default users (in production, these would come from environment variables or a database)
const DEFAULT_USERS: Record<string, { hash: string; role: 'admin' | 'analyst' }> = {
  admin: {
    hash: hashPassword('changeme123'),
    role: 'admin',
  },
  analyst: {
    hash: hashPassword('viewonly456'),
    role: 'analyst',
  },
};

// Get user configuration from environment or defaults
function getUserConfig(): Record<string, { hash: string; role: 'admin' | 'analyst' }> {
  // In production, this would read from environment variables
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  const analystHash = process.env.ANALYST_PASSWORD_HASH;

  if (adminHash || analystHash) {
    return {
      admin: {
        hash: adminHash || DEFAULT_USERS.admin.hash,
        role: 'admin',
      },
      analyst: {
        hash: analystHash || DEFAULT_USERS.analyst.hash,
        role: 'analyst',
      },
    };
  }

  return DEFAULT_USERS;
}

// Authenticate user
export function authenticateUser(
  username: string,
  password: string
): User | null {
  const users = getUserConfig();
  const user = users[username.toLowerCase()];

  if (!user) {
    return null;
  }

  if (verifyPassword(password, user.hash)) {
    return {
      username: username.toLowerCase(),
      role: user.role,
    };
  }

  return null;
}

// Check if user is admin
export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin';
}

// Generate session token (simple implementation)
export function generateSessionToken(user: User): string {
  const payload = {
    username: user.username,
    role: user.role,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };
  return CryptoJS.AES.encrypt(JSON.stringify(payload), process.env.SESSION_SECRET || 'chapters-secret-key').toString();
}

// Verify session token
export function verifySessionToken(token: string): User | null {
  try {
    const decrypted = CryptoJS.AES.decrypt(token, process.env.SESSION_SECRET || 'chapters-secret-key');
    const payload = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));

    if (payload.exp < Date.now()) {
      return null; // Token expired
    }

    return {
      username: payload.username,
      role: payload.role,
    };
  } catch {
    return null;
  }
}
