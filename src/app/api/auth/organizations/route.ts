import { NextRequest, NextResponse } from 'next/server';
import { getUserOrganizations, getAllOrganizations } from '@/lib/dynamodb/organizations';

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

    // For admin users, return all organizations
    // For regular users, return only their assigned organizations
    let organizations;
    if (isAdmin) {
      const allOrgs = await getAllOrganizations();
      organizations = allOrgs.map(org => ({
        orgId: org.id,
        name: org.name,
        role: 'admin' as const,
      }));
    } else {
      const userOrgs = await getUserOrganizations(userId);
      organizations = userOrgs.map(uo => ({
        orgId: uo.organization.id,
        name: uo.organization.name,
        role: uo.role,
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
