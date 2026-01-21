// ============================================
// ORGANIZATIONS API ROUTE
// Loads user organizations from Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    const isAdmin = request.nextUrl.searchParams.get('isAdmin') === 'true';

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    let organizations;

    if (isAdmin) {
      // For admin users, return all organizations
      const allOrgs = await prisma.organization.findMany({
        orderBy: { name: 'asc' },
      });

      organizations = allOrgs.map(org => ({
        orgId: org.orgId,
        name: org.name,
        role: 'admin' as const,
      }));
    } else {
      // For regular users, return only their assigned organizations
      const userMappings = await prisma.userMapping.findMany({
        where: { userId },
        include: {
          organization: true,
        },
      });

      organizations = userMappings.map(mapping => ({
        orgId: mapping.organization.orgId,
        name: mapping.organization.name,
        role: mapping.role as 'admin' | 'member',
      }));
    }

    return NextResponse.json({
      success: true,
      data: { organizations },
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}
