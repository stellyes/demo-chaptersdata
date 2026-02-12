/**
 * AWS Secrets Manager Integration
 *
 * Fetches database credentials dynamically from AWS Secrets Manager.
 * This prevents authentication failures when RDS automatic password rotation occurs.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { fromContainerMetadata } from '@aws-sdk/credential-providers';

const RDS_SECRET_ARN = 'arn:aws:secretsmanager:us-west-1:716121312511:secret:rds!cluster-f89505b1-a495-4483-b282-15d58e2df95e-vOlOPD';
const DB_HOST = 'chapters-data-cluster.cluster-crcoymcou3hf.us-west-1.rds.amazonaws.com';
const DB_PORT = '5432';
const DB_NAME = 'chapters_data';

interface RDSSecret {
  username: string;
  password: string;
}

let cachedDatabaseUrl: string | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches database credentials from Secrets Manager and constructs the DATABASE_URL.
 * Caches the result for 5 minutes to avoid excessive API calls.
 */
export async function getDatabaseUrl(): Promise<string> {
  // Return cached URL if still valid
  if (cachedDatabaseUrl && Date.now() < cacheExpiry) {
    return cachedDatabaseUrl;
  }

  // In development, prefer local env var if set (for offline development)
  if (process.env.NODE_ENV === 'development' && process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  try {
    // In Amplify SSR compute, use the IAM compute role credentials via the
    // container metadata endpoint. This bypasses the static S3 IAM user keys
    // in AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY that would otherwise take
    // precedence in the default credential chain.
    const client = new SecretsManagerClient({
      region: 'us-west-1',
      ...(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
        ? { credentials: fromContainerMetadata() }
        : {}),
    });
    const command = new GetSecretValueCommand({ SecretId: RDS_SECRET_ARN });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error('Secret value is empty');
    }

    const secret: RDSSecret = JSON.parse(response.SecretString);

    // URL-encode the password to handle special characters
    const encodedPassword = encodeURIComponent(secret.password);

    // Connection pool parameters optimized for Aurora Serverless with Next.js/Amplify:
    // - connection_limit: Max connections in pool (Aurora Serverless scales automatically)
    // - pool_timeout: Seconds to wait for a connection from the pool
    // - connect_timeout: Seconds to wait for new connection to DB
    // Aurora Serverless v2 supports many concurrent connections, so we can use higher limits
    const poolParams = [
      'sslmode=require',
      'connection_limit=20',     // Higher limit since Aurora Serverless scales
      'pool_timeout=30',         // Wait up to 30s for connection from pool
      'connect_timeout=15',      // Wait up to 15s to establish new connection
    ].join('&');

    cachedDatabaseUrl = `postgresql://${secret.username}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}?${poolParams}`;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return cachedDatabaseUrl;
  } catch (error) {
    // Fallback to environment variable if Secrets Manager fails
    if (process.env.DATABASE_URL) {
      console.warn('Failed to fetch from Secrets Manager, using DATABASE_URL env var:', error);
      return process.env.DATABASE_URL;
    }
    throw new Error(`Failed to get database credentials: ${error}`);
  }
}

/**
 * Clears the cached database URL, forcing a fresh fetch on next request.
 * Useful when a connection error suggests credentials may have been rotated.
 */
export function clearDatabaseUrlCache(): void {
  cachedDatabaseUrl = null;
  cacheExpiry = 0;
}
