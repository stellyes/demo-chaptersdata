// ============================================
// BILLING & ACTION TRACKING SERVICE
// Tracks billable actions for organizations
// ============================================

import { prisma } from '@/lib/prisma';
import { Decimal } from '@prisma/client/runtime/library';

// Pricing constants
const AWS_MULTIPLIER = 5;
const CLAUDE_MULTIPLIER = 3;
const AWS_MIN_COST = 0.01;
const CLAUDE_MIN_COST = 0.10;

// Claude pricing per 1M tokens (as of 2025)
const CLAUDE_PRICING = {
  'claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  // Fallback for unknown models
  default: { input: 3.0, output: 15.0 },
};

export type EventType = 'aws_action' | 'claude_action';

export type ActionCategory =
  | 'data_import'
  | 'data_load'
  | 'ai_analysis'
  | 'daily_learning'
  | 'monthly_analysis'
  | 'research';

export interface BillingEventInput {
  orgId: string;
  storefrontId?: string;
  userId?: string;
  eventType: EventType;
  actionCategory: ActionCategory;
  actionName: string;
  baseCost: number;
  metadata?: Record<string, unknown>;
}

function getCurrentBillingMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function calculateBilledAmount(
  baseCost: number,
  multiplier: number,
  minCost: number
): number {
  const calculated = baseCost * multiplier;
  return Math.max(calculated, minCost);
}

/**
 * Calculate the actual cost of a Claude API call
 */
export function calculateClaudeCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = CLAUDE_PRICING[model as keyof typeof CLAUDE_PRICING] || CLAUDE_PRICING.default;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Log an AWS action (data import, S3 operations, etc.)
 * Applies 5x multiplier with $0.01 minimum
 */
export async function logAWSAction(
  orgId: string,
  category: ActionCategory,
  name: string,
  estimatedCost: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  const billedAmount = calculateBilledAmount(estimatedCost, AWS_MULTIPLIER, AWS_MIN_COST);

  await prisma.billingEvent.create({
    data: {
      orgId,
      eventType: 'aws_action',
      actionCategory: category,
      actionName: name,
      baseCost: new Decimal(estimatedCost),
      billedAmount: new Decimal(billedAmount),
      multiplier: new Decimal(AWS_MULTIPLIER),
      billingMonth: getCurrentBillingMonth(),
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
    },
  });

  console.log(`[Billing] AWS action logged: ${name} - Base: $${estimatedCost.toFixed(6)}, Billed: $${billedAmount.toFixed(4)}`);
}

/**
 * Log a Claude AI action
 * Applies 3x multiplier with $0.10 minimum
 */
export async function logClaudeAction(
  orgId: string,
  category: ActionCategory,
  name: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const baseCost = calculateClaudeCost(inputTokens, outputTokens, model);
  const billedAmount = calculateBilledAmount(baseCost, CLAUDE_MULTIPLIER, CLAUDE_MIN_COST);

  await prisma.billingEvent.create({
    data: {
      orgId,
      eventType: 'claude_action',
      actionCategory: category,
      actionName: name,
      baseCost: new Decimal(baseCost),
      billedAmount: new Decimal(billedAmount),
      multiplier: new Decimal(CLAUDE_MULTIPLIER),
      billingMonth: getCurrentBillingMonth(),
      metadata: JSON.parse(JSON.stringify({
        inputTokens,
        outputTokens,
        model,
        ...metadata,
      })),
    },
  });

  console.log(`[Billing] Claude action logged: ${name} - Tokens: ${inputTokens}/${outputTokens}, Base: $${baseCost.toFixed(6)}, Billed: $${billedAmount.toFixed(4)}`);
}

/**
 * Get monthly billing summary for an organization
 */
export async function getMonthlyBilling(
  orgId: string,
  month?: string
): Promise<{
  totalBilled: number;
  actionCount: number;
  awsActions: number;
  claudeActions: number;
  breakdown: { category: string; count: number; total: number }[];
}> {
  const billingMonth = month || getCurrentBillingMonth();

  const events = await prisma.billingEvent.findMany({
    where: {
      orgId,
      billingMonth,
    },
  });

  const totalBilled = events.reduce(
    (sum, e) => sum + Number(e.billedAmount),
    0
  );

  const awsActions = events.filter(e => e.eventType === 'aws_action').length;
  const claudeActions = events.filter(e => e.eventType === 'claude_action').length;

  // Group by category
  const categoryMap = new Map<string, { count: number; total: number }>();
  for (const event of events) {
    const existing = categoryMap.get(event.actionCategory) || { count: 0, total: 0 };
    categoryMap.set(event.actionCategory, {
      count: existing.count + 1,
      total: existing.total + Number(event.billedAmount),
    });
  }

  const breakdown = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    count: data.count,
    total: data.total,
  }));

  return {
    totalBilled,
    actionCount: events.length,
    awsActions,
    claudeActions,
    breakdown,
  };
}

/**
 * Get action count for an organization
 */
export async function getActionCount(
  orgId: string,
  month?: string
): Promise<number> {
  const billingMonth = month || getCurrentBillingMonth();

  return prisma.billingEvent.count({
    where: {
      orgId,
      billingMonth,
    },
  });
}

/**
 * Get recent billing events for an organization
 */
export async function getRecentEvents(
  orgId: string,
  limit: number = 10
): Promise<{
  id: string;
  eventType: string;
  actionCategory: string;
  actionName: string;
  billedAmount: number;
  createdAt: Date;
}[]> {
  const events = await prisma.billingEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      eventType: true,
      actionCategory: true,
      actionName: true,
      billedAmount: true,
      createdAt: true,
    },
  });

  return events.map(e => ({
    ...e,
    billedAmount: Number(e.billedAmount),
  }));
}
