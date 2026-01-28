/**
 * Prisma Client Singleton with Dynamic Credentials
 *
 * This module provides a singleton instance of PrismaClient that fetches
 * database credentials dynamically from AWS Secrets Manager. This prevents
 * authentication failures when RDS automatic password rotation occurs.
 */

import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl, clearDatabaseUrlCache } from './secrets';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaInitialized: boolean | undefined;
}

// Create a base PrismaClient instance
// The actual connection URL will be set dynamically
const createPrismaClient = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });
};

// Singleton instance
export const prisma = globalThis.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

/**
 * Initializes Prisma with fresh credentials from Secrets Manager.
 * Call this before making database queries to ensure valid credentials.
 *
 * In production, this fetches credentials from AWS Secrets Manager.
 * In development, it uses the DATABASE_URL from environment variables.
 */
export async function initializePrisma(): Promise<PrismaClient> {
  // Skip re-initialization if already done and not in production
  // In production, we still want to check for rotated credentials periodically
  if (globalThis.prismaInitialized && process.env.NODE_ENV !== 'production') {
    return prisma;
  }

  try {
    const databaseUrl = await getDatabaseUrl();

    // Prisma doesn't support changing the URL after initialization,
    // but the connection pool will use the URL from the environment.
    // We update the environment variable so new connections use fresh credentials.
    process.env.DATABASE_URL = databaseUrl;

    // Test the connection
    await prisma.$connect();
    globalThis.prismaInitialized = true;

    return prisma;
  } catch (error) {
    // If connection fails, clear the cache and try once more with fresh credentials
    clearDatabaseUrlCache();
    const freshUrl = await getDatabaseUrl();
    process.env.DATABASE_URL = freshUrl;

    // Disconnect and reconnect with new credentials
    await prisma.$disconnect();
    await prisma.$connect();
    globalThis.prismaInitialized = true;

    return prisma;
  }
}

/**
 * Wrapper for database operations that ensures credentials are valid.
 * Automatically retries with fresh credentials if authentication fails.
 */
export async function withPrisma<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
  try {
    return await operation(prisma);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if this is an authentication error
    if (errorMessage.includes('Authentication failed') ||
        errorMessage.includes('password authentication failed')) {
      console.warn('Database authentication failed, refreshing credentials...');
      clearDatabaseUrlCache();
      await initializePrisma();
      return await operation(prisma);
    }

    throw error;
  }
}

export default prisma;
