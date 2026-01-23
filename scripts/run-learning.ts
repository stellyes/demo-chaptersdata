/**
 * Run Progressive Learning Job
 *
 * Run with: npx tsx scripts/run-learning.ts
 */

import { DailyLearningService } from '../src/lib/services/daily-learning';

async function main() {
  console.log('========================================');
  console.log('Starting Progressive Learning Job');
  console.log('========================================\n');

  const service = new DailyLearningService();

  console.log('Running full learning cycle...\n');

  const result = await service.runDailyLearning({
    forceRun: true,
    skipWebResearch: false,
  });

  console.log('\n========================================');
  console.log('Learning Job Complete');
  console.log('========================================');
  console.log('Job ID:', result.jobId);

  const hasDigest = result.digest !== null && result.digest !== undefined;
  console.log('Has Digest:', hasDigest);

  if (result.digest) {
    console.log('\nDigest Summary:');
    console.log('  Key Findings:', result.digest.keyFindings?.length || 0);
    console.log('  Suggested Questions:', result.digest.suggestedQuestions?.length || 0);

    if (result.digest.keyFindings && result.digest.keyFindings.length > 0) {
      console.log('\nTop Findings:');
      for (const finding of result.digest.keyFindings.slice(0, 5)) {
        console.log('  -', finding.substring(0, 100) + '...');
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Learning failed:', err.message);
    process.exit(1);
  });
