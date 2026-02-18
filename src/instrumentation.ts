/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js when the server starts.
 * It runs BEFORE any request is handled, making it the ideal place to
 * initialize the Prisma client with fresh credentials from Secrets Manager.
 *
 * Without this, the Prisma proxy fallback would use the (potentially stale)
 * DATABASE_URL environment variable baked into the Amplify build, which
 * breaks after RDS automatic password rotation.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only initialize on the Node.js server runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initializePrisma } = await import('@/lib/prisma');
      await initializePrisma();
      console.log('[instrumentation] Prisma initialized with Secrets Manager credentials');
    } catch (error) {
      console.error('[instrumentation] Failed to initialize Prisma from Secrets Manager:', error);
      // Don't throw — let the app start and fall back to DATABASE_URL env var.
      // The withPrisma() wrapper and Proxy fallback will still attempt connections.
    }
  }
}
