import { NextRequest, NextResponse } from 'next/server';
import { withPrisma } from '@/lib/prisma';

/**
 * GET /api/admin/data-flags
 *
 * Retrieve data discrepancy flags for admin review.
 * Supports filtering by status, severity, flag_type, and pagination.
 *
 * Query parameters:
 * - status: pending | reviewed | resolved | ignored (default: pending)
 * - severity: critical | high | medium | low
 * - flag_type: vendor_mismatch | brand_mismatch | duplicate_record | missing_link | data_anomaly
 * - page: number (default: 1)
 * - pageSize: number (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || 'pending';
    const severity = searchParams.get('severity');
    const flagType = searchParams.get('flag_type');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50', 10), 100);

    const skip = (page - 1) * pageSize;

    return await withPrisma(async (prisma) => {
      // Build where clause
      const where: Record<string, unknown> = {};

      if (status && status !== 'all') {
        where.status = status;
      }

      if (severity) {
        where.severity = severity;
      }

      if (flagType) {
        where.flagType = flagType;
      }

      // Get total count for pagination
      const totalCount = await prisma.dataFlag.count({ where });

      // Get flags with pagination
      const flags = await prisma.dataFlag.findMany({
        where,
        orderBy: [
          { severity: 'asc' }, // critical first
          { createdAt: 'desc' }
        ],
        skip,
        take: pageSize,
        include: {
          storefront: {
            select: {
              name: true,
              storefrontId: true
            }
          }
        }
      });

      // Transform for frontend
      const transformedFlags = flags.map(flag => ({
        id: flag.id,
        flagType: flag.flagType,
        severity: flag.severity,
        status: flag.status,
        sourceTable: flag.sourceTable,
        sourceRecordId: flag.sourceRecordId,
        title: flag.title,
        description: flag.description,
        rawValue: flag.rawValue,
        suggestedMatch: flag.suggestedMatch,
        suggestedMatchId: flag.suggestedMatchId,
        similarityScore: flag.similarityScore ? Number(flag.similarityScore) : null,
        reviewedBy: flag.reviewedBy,
        reviewedAt: flag.reviewedAt?.toISOString(),
        resolution: flag.resolution,
        metadata: flag.metadata,
        createdAt: flag.createdAt.toISOString(),
        updatedAt: flag.updatedAt.toISOString(),
        storefront: flag.storefront ? {
          name: flag.storefront.name,
          id: flag.storefront.storefrontId
        } : null
      }));

      // Get summary stats
      const stats = await prisma.dataFlag.groupBy({
        by: ['status', 'severity', 'flagType'],
        _count: true
      });

      const summary = {
        byStatus: {} as Record<string, number>,
        bySeverity: {} as Record<string, number>,
        byType: {} as Record<string, number>
      };

      stats.forEach(stat => {
        summary.byStatus[stat.status] = (summary.byStatus[stat.status] || 0) + stat._count;
        summary.bySeverity[stat.severity] = (summary.bySeverity[stat.severity] || 0) + stat._count;
        summary.byType[stat.flagType] = (summary.byType[stat.flagType] || 0) + stat._count;
      });

      return NextResponse.json({
        success: true,
        data: transformedFlags,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          hasMore: skip + pageSize < totalCount
        },
        summary
      });
    });

  } catch (error) {
    console.error('Error fetching data flags:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data flags' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/data-flags
 *
 * Update a data flag (resolve, ignore, mark reviewed).
 *
 * Body:
 * - id: string (required) - Flag ID to update
 * - status: string - New status (reviewed | resolved | ignored)
 * - resolution: string - Resolution notes
 * - reviewedBy: string - Who reviewed
 * - suggestedMatchId: string - If accepting a suggested match
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, resolution, reviewedBy, suggestedMatchId } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Flag ID is required' },
        { status: 400 }
      );
    }

    return await withPrisma(async (prisma) => {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date()
      };

      if (status) {
        updateData.status = status;
      }

      if (resolution) {
        updateData.resolution = resolution;
      }

      if (reviewedBy) {
        updateData.reviewedBy = reviewedBy;
        updateData.reviewedAt = new Date();
      }

      if (suggestedMatchId) {
        updateData.suggestedMatchId = suggestedMatchId;
      }

      const updated = await prisma.dataFlag.update({
        where: { id },
        data: updateData
      });

      // If resolving a vendor or brand mismatch with a suggested match,
      // we could automatically add it to the alias table
      if (status === 'resolved' && suggestedMatchId && updated.rawValue) {
        if (updated.flagType === 'vendor_mismatch') {
          // Add vendor alias
          try {
            await prisma.vendorAlias.create({
              data: {
                vendorId: suggestedMatchId,
                aliasName: updated.rawValue
              }
            });
          } catch {
            // Alias might already exist, ignore
          }
        } else if (updated.flagType === 'brand_mismatch') {
          // Add brand alias
          try {
            await prisma.brandAlias.create({
              data: {
                brandId: suggestedMatchId,
                aliasName: updated.rawValue
              }
            });
          } catch {
            // Alias might already exist, ignore
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          id: updated.id,
          status: updated.status,
          resolution: updated.resolution,
          reviewedBy: updated.reviewedBy,
          reviewedAt: updated.reviewedAt?.toISOString()
        }
      });
    });

  } catch (error) {
    console.error('Error updating data flag:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update data flag' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/data-flags/bulk
 *
 * Bulk update flags (e.g., ignore all low severity flags of a certain type).
 *
 * Body:
 * - ids: string[] - Flag IDs to update
 * - status: string - New status
 * - resolution: string - Resolution notes
 * - reviewedBy: string - Who reviewed
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, status, resolution, reviewedBy, action } = body;

    // Bulk action
    if (action === 'bulk_update' && ids && Array.isArray(ids) && ids.length > 0) {
      return await withPrisma(async (prisma) => {
        const updateData: Record<string, unknown> = {
          updatedAt: new Date()
        };

        if (status) {
          updateData.status = status;
        }

        if (resolution) {
          updateData.resolution = resolution;
        }

        if (reviewedBy) {
          updateData.reviewedBy = reviewedBy;
          updateData.reviewedAt = new Date();
        }

        const result = await prisma.dataFlag.updateMany({
          where: {
            id: { in: ids }
          },
          data: updateData
        });

        return NextResponse.json({
          success: true,
          updated: result.count
        });
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Error in bulk operation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to perform bulk operation' },
      { status: 500 }
    );
  }
}
