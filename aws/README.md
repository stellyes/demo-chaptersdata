# Learning System - AWS Deployment

This directory contains the AWS infrastructure for the autonomous learning system:
- **Daily Learning**: Runs every day at 5 AM UTC using Haiku/Sonnet (~$2.50/day)
- **Monthly Opus Analysis**: Runs on the 1st of each month at 6 AM UTC using Opus (~$10-15/month)

## Architecture

- **Lambda Functions**: Four functions (daily scheduled, daily manual, monthly scheduled, monthly manual)
- **EventBridge**: Two scheduled rules (daily at 5 AM UTC, monthly on 1st at 6 AM UTC)
- **CloudWatch**: Logs and failure alarms for both systems

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. The chapters-data Amplify app deployed and accessible
3. `LEARNING_API_KEY` environment variable set in Amplify

### Deploy Stack

```bash
aws cloudformation deploy \
  --template-file cloudformation-template.yaml \
  --stack-name daily-learning-production \
  --parameter-overrides \
    Environment=production \
    ApiEndpoint=https://your-amplify-app.amplifyapp.com \
    LearningApiKey=your-api-key \
  --capabilities CAPABILITY_NAMED_IAM
```

### Database Migration

Run the SQL migration against your PostgreSQL database:

```bash
psql -h your-db-host -U your-user -d your-database -f database-migration.sql
```

Or via Prisma:

```bash
npx prisma db push
```

## Manual Invocation

### Daily Learning
Trigger a daily learning job manually:

```bash
aws lambda invoke \
  --function-name daily-learning-manual-production \
  --payload '{"forceRun": false, "skipWebResearch": false}' \
  response.json
```

### Monthly Opus Analysis
Trigger a monthly analysis manually:

```bash
aws lambda invoke \
  --function-name monthly-analysis-manual-production \
  --payload '{"forceRun": false}' \
  response.json
```

To analyze a specific month:
```bash
aws lambda invoke \
  --function-name monthly-analysis-manual-production \
  --payload '{"monthYear": "2025-01", "forceRun": true}' \
  response.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `API_ENDPOINT` | Full URL to the Amplify app |
| `LEARNING_API_KEY` | API key for authentication |
| `ENVIRONMENT` | Deployment environment (production/staging) |

## Monitoring

### Daily Learning
- **CloudWatch Logs**: `/aws/lambda/daily-learning-scheduled-production`
- **Failure Alarm**: `daily-learning-failure-production`

### Monthly Opus Analysis
- **CloudWatch Logs**: `/aws/lambda/monthly-analysis-scheduled-production`
- **Failure Alarm**: `monthly-analysis-failure-production`

## Cost Estimate

### AWS Infrastructure
- Lambda: ~$0.02/month (daily + monthly executions)
- EventBridge: Free tier covers triggers
- CloudWatch Logs: ~$1/month for retention

### Claude API Costs
| System | Model | Frequency | Est. Cost |
|--------|-------|-----------|-----------|
| Daily Learning | Haiku + Sonnet | Daily | ~$75/month |
| Monthly Analysis | Opus | Monthly | ~$10-15/month |

### External APIs
- SerpAPI: ~$50/month (250 searches)

**Total Monthly Estimate: ~$135-140/month**
