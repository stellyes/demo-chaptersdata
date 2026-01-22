import { NextRequest, NextResponse } from 'next/server';
import { updateDisplayName } from '@/lib/db/profile';

// Helper to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    ),
  ]);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, displayName } = body;

    if (!userId || typeof displayName !== 'string') {
      return NextResponse.json(
        { error: 'userId and displayName are required' },
        { status: 400 }
      );
    }

    const success = await withTimeout(updateDisplayName(userId, displayName), 5000);

    return NextResponse.json({ success });
  } catch (error) {
    console.error('[API] Error updating display name:', error);
    const isTimeout = error instanceof Error && error.message === 'Request timeout';
    const statusCode = isTimeout ? 408 : 500;
    return NextResponse.json(
      { error: 'Failed to update display name', success: false },
      { status: statusCode }
    );
  }
}
