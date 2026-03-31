import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, utm } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    }

    // Sanitize before logging
    const safeEmail = email.trim().toLowerCase().slice(0, 254);
    const safeUtm = utm ? String(utm).slice(0, 64) : null;

    // Log to CloudWatch (Amplify Lambda)
    console.log(JSON.stringify({
      event: 'demo_lead_capture',
      email: safeEmail,
      utm: safeUtm,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
