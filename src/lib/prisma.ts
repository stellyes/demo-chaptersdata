/**
 * Prisma Client Singleton with Dynamic Credentials
 *
 * This module provides a singleton instance of PrismaClient that fetches
 * database credentials dynamically from AWS Secrets Manager. This prevents
 * authentication failures when RDS automatic password rotation occurs.
 *
 * IMPORTANT: In serverless environments, the Prisma client must be created
 * with the correct datasource URL at instantiation time. Connection pool
 * parameters in the URL are only applied during client creation.
 */

import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl, clearDatabaseUrlCache } from './secrets';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaInitialized: boolean | undefined;
  // eslint-disable-next-line no-var
  var prismaDatasourceUrl: string | undefined;
}

// Create a Prisma client with explicit datasource URL
// This ensures connection pool parameters are properly applied
const createPrismaClient = (datasourceUrl?: string) => {
  const config: ConstructorParameters<typeof PrismaClient>[0] = {
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  };

  // If we have a datasource URL, use it explicitly
  // This ensures connection pool params are applied at creation time
  if (datasourceUrl) {
    config.datasources = {
      db: {
        url: datasourceUrl,
      },
    };
  }

  return new PrismaClient(config);
};

// Lazy singleton - don't create until first use
// This allows us to fetch credentials before creating the client
let _prisma: PrismaClient | undefined = globalThis.prisma;

// Export a getter that returns the prisma instance
// For backwards compatibility with code that imports `prisma` directly
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!_prisma) {
      // Fallback: create with env var if not initialized
      _prisma = createPrismaClient(process.env.DATABASE_URL);
      if (process.env.NODE_ENV !== 'production') {
        globalThis.prisma = _prisma;
      }
    }
    return (_prisma as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Initializes Prisma with fresh credentials from Secrets Manager.
 * Call this before making database queries to ensure valid credentials.
 *
 * In production, this fetches credentials from AWS Secrets Manager.
 * In development, it uses the DATABASE_URL from environment variables.
 *
 * IMPORTANT: This function creates a new PrismaClient with the correct
 * datasource URL, ensuring connection pool parameters are properly applied.
 */
export async function initializePrisma(): Promise<PrismaClient> {
  // Skip re-initialization if already done and not in production
  // In production, we still want to check for rotated credentials periodically
  if (globalThis.prismaInitialized && process.env.NODE_ENV !== 'production') {
    if (_prisma) return _prisma;
  }

  try {
    const databaseUrl = await getDatabaseUrl();

    // Check if we need to recreate the client with new URL
    // This is important for applying connection pool parameters
    const needsNewClient = !_prisma || globalThis.prismaDatasourceUrl !== databaseUrl;

    if (needsNewClient) {
      // Disconnect old client if it exists
      if (_prisma) {
        try {
          await _prisma.$disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }

      // Create new client with the correct datasource URL
      // This ensures connection pool params (connection_limit, pool_timeout, etc.) are applied
      _prisma = createPrismaClient(databaseUrl);
      globalThis.prismaDatasourceUrl = databaseUrl;

      if (process.env.NODE_ENV !== 'production') {
        globalThis.prisma = _prisma;
      }
    }

    // Also update env var for any code that reads it directly
    process.env.DATABASE_URL = databaseUrl;

    // At this point _prisma is guaranteed to exist
    const client = _prisma!;

    // Test the connection
    await client.$connect();
    globalThis.prismaInitialized = true;

    return client;
  } catch (error) {
    // If connection fails, clear the cache and try once more with fresh credentials
    clearDatabaseUrlCache();
    const freshUrl = await getDatabaseUrl();

    // Disconnect old client if it exists
    if (_prisma) {
      try {
        await _prisma.$disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    // Create new client with fresh credentials
    _prisma = createPrismaClient(freshUrl);
    globalThis.prismaDatasourceUrl = freshUrl;
    process.env.DATABASE_URL = freshUrl;

    if (process.env.NODE_ENV !== 'production') {
      globalThis.prisma = _prisma;
    }

    await _prisma.$connect();
    globalThis.prismaInitialized = true;

    return _prisma;
  }
}

/**
 * Wrapper for database operations that ensures credentials are valid.
 * Automatically retries with fresh credentials if authentication fails.
 * Also handles connection pool timeouts with disconnect/reconnect.
 */
export async function withPrisma<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
  // Ensure we have an initialized client
  const client = await initializePrisma();

  try {
    return await operation(client);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if this is an authentication error
    if (errorMessage.includes('Authentication failed') ||
        errorMessage.includes('password authentication failed')) {
      console.warn('Database authentication failed, refreshing credentials...');
      clearDatabaseUrlCache();
      const freshClient = await initializePrisma();
      return await operation(freshClient);
    }

    // Check if this is a connection pool timeout
    if (errorMessage.includes('Timed out fetching a new connection') ||
        errorMessage.includes('connection pool')) {
      console.warn('Database connection pool timeout, attempting reconnect...');
      clearDatabaseUrlCache();
      const freshClient = await initializePrisma();
      return await operation(freshClient);
    }

    throw error;
  }
}

/**
 * Get the current Prisma client instance.
 * Prefer using withPrisma() or initializePrisma() for proper initialization.
 */
export function getPrismaClient(): PrismaClient {
  if (!_prisma) {
    _prisma = createPrismaClient(process.env.DATABASE_URL);
    if (process.env.NODE_ENV !== 'production') {
      globalThis.prisma = _prisma;
    }
  }
  return _prisma;
}

export default prisma;
