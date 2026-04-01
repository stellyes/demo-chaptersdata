// ============================================
// COMPLIANCE RULES SERVICE
// Shared logic for loading, matching, and applying
// compliance rules against sales data.
// Used by both Lambda functions and the app.
// ============================================

import { PrismaClient } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuleCondition {
  field: string;          // SalesLineItem field to check
  operator: 'lte' | 'gte' | 'lt' | 'gt' | 'eq' | 'neq' | 'in' | 'not_in' | 'is_null' | 'not_null' | 'contains' | 'between';
  value?: number | string | string[] | number[];
  upperValue?: number;    // for 'between' operator
  unit?: string;          // mg, g, oz, etc.
  per?: string;           // package, serving, transaction, day
}

export interface CompiledRule {
  ruleId: string;
  jurisdiction: string;
  complianceArea: string;
  productTypes: string[];
  ruleType: string;       // threshold | restriction | requirement | prohibition
  condition: RuleCondition;
  enforcedBy: string | null;
  penalty: string | null;
  citations: string[];
  sourceDocumentIds: number[];
  effectiveDate: string | null;
  severity: string;       // critical | high | medium | low
}

export interface SalesLineItemForScan {
  id: string;
  storefrontId: string | null;
  storeName: string;
  ticketId: string;
  ticketLineId: string | null;
  dateOpen: Date;
  dateClose: Date | null;
  productName: string | null;
  productType: string | null;
  productSubtype: string | null;
  classification: string | null;
  stateTrackingId: string | null;
  batch: string | null;
  distributor: string | null;
  quantity: number;
  pricePerUnit: number | null;
  grossSales: number | null;
  discounts: number | null;
  netSales: number | null;
  taxes: number | null;
  costWithoutExcise: number | null;
  costWithExcise: number | null;
  customerAge: number | null;
  customerDob: Date | null;
  customerCity: string | null;
  customerState: string | null;
  totalMgThc: number | null;
  totalMgCbd: number | null;
  size: string | null;
}

export interface RuleViolation {
  ruleId: string;
  riskLevel: string;
  riskScore: number;
  detectionMethod: 'rules_engine';
  violation: string;
  salesLineItemId: string;
  productName: string | null;
  productType: string | null;
  field: string;
  actualValue: string;
  limitValue: string;
  recommendation: string;
}

// ─── Rule Matching ──────────────────────────────────────────────────────────

/**
 * Filter rules applicable to a given sales line item based on jurisdiction and product type.
 */
export function getApplicableRules(
  rules: CompiledRule[],
  item: SalesLineItemForScan,
  jurisdiction: string,
): CompiledRule[] {
  return rules.filter(rule => {
    // Match jurisdiction (or federal rules apply everywhere)
    if (rule.jurisdiction !== jurisdiction && rule.jurisdiction !== 'federal') {
      return false;
    }
    // Match product type (empty productTypes means applies to all)
    if (rule.productTypes.length > 0 && item.productType) {
      const itemType = item.productType.toLowerCase();
      const itemSubtype = item.productSubtype?.toLowerCase() || '';
      const matches = rule.productTypes.some(pt => {
        const rpt = pt.toLowerCase();
        return itemType === rpt || itemType.includes(rpt) || itemSubtype === rpt || itemSubtype.includes(rpt);
      });
      if (!matches) return false;
    }
    // Check rule is still effective
    if (rule.effectiveDate) {
      const effective = new Date(rule.effectiveDate);
      if (item.dateOpen < effective) return false;
    }
    return true;
  });
}

/**
 * Apply a single rule condition against a sales line item field value.
 * Returns null if compliant, or a violation description if not.
 */
export function evaluateCondition(
  condition: RuleCondition,
  item: SalesLineItemForScan,
): { violated: boolean; actualValue: string; limitValue: string } {
  const fieldValue = getFieldValue(item, condition.field);

  switch (condition.operator) {
    case 'lte': {
      const numVal = toNumber(fieldValue);
      const limit = toNumber(condition.value);
      if (numVal === null || limit === null) return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: String(condition.value) };
      return { violated: numVal > limit, actualValue: String(numVal), limitValue: `<= ${limit}` };
    }
    case 'gte': {
      const numVal = toNumber(fieldValue);
      const limit = toNumber(condition.value);
      if (numVal === null || limit === null) return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: String(condition.value) };
      return { violated: numVal < limit, actualValue: String(numVal), limitValue: `>= ${limit}` };
    }
    case 'lt': {
      const numVal = toNumber(fieldValue);
      const limit = toNumber(condition.value);
      if (numVal === null || limit === null) return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: String(condition.value) };
      return { violated: numVal >= limit, actualValue: String(numVal), limitValue: `< ${limit}` };
    }
    case 'gt': {
      const numVal = toNumber(fieldValue);
      const limit = toNumber(condition.value);
      if (numVal === null || limit === null) return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: String(condition.value) };
      return { violated: numVal <= limit, actualValue: String(numVal), limitValue: `> ${limit}` };
    }
    case 'eq': {
      return { violated: String(fieldValue) !== String(condition.value), actualValue: String(fieldValue ?? 'null'), limitValue: `== ${condition.value}` };
    }
    case 'neq': {
      return { violated: String(fieldValue) === String(condition.value), actualValue: String(fieldValue ?? 'null'), limitValue: `!= ${condition.value}` };
    }
    case 'is_null': {
      return { violated: fieldValue == null || fieldValue === '', actualValue: String(fieldValue ?? 'null'), limitValue: 'must not be empty' };
    }
    case 'not_null': {
      return { violated: fieldValue != null && fieldValue !== '', actualValue: String(fieldValue ?? 'null'), limitValue: 'must be empty' };
    }
    case 'in': {
      const allowed = Array.isArray(condition.value) ? condition.value.map(String) : [];
      return { violated: !allowed.includes(String(fieldValue)), actualValue: String(fieldValue ?? 'null'), limitValue: `in [${allowed.join(', ')}]` };
    }
    case 'not_in': {
      const banned = Array.isArray(condition.value) ? condition.value.map(String) : [];
      return { violated: banned.includes(String(fieldValue)), actualValue: String(fieldValue ?? 'null'), limitValue: `not in [${banned.join(', ')}]` };
    }
    case 'contains': {
      const strVal = String(fieldValue ?? '').toLowerCase();
      const search = String(condition.value ?? '').toLowerCase();
      return { violated: strVal.includes(search), actualValue: String(fieldValue ?? 'null'), limitValue: `must not contain "${condition.value}"` };
    }
    case 'between': {
      const numVal = toNumber(fieldValue);
      const lower = toNumber(condition.value);
      const upper = toNumber(condition.upperValue);
      if (numVal === null || lower === null || upper === null) return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: `${condition.value}-${condition.upperValue}` };
      return { violated: numVal < lower || numVal > upper, actualValue: String(numVal), limitValue: `${lower}-${upper}` };
    }
    default:
      return { violated: false, actualValue: String(fieldValue ?? 'null'), limitValue: 'unknown operator' };
  }
}

/**
 * Run the full rules engine against a batch of sales line items.
 */
export function scanBatch(
  rules: CompiledRule[],
  items: SalesLineItemForScan[],
  jurisdiction: string,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const item of items) {
    const applicable = getApplicableRules(rules, item, jurisdiction);

    for (const rule of applicable) {
      const result = evaluateCondition(rule.condition, item);
      if (result.violated) {
        violations.push({
          ruleId: rule.ruleId,
          riskLevel: rule.severity,
          riskScore: severityToScore(rule.severity),
          detectionMethod: 'rules_engine',
          violation: buildViolationMessage(rule, item, result),
          salesLineItemId: item.id,
          productName: item.productName,
          productType: item.productType,
          field: rule.condition.field,
          actualValue: result.actualValue,
          limitValue: result.limitValue,
          recommendation: buildRecommendation(rule),
        });
      }
    }
  }

  return violations;
}

// ─── Database Operations ────────────────────────────────────────────────────

/**
 * Load active compliance rules from Aurora.
 */
export async function loadRulesFromDb(prisma: PrismaClient, jurisdiction?: string): Promise<CompiledRule[]> {
  const where: Record<string, unknown> = { isActive: true };
  if (jurisdiction) {
    where.jurisdiction = { in: [jurisdiction, 'federal'] };
  }

  const dbRules = await prisma.complianceRule.findMany({ where });

  return dbRules.map(r => ({
    ruleId: r.ruleId,
    jurisdiction: r.jurisdiction,
    complianceArea: r.complianceArea,
    productTypes: r.productTypes,
    ruleType: r.ruleType,
    condition: r.condition as unknown as RuleCondition,
    enforcedBy: r.enforcedBy,
    penalty: r.penalty,
    citations: r.citations,
    sourceDocumentIds: r.sourceDocumentIds,
    effectiveDate: r.effectiveDate?.toISOString() ?? null,
    severity: r.severity,
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFieldValue(item: SalesLineItemForScan, field: string): unknown {
  const fieldMap: Record<string, unknown> = {
    totalMgThc: item.totalMgThc,
    totalMgCbd: item.totalMgCbd,
    quantity: item.quantity,
    pricePerUnit: item.pricePerUnit,
    grossSales: item.grossSales,
    discounts: item.discounts,
    netSales: item.netSales,
    taxes: item.taxes,
    customerAge: item.customerAge,
    stateTrackingId: item.stateTrackingId,
    productType: item.productType,
    productSubtype: item.productSubtype,
    classification: item.classification,
    distributor: item.distributor,
    size: item.size,
    batch: item.batch,
    costWithoutExcise: item.costWithoutExcise,
    costWithExcise: item.costWithExcise,
  };
  return fieldMap[field] ?? null;
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function severityToScore(severity: string): number {
  switch (severity) {
    case 'critical': return 0.95;
    case 'high': return 0.80;
    case 'medium': return 0.55;
    case 'low': return 0.30;
    default: return 0.50;
  }
}

function buildViolationMessage(rule: CompiledRule, item: SalesLineItemForScan, result: { actualValue: string; limitValue: string }): string {
  const product = item.productName || item.productType || 'Unknown product';
  const area = rule.complianceArea.replace(/_/g, ' ');
  return `${area} violation for "${product}": ${rule.condition.field} is ${result.actualValue} (limit: ${result.limitValue}). Rule: ${rule.ruleId}${rule.citations.length > 0 ? ` [${rule.citations[0]}]` : ''}`;
}

function buildRecommendation(rule: CompiledRule): string {
  switch (rule.ruleType) {
    case 'threshold':
      return `Review product ${rule.condition.field} values. Verify with distributor and update if incorrect.`;
    case 'restriction':
      return `This product type may be restricted in ${rule.jurisdiction}. Verify license permits this category.`;
    case 'requirement':
      return `Required compliance data is missing. Update records to include ${rule.condition.field}.`;
    case 'prohibition':
      return `This item may violate a prohibition in ${rule.jurisdiction}. Remove from inventory pending review.`;
    default:
      return `Review this item for compliance with ${rule.ruleId}.`;
  }
}
