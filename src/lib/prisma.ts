/**
 * Prisma Client Singleton
 *
 * This module provides a singleton instance of PrismaClient for use throughout
 * the application. It handles the common issue of multiple PrismaClient instances
 * being created in development due to hot reloading.
 */

import { PrismaClient } from '@prisma/client';

// Declare the global type for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Create a singleton PrismaClient instance
// In development, store it on globalThis to prevent multiple instances from hot reloading
export const prisma = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
});

// Store on global in development to prevent multiple instances
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export default prisma;
