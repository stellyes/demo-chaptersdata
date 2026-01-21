// ============================================
// SEO AUDIT DETAIL API ROUTE
// Get audit details and pages
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Get audit details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    const audit = await prisma.seoAudit.findUnique({
      where: { id: auditId },
      include: {
        pages: {
          orderBy: { crawledAt: 'asc' },
        },
      },
    });

    if (!audit) {
      return NextResponse.json(
        { success: false, error: 'Audit not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: audit,
    });
  } catch (error) {
    console.error('Error fetching SEO audit:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch audit' },
      { status: 500 }
    );
  }
}

// DELETE - Delete an audit
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    await prisma.seoAudit.delete({
      where: { id: auditId },
    });

    return NextResponse.json({
      success: true,
      message: 'Audit deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting SEO audit:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete audit' },
      { status: 500 }
    );
  }
}
