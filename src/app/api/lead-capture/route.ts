import { NextRequest, NextResponse } from 'next/server';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { fromContainerMetadata } from '@aws-sdk/credential-providers';

const NOTIFY_TO = 'info@chaptersdata.com';
const NOTIFY_FROM = 'info@chaptersdata.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

function getSESClient() {
  const useContainerCreds = !!process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  return new SESClient({
    region: SES_REGION,
    ...(useContainerCreds ? { credentials: fromContainerMetadata() } : {}),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { email, utm } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    }

    const safeEmail = email.trim().toLowerCase().slice(0, 254);
    const safeUtm = utm ? String(utm).slice(0, 64) : null;

    const utmLine = safeUtm ? `\nSource: ${safeUtm}` : '';

    const ses = getSESClient();
    await ses.send(new SendEmailCommand({
      Source: NOTIFY_FROM,
      Destination: { ToAddresses: [NOTIFY_TO] },
      Message: {
        Subject: { Data: `Demo lead: ${safeEmail}` },
        Body: {
          Text: {
            Data: `New demo lead from demo.chaptersdata.com\n\nEmail: ${safeEmail}${utmLine}\nTime: ${new Date().toISOString()}`,
          },
        },
      },
    }));

    // Also log to CloudWatch as backup
    console.log(JSON.stringify({
      event: 'demo_lead_capture',
      email: safeEmail,
      utm: safeUtm,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[lead-capture] SES send failed:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
