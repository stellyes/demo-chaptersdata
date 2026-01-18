/**
 * Setup Script for Test Users
 *
 * This script creates the necessary DynamoDB entries for user-organization mappings.
 * Users must already exist in AWS Cognito before running this script.
 *
 * Run with: npx ts-node --esm scripts/setup-test-users.ts
 *
 * Prerequisites:
 * 1. Create users in AWS Cognito User Pool (us-west-1_NdtWC2kmG):
 *    - info@chaptersdata.com (Admin user - add to "Admins" group)
 *    - testclient@chaptersdata.com (Test client user)
 *
 * 2. Ensure the organization "BCSF, Inc" exists in DynamoDB
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Configuration
const AWS_REGION = 'us-west-1';
const TABLES = {
  organizations: 'chapters-organizations',
  storefronts: 'chapters-storefronts',
  userMappings: 'chapters-user-mappings',
};

// Test data
const BCSF_ORG = {
  orgId: 'bcsf-inc',
  name: 'BCSF, Inc',
  type: 'Cannabis Retail',
  status: 'active' as const,
  location: 'San Francisco, CA',
  monthlyBilling: 0,
};

// Storefronts for BCSF, Inc
const BCSF_STOREFRONTS = [
  {
    storefrontId: 'grass-roots',
    name: 'Grass Roots',
    type: 'Dispensary',
    status: 'active' as const,
    location: 'San Francisco',
    address: '311 Cortland Ave',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94110',
    phone: '(415) 970-9333',
    monthlyBilling: 0,
    dashboardUrl: 'https://alias.chaptersdata.com',
  },
  {
    storefrontId: 'barbary-coast',
    name: 'Barbary Coast',
    type: 'Dispensary',
    status: 'active' as const,
    location: 'San Francisco',
    address: '952 Mission St',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94103',
    phone: '(415) 243-4400',
    monthlyBilling: 0,
    dashboardUrl: 'https://alias.chaptersdata.com',
  },
];

// User mappings - replace USER_IDs with actual Cognito User IDs
const USER_MAPPINGS = [
  {
    // Test client user - only has access to BCSF, Inc
    userId: 'REPLACE_WITH_TESTCLIENT_USER_ID', // Get from Cognito
    email: 'testclient@chaptersdata.com',
    orgId: 'bcsf-inc',
    role: 'member' as const,
  },
];

async function main() {
  console.log('Setting up test users and organizations...\n');

  // Create DynamoDB client
  const client = new DynamoDBClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
  const docClient = DynamoDBDocumentClient.from(client);

  // 1. Create organization
  console.log('Creating organization: BCSF, Inc');
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TABLES.organizations,
    Item: {
      PK: `ORG#${BCSF_ORG.orgId}`,
      orgId: BCSF_ORG.orgId,
      name: BCSF_ORG.name,
      type: BCSF_ORG.type,
      status: BCSF_ORG.status,
      location: BCSF_ORG.location,
      monthlyBilling: BCSF_ORG.monthlyBilling,
      createdAt: now,
      updatedAt: now,
    },
  }));
  console.log('  ✓ Organization created\n');

  // 2. Create storefronts
  console.log('Creating storefronts:');
  for (const storefront of BCSF_STOREFRONTS) {
    await docClient.send(new PutCommand({
      TableName: TABLES.storefronts,
      Item: {
        PK: `ORG#${BCSF_ORG.orgId}`,
        SK: `STOREFRONT#${storefront.storefrontId}`,
        storefrontId: storefront.storefrontId,
        orgId: BCSF_ORG.orgId,
        name: storefront.name,
        type: storefront.type,
        status: storefront.status,
        location: storefront.location,
        address: storefront.address,
        city: storefront.city,
        state: storefront.state,
        zipCode: storefront.zipCode,
        phone: storefront.phone,
        monthlyBilling: storefront.monthlyBilling,
        dashboardUrl: storefront.dashboardUrl,
        createdAt: now,
        updatedAt: now,
      },
    }));
    console.log(`  ✓ ${storefront.name}`);
  }
  console.log();

  // 3. Create user mappings
  console.log('Creating user-organization mappings:');
  console.log('NOTE: Replace USER_IDs with actual Cognito User IDs before running!\n');

  for (const mapping of USER_MAPPINGS) {
    if (mapping.userId.startsWith('REPLACE_')) {
      console.log(`  ⚠ Skipping ${mapping.email} - replace USER_ID first`);
      continue;
    }

    await docClient.send(new PutCommand({
      TableName: TABLES.userMappings,
      Item: {
        PK: `USER#${mapping.userId}`,
        SK: `ORG#${mapping.orgId}`,
        userId: mapping.userId,
        orgId: mapping.orgId,
        role: mapping.role,
        assignedAt: now,
      },
    }));
    console.log(`  ✓ ${mapping.email} -> ${mapping.orgId} (${mapping.role})`);
  }

  console.log('\n✓ Setup complete!');
  console.log('\nNext steps:');
  console.log('1. Create users in Cognito if not already done');
  console.log('2. Add info@chaptersdata.com to the "Admins" group in Cognito');
  console.log('3. Get the Cognito User ID for testclient@chaptersdata.com');
  console.log('4. Update USER_MAPPINGS with the actual User ID and run again');
}

main().catch(console.error);
