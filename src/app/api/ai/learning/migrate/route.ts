// ============================================
// DATABASE MIGRATION API ROUTE
// Apply pending Prisma migrations via API call
// Protected by the same auth as other learning endpoints
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { isLearningApiAuthorized, unauthorizedResponse } from '../auth';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  // Verify authorization - same as other learning endpoints
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action = 'status' } = body;

    if (action === 'status') {
      // Check migration status
      const { stdout, stderr } = await execAsync('npx prisma migrate status', {
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 30000,
      });

      return NextResponse.json({
        success: true,
        data: {
          action: 'status',
          output: stdout,
          warnings: stderr || undefined,
        },
      });
    }

    if (action === 'deploy') {
      // Apply pending migrations
      const { stdout, stderr } = await execAsync('npx prisma migrate deploy', {
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 120000, // 2 minutes for migrations
      });

      return NextResponse.json({
        success: true,
        data: {
          action: 'deploy',
          output: stdout,
          warnings: stderr || undefined,
        },
      });
    }

    if (action === 'push') {
      // Alternative: Use db push (schema sync without migrations)
      const { stdout, stderr } = await execAsync('npx prisma db push --accept-data-loss', {
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 120000,
      });

      return NextResponse.json({
        success: true,
        data: {
          action: 'push',
          output: stdout,
          warnings: stderr || undefined,
        },
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use: status, deploy, or push',
    }, { status: 400 });

  } catch (error) {
    console.error('Migration error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Migration failed';
    const stderr = (error as { stderr?: string })?.stderr;

    return NextResponse.json({
      success: false,
      error: errorMessage,
      details: stderr || undefined,
    }, { status: 500 });
  }
}
