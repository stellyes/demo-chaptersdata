import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile, saveUserProfile } from '@/lib/db/profile';

// Helper to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    ),
  ]);
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const profile = await withTimeout(getUserProfile(userId), 5000);

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[API] Error fetching profile:', error);
    const isTimeout = error instanceof Error && error.message === 'Request timeout';
    const statusCode = isTimeout ? 408 : 500;
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, profile } = body;

    if (!userId || !profile) {
      return NextResponse.json(
        { error: 'userId and profile are required' },
        { status: 400 }
      );
    }

    const savedProfile = await withTimeout(saveUserProfile(userId, profile), 5000);

    return NextResponse.json({ profile: savedProfile });
  } catch (error) {
    console.error('[API] Error saving profile:', error);
    const isTimeout = error instanceof Error && error.message === 'Request timeout';
    const statusCode = isTimeout ? 408 : 500;
    return NextResponse.json(
      { error: 'Failed to save profile' },
      { status: statusCode }
    );
  }
}
