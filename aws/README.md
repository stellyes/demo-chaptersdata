# Daily Learning System - AWS Deployment

This directory contains the AWS infrastructure for the autonomous daily learning system.

## Architecture

- **Lambda Functions**: Two functions for scheduled and manual triggers
- **EventBridge**: Scheduled rule runs daily at 5 AM UTC (9 PM PST)
- **CloudWatch**: Logs and failure alarms

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

Trigger a learning job manually via AWS CLI:

```bash
aws lambda invoke \
  --function-name daily-learning-manual-production \
  --payload '{"forceRun": false, "skipWebResearch": false}' \
  response.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `API_ENDPOINT` | Full URL to the Amplify app |
| `LEARNING_API_KEY` | API key for authentication |
| `ENVIRONMENT` | Deployment environment (production/staging) |

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/daily-learning-scheduled-production`
- **Failure Alarm**: `daily-learning-failure-production`

## Cost Estimate

- Lambda: ~$0.01/month (one execution per day)
- EventBridge: Free tier covers daily triggers
- CloudWatch Logs: ~$0.50/month for retention

Total AWS infrastructure cost: ~$1/month
