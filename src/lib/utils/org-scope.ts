/**
 * Organization scoping utilities.
 * Used to ensure data queries are filtered by the authenticated user's organization.
 */

import { prisma } from '@/lib/prisma';

// Cache storefront IDs per org to avoid repeated DB lookups
const storefrontCache = new Map<string, { ids: string[]; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get all storefront IDs belonging to an organization.
 * Results are cached for 5 minutes.
 */
export async function getOrgStorefrontIds(orgId: string): Promise<string[]> {
  const cached = storefrontCache.get(orgId);
  if (cached && Date.now() < cached.expires) {
    return cached.ids;
  }

  const org = await prisma.organization.findFirst({
    where: { orgId },
    include: { storefronts: { select: { storefrontId: true } } },
  });

  if (!org) {
    console.warn(`[org-scope] Organization not found: ${orgId}`);
    return [];
  }

  const ids = org.storefronts.map((s) => s.storefrontId);
  storefrontCache.set(orgId, { ids, expires: Date.now() + CACHE_TTL });
  return ids;
}

/**
 * Default org ID for the demo app.
 * In production with Cognito, this would be derived from the authenticated user's org assignment.
 */
export const DEMO_ORG_ID = 'demo-org-001';

/**
 * Get the storefront IDs to filter queries by.
 * For now, uses the demo org. When Cognito is fully wired,
 * this will read from the authenticated user's org context.
 */
export async function getActiveStorefrontIds(): Promise<string[]> {
  const ids = await getOrgStorefrontIds(DEMO_ORG_ID);
  // If org doesn't exist in the DB yet, return demo store IDs as fallback
  if (ids.length === 0) {
    return ['greenleaf', 'emerald'];
  }
  return ids;
}
