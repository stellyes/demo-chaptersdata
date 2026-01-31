import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { dailyLearningService } from '../src/lib/services/daily-learning';

async function test() {
  console.log('Starting daily learning test (Quick Run - skip web research)...');
  console.log('Time:', new Date().toISOString());
  
  try {
    // Check current status first
    const status = await dailyLearningService.getCurrentJobStatus();
    console.log('Current status:', JSON.stringify(status, null, 2));
    
    if (status.isRunning) {
      console.log('A job is already running, aborting test');
      return;
    }
    
    // Run with skipWebResearch to make it faster for testing
    console.log('\nStarting job...');
    const result = await dailyLearningService.runDailyLearning({ 
      forceRun: true, 
      skipWebResearch: true 
    });
    
    console.log('\n✅ Job completed successfully!');
    console.log('Job ID:', result.jobId);
    console.log('Digest generated:', result.digest ? 'Yes' : 'No');
    
    if (result.digest) {
      console.log('\nDigest Summary:');
      console.log('- Executive Summary:', result.digest.executiveSummary?.substring(0, 200) + '...');
      console.log('- Priority Actions:', result.digest.priorityActions?.length || 0);
      console.log('- Quick Wins:', result.digest.quickWins?.length || 0);
      console.log('- Data Health Score:', result.digest.dataHealthScore);
      console.log('- Confidence Score:', result.digest.confidenceScore);
    }
  } catch (error: any) {
    console.error('\n❌ Job failed:', error.message);
    if (error.stack) {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
  
  // Check final status
  const finalStatus = await dailyLearningService.getCurrentJobStatus();
  console.log('\nFinal status:', JSON.stringify(finalStatus, null, 2));
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
