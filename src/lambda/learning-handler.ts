// ============================================
// LAMBDA HANDLER FOR LEARNING PIPELINE
// Invoked by Step Functions to execute individual
// phases of the daily learning pipeline.
//
// Each invocation runs a single phase, storing
// intermediate results in the database (jobMetadata).
// Step Functions orchestrates the phase sequence.
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Bootstrap: construct DATABASE_URL from Secrets Manager before importing Prisma
async function bootstrapDatabase(): Promise<void> {
  // Skip if already set (e.g., in dev/test)
  if (process.env.DATABASE_URL) return;

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN environment variable is required');
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-west-1' });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!response.SecretString) {
    throw new Error('Secret value is empty');
  }

  const secret = JSON.parse(response.SecretString) as { username: string; password: string };
  const encodedPassword = encodeURIComponent(secret.password);

  const host = process.env.DATABASE_HOST;
  const dbName = process.env.DATABASE_NAME || 'chapters_data';

  if (!host) {
    throw new Error('DATABASE_HOST environment variable is required');
  }

  const poolParams = [
    'sslmode=require',
    'connection_limit=10',
    'pool_timeout=30',
    'connect_timeout=15',
  ].join('&');

  process.env.DATABASE_URL = `postgresql://${secret.username}:${encodedPassword}@${host}:5432/${dbName}?${poolParams}`;
  console.log(`[Lambda] Database URL constructed for user: ${secret.username}`);
}

interface LearningEvent {
  action: 'initialize' | 'executePhase' | 'finalize' | 'skipPhase';
  jobId?: string;
  phase?: number;
  skipWebResearch?: boolean;
  forceRun?: boolean;
  skipReason?: string;
}

export const handler = async (event: LearningEvent) => {
  console.log(`[Lambda] Received event:`, JSON.stringify(event));

  // Bootstrap database connection from Secrets Manager
  await bootstrapDatabase();

  // Dynamic import to ensure DATABASE_URL is set before Prisma initializes
  const { dailyLearningService } = await import('@/lib/services/daily-learning');

  switch (event.action) {
    case 'initialize': {
      const result = await dailyLearningService.initializeJob({
        skipWebResearch: event.skipWebResearch,
        forceRun: event.forceRun ?? true,
      });
      return result;
    }

    case 'executePhase': {
      if (!event.jobId || !event.phase) {
        throw new Error('jobId and phase are required for executePhase');
      }
      const result = await dailyLearningService.executePhase(event.phase, event.jobId);
      return result;
    }

    case 'skipPhase': {
      if (!event.jobId || !event.phase) {
        throw new Error('jobId and phase are required for skipPhase');
      }
      const result = await dailyLearningService.skipPhase(
        event.phase,
        event.jobId,
        event.skipReason || 'skipped',
      );
      return result;
    }

    case 'finalize': {
      if (!event.jobId) {
        throw new Error('jobId is required for finalize');
      }
      const result = await dailyLearningService.finalizeJob(event.jobId);
      return result;
    }

    default:
      throw new Error(`Unknown action: ${event.action}`);
  }
};
