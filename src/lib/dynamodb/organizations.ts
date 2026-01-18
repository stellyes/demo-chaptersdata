import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getServerDynamoDBClient, TABLES } from './client';

// DynamoDB types
interface DynamoDBOrganization {
  PK: string;
  orgId: string;
  name: string;
  type: string;
  status: 'active' | 'pending' | 'inactive';
  location: string;
  monthlyBilling: number;
  createdAt: string;
  updatedAt: string;
}

interface DynamoDBStorefront {
  PK: string;
  SK: string;
  storefrontId: string;
  orgId: string;
  name: string;
  type: string;
  status: 'active' | 'pending' | 'inactive';
  location: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  monthlyBilling: number;
  dashboardUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface DynamoDBUserMapping {
  PK: string;
  SK: string;
  userId: string;
  orgId: string;
  role: 'admin' | 'member';
  assignedAt: string;
}

// Application types
export interface Organization {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'pending' | 'inactive';
  location: string;
  monthlyBilling: number;
  storefronts: Storefront[];
}

export interface Storefront {
  id: string;
  orgId: string;
  name: string;
  type: string;
  status: 'active' | 'pending' | 'inactive';
  location: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  monthlyBilling: number;
  dashboardUrl?: string;
}

export interface UserOrganization {
  organization: Organization;
  role: 'admin' | 'member';
}

// Helper to convert DynamoDB organization to app type
function toOrganization(dbOrg: DynamoDBOrganization, storefronts: Storefront[] = []): Organization {
  return {
    id: dbOrg.orgId,
    name: dbOrg.name,
    type: dbOrg.type,
    status: dbOrg.status,
    location: dbOrg.location,
    monthlyBilling: dbOrg.monthlyBilling,
    storefronts,
  };
}

// Helper to convert DynamoDB storefront to app type
function toStorefront(dbStorefront: DynamoDBStorefront): Storefront {
  return {
    id: dbStorefront.storefrontId,
    orgId: dbStorefront.orgId,
    name: dbStorefront.name,
    type: dbStorefront.type,
    status: dbStorefront.status,
    location: dbStorefront.location,
    address: dbStorefront.address,
    city: dbStorefront.city,
    state: dbStorefront.state,
    zipCode: dbStorefront.zipCode,
    phone: dbStorefront.phone,
    monthlyBilling: dbStorefront.monthlyBilling,
    dashboardUrl: dbStorefront.dashboardUrl,
  };
}

// Get all organizations for a user
export async function getUserOrganizations(userId: string): Promise<UserOrganization[]> {
  const client = getServerDynamoDBClient();

  // Get user's organization mappings
  const mappingsResult = await client.send(
    new QueryCommand({
      TableName: TABLES.userMappings,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
      },
    })
  );

  const mappings = (mappingsResult.Items || []) as DynamoDBUserMapping[];

  if (mappings.length === 0) {
    return [];
  }

  // Fetch each organization with its storefronts
  const userOrgs: UserOrganization[] = [];

  for (const mapping of mappings) {
    const org = await getOrganizationById(mapping.orgId);
    if (org) {
      userOrgs.push({
        organization: org,
        role: mapping.role,
      });
    }
  }

  return userOrgs;
}

// Get organization by ID with storefronts
export async function getOrganizationById(orgId: string): Promise<Organization | null> {
  const client = getServerDynamoDBClient();

  // Get organization
  const orgResult = await client.send(
    new GetCommand({
      TableName: TABLES.organizations,
      Key: { PK: `ORG#${orgId}` },
    })
  );

  if (!orgResult.Item) {
    return null;
  }

  const dbOrg = orgResult.Item as DynamoDBOrganization;

  // Get storefronts for this organization
  const storefrontsResult = await client.send(
    new QueryCommand({
      TableName: TABLES.storefronts,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':sk': 'STOREFRONT#',
      },
    })
  );

  const storefronts = ((storefrontsResult.Items || []) as DynamoDBStorefront[]).map(toStorefront);

  return toOrganization(dbOrg, storefronts);
}

// Get all organizations (for admin users)
export async function getAllOrganizations(): Promise<Organization[]> {
  const client = getServerDynamoDBClient();

  // Scan all organizations
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await client.send(
    new ScanCommand({
      TableName: TABLES.organizations,
    })
  );

  const orgs = (result.Items || []) as DynamoDBOrganization[];
  const organizations: Organization[] = [];

  for (const dbOrg of orgs) {
    const org = await getOrganizationById(dbOrg.orgId);
    if (org) {
      organizations.push(org);
    }
  }

  return organizations;
}
