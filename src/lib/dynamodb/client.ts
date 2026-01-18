import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Table names - using the same tables as chapters-website
export const TABLES = {
  organizations: process.env.NEXT_PUBLIC_DYNAMODB_ORG_TABLE || 'chapters-organizations',
  storefronts: process.env.NEXT_PUBLIC_DYNAMODB_STOREFRONT_TABLE || 'chapters-storefronts',
  userMappings: process.env.NEXT_PUBLIC_DYNAMODB_USER_TABLE || 'chapters-user-mappings',
};

// Create DynamoDB client with server-side AWS credentials
// This is used by API routes, not client-side code
export function getServerDynamoDBClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-west-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}
