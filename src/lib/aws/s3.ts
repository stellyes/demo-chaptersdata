// ============================================
// AWS S3 CLIENT & OPERATIONS
// ============================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { AWS_CONFIG, S3_PATHS } from '@/lib/config';
import { StoreId, UploadMetadata } from '@/types';

// Initialize S3 client (server-side only)
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: AWS_CONFIG.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

// Upload file to S3
export async function uploadToS3(
  key: string,
  content: string | Buffer,
  contentType: string = 'text/csv'
): Promise<void> {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: AWS_CONFIG.bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    })
  );
}

// Download file from S3
export async function downloadFromS3(key: string): Promise<string> {
  const client = getS3Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: AWS_CONFIG.bucket,
      Key: key,
    })
  );

  const body = await response.Body?.transformToString();
  return body || '';
}

// List files in S3 prefix
export async function listS3Files(prefix: string): Promise<string[]> {
  const client = getS3Client();

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: AWS_CONFIG.bucket,
      Prefix: prefix,
    })
  );

  return response.Contents?.map(obj => obj.Key || '') || [];
}

// Delete file from S3
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: AWS_CONFIG.bucket,
      Key: key,
    })
  );
}

// Generate S3 key for data upload
export function generateDataKey(
  storeId: StoreId,
  dataType: 'sales' | 'brand' | 'product' | 'customers',
  dateRange: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${S3_PATHS.rawUploads}/${storeId}/${dataType}_${dateRange}_${timestamp}.csv`;
}

// Upload sales data
export async function uploadSalesData(
  storeId: StoreId,
  csvContent: string,
  metadata: UploadMetadata
): Promise<string> {
  const dateRange = `${metadata.start_date}_${metadata.end_date}`.replace(/\//g, '-');
  const key = generateDataKey(storeId, 'sales', dateRange);

  await uploadToS3(key, csvContent, 'text/csv');

  // Also save metadata
  const metadataKey = key.replace('.csv', '_metadata.json');
  await uploadToS3(metadataKey, JSON.stringify(metadata), 'application/json');

  return key;
}

// Upload brand data
export async function uploadBrandData(
  storeId: StoreId,
  csvContent: string,
  metadata: UploadMetadata
): Promise<string> {
  const dateRange = `${metadata.start_date}_${metadata.end_date}`.replace(/\//g, '-');
  const key = generateDataKey(storeId, 'brand', dateRange);

  await uploadToS3(key, csvContent, 'text/csv');

  const metadataKey = key.replace('.csv', '_metadata.json');
  await uploadToS3(metadataKey, JSON.stringify(metadata), 'application/json');

  return key;
}

// Upload product data
export async function uploadProductData(
  storeId: StoreId,
  csvContent: string,
  metadata: UploadMetadata
): Promise<string> {
  const dateRange = `${metadata.start_date}_${metadata.end_date}`.replace(/\//g, '-');
  const key = generateDataKey(storeId, 'product', dateRange);

  await uploadToS3(key, csvContent, 'text/csv');

  const metadataKey = key.replace('.csv', '_metadata.json');
  await uploadToS3(metadataKey, JSON.stringify(metadata), 'application/json');

  return key;
}

// Load all sales data from S3
export async function loadAllSalesData(): Promise<{ data: string; metadata: UploadMetadata }[]> {
  const files = await listS3Files(`${S3_PATHS.rawUploads}/`);
  const salesFiles = files.filter(f => f.includes('/sales_') && f.endsWith('.csv'));

  const results: { data: string; metadata: UploadMetadata }[] = [];

  for (const file of salesFiles) {
    try {
      const data = await downloadFromS3(file);
      const metadataKey = file.replace('.csv', '_metadata.json');
      const metadataStr = await downloadFromS3(metadataKey);
      const metadata = JSON.parse(metadataStr) as UploadMetadata;
      results.push({ data, metadata });
    } catch (error) {
      console.error(`Error loading ${file}:`, error);
    }
  }

  return results;
}

// Load research documents
export async function loadResearchDocuments(days: number = 30): Promise<string[]> {
  const prefix = `${S3_PATHS.researchDocuments}/`;
  return listS3Files(prefix);
}

// Upload research document
export async function uploadResearchDocument(
  filename: string,
  content: string,
  category: string,
  sourceUrl?: string
): Promise<string> {
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const docId = `doc_${Date.now()}`;
  const key = `${S3_PATHS.researchDocuments}/${datePath}/${docId}_${filename}`;

  await uploadToS3(key, content, 'text/html');

  // Save metadata
  const metadata = {
    id: docId,
    filename,
    s3_key: key,
    category,
    source_url: sourceUrl,
    uploaded_at: now.toISOString(),
  };

  const metadataKey = key.replace(/\.[^.]+$/, '_metadata.json');
  await uploadToS3(metadataKey, JSON.stringify(metadata), 'application/json');

  return key;
}

// Load latest research summary
export async function loadResearchSummary(): Promise<string | null> {
  try {
    return await downloadFromS3(`${S3_PATHS.researchFindings}/summary/latest.json`);
  } catch {
    return null;
  }
}

// Load SEO summary for a site
export async function loadSEOSummary(site: string): Promise<string | null> {
  try {
    return await downloadFromS3(`${S3_PATHS.seoAnalysis}/${site}/summary/latest.json`);
  } catch {
    return null;
  }
}
