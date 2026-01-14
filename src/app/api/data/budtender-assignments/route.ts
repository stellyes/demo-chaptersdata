// ============================================
// BUDTENDER ASSIGNMENTS API ROUTE
// Saves and loads budtender store assignments to/from S3
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { StoreId } from '@/types';

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';
const ASSIGNMENTS_KEY = 'config/budtender_assignments.json';

interface BudtenderAssignments {
  assignments: Record<string, StoreId>;
  last_updated: string;
}

// GET - Load budtender assignments from S3
export async function GET() {
  try {
    const client = getS3Client();

    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: ASSIGNMENTS_KEY })
      );
      const jsonData = await response.Body?.transformToString();

      if (jsonData) {
        const data: BudtenderAssignments = JSON.parse(jsonData);
        return NextResponse.json({
          success: true,
          data: data,
        });
      }
    } catch (error) {
      // File doesn't exist yet - return empty assignments
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return NextResponse.json({
          success: true,
          data: {
            assignments: {},
            last_updated: new Date().toISOString(),
          },
        });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        assignments: {},
        last_updated: new Date().toISOString(),
      },
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

// POST - Save budtender assignments to S3
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const assignments: Record<string, StoreId> = body.assignments || {};

    const data: BudtenderAssignments = {
      assignments,
      last_updated: new Date().toISOString(),
    };

    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: ASSIGNMENTS_KEY,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      })
    );

    return NextResponse.json({
      success: true,
      data: data,
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
