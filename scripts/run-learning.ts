/**
 * Run Progressive Learning Job
 *
 * Run with: npx tsx scripts/run-learning.ts
 */

import { dailyLearningService } from '../src/lib/services/daily-learning';

async function main() {
  console.log('========================================');
  console.log('Starting Progressive Learning Job');
  console.log('========================================\n');

  console.log('Running full learning cycle...\n');

  const result = await dailyLearningService.runDailyLearning({
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
    console.log('  Executive Summary:', result.digest.executiveSummary?.substring(0, 150) + '...');
    console.log('  Priority Actions:', result.digest.priorityActions?.length || 0);
    console.log('  Quick Wins:', result.digest.quickWins?.length || 0);
    console.log('  Watch Items:', result.digest.watchItems?.length || 0);
    console.log('  Industry Highlights:', result.digest.industryHighlights?.length || 0);
    console.log('  Questions for Tomorrow:', result.digest.questionsForTomorrow?.length || 0);
    console.log('  Correlated Insights:', result.digest.correlatedInsights?.length || 0);
    console.log('  Data Health Score:', result.digest.dataHealthScore || 0);
    console.log('  Confidence Score:', result.digest.confidenceScore || 0);

    if (result.digest.priorityActions && result.digest.priorityActions.length > 0) {
      console.log('\nTop Priority Actions:');
      for (const action of result.digest.priorityActions.slice(0, 3)) {
        console.log('  -', action.action?.substring(0, 80) + '...');
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
