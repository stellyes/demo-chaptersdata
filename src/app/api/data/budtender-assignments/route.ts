// ============================================
// BUDTENDER ASSIGNMENTS API ROUTE
// Saves and loads budtender store assignments from Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StoreId } from '@/types';

interface BudtenderAssignments {
  assignments: Record<string, StoreId>;
  last_updated: string;
}

// GET - Load budtender assignments from Aurora
export async function GET() {
  try {
    const assignments = await prisma.budtenderAssignment.findMany();

    // Transform to the expected format
    const assignmentsMap: Record<string, StoreId> = {};
    let latestUpdate = new Date(0);

    for (const assignment of assignments) {
      assignmentsMap[assignment.employeeName] = assignment.storeId as StoreId;
      if (assignment.updatedAt > latestUpdate) {
        latestUpdate = assignment.updatedAt;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        assignments: assignmentsMap,
        last_updated: assignments.length > 0 ? latestUpdate.toISOString() : new Date().toISOString(),
      },
      source: 'aurora',
    });
  } catch (error) {
    console.error('Error loading budtender assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load assignments',
      },
      { status: 500 }
    );
  }
}

// POST - Save budtender assignments to Aurora
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const assignments: Record<string, StoreId> = body.assignments || {};

    // Upsert each assignment
    for (const [employeeName, storeId] of Object.entries(assignments)) {
      await prisma.budtenderAssignment.upsert({
        where: { employeeName },
        create: {
          employeeName,
          storeId,
        },
        update: {
          storeId,
        },
      });
    }

    // Get updated data
    const updatedAssignments = await prisma.budtenderAssignment.findMany();
    const assignmentsMap: Record<string, StoreId> = {};
    for (const assignment of updatedAssignments) {
      assignmentsMap[assignment.employeeName] = assignment.storeId as StoreId;
    }

    const data: BudtenderAssignments = {
      assignments: assignmentsMap,
      last_updated: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: data,
      source: 'aurora',
    });
  } catch (error) {
    console.error('Error saving budtender assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save assignments',
      },
      { status: 500 }
    );
  }
}
