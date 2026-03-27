import type { AIRecommendation } from '@/store/app-store';

/**
 * Pre-populated example insight investigations and buyer insights
 * for the Recommendations section demo experience.
 */

// ─── Completed Investigation Reports (show in Past Reports) ──────────────────

export const EXAMPLE_COMPLETED_INVESTIGATIONS: AIRecommendation[] = [
  {
    id: 'demo-inv-001',
    type: 'investigation',
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    summary: 'Flower category margin compression detected across both locations',
    analysis: `# Flower Category Margin Analysis

## Executive Summary
Our investigation reveals a **3.2 percentage point margin decline** in the Flower category over the past 90 days across both Greenleaf Market and Emerald Collective. This is driven primarily by competitive pricing pressure and a shift in customer preference toward premium strains with higher wholesale costs.

## Key Findings

### 1. Margin Trend
- **Current avg margin:** 42.1% (down from 45.3% three months ago)
- **Greenleaf Market:** 41.8% (more affected due to higher competition density)
- **Emerald Collective:** 42.4%

### 2. Root Causes
- **Wholesale cost increases:** Three of our top 5 flower vendors raised prices by 8-12% in the last quarter
- **Competitive pricing:** Two new dispensaries within 2 miles of Greenleaf are running aggressive pricing on flower
- **Product mix shift:** Customers gravitating toward $45-65 eighths (higher cost, similar margin %)

### 3. Top Affected Brands
| Brand | Previous Margin | Current Margin | Change |
|-------|----------------|----------------|--------|
| Pacific Bloom | 48.2% | 43.1% | -5.1% |
| Humboldt Heritage | 46.8% | 42.7% | -4.1% |
| Fog City Flower | 44.5% | 41.2% | -3.3% |

## Recommended Actions

1. **Renegotiate with Pacific Coast Distribution** — They supply 40% of our flower. A volume commitment could recover 2-3 margin points.
2. **Introduce house brand flower** — Source directly from Emerald Triangle growers at 15-20% below distributor pricing.
3. **Bundle strategy** — Pair flower with high-margin accessories (grinders, papers) for a perceived value deal that protects overall basket margin.
4. **Review pricing tiers** — The $35-45 range is most competitive. Consider selective price increases on unique strains with no local comparables.

## Impact Estimate
Implementing recommendations 1 and 3 alone could recover approximately **$4,200/month** in margin across both locations.`,
  },
  {
    id: 'demo-inv-002',
    type: 'investigation',
    date: new Date(Date.now() - 7 * 86400000).toISOString(),
    summary: 'Weekend vs weekday performance gap widening at Greenleaf Market',
    analysis: `# Weekend vs Weekday Performance Gap — Greenleaf Market

## Executive Summary
Greenleaf Market shows a **growing disparity** between weekend and weekday performance. Weekend revenue per day is now 2.4x weekday revenue, up from 1.8x six months ago. Weekday foot traffic has declined 15% while weekend traffic grew 8%.

## Key Findings

### Revenue Distribution
- **Weekend (Fri-Sun):** Average $8,420/day — 62% of weekly revenue
- **Weekday (Mon-Thu):** Average $3,510/day — 38% of weekly revenue
- **Gap trend:** Widening by ~0.1x per month

### Staffing Efficiency
- Weekday staffing costs represent 48% of labor budget but only serve 38% of revenue
- Weekend shifts are understaffed — average wait time is 12 minutes vs 3 minutes on weekdays

### Customer Segments
- VIP and Whale customers shop 70% on weekdays (they prefer less crowded times)
- New/Low customers are 80% weekend shoppers

## Recommended Actions

1. **Weekday promotions** — "Midweek Deal" on Tuesdays/Wednesdays targeting the $30-50 basket range
2. **Shift labor allocation** — Move 1 budtender from Mon/Tue to Fri/Sat peak hours
3. **VIP weekday perks** — Early access to new drops on Wednesday to maintain high-value weekday traffic
4. **Evening hours** — Consider extending Thursday hours to 10pm to capture after-work crowd

## Expected Impact
A 20% increase in weekday traffic would add approximately **$2,800/week** in revenue with minimal additional labor cost.`,
  },
  {
    id: 'demo-inv-003',
    type: 'buyer-investigation',
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    summary: 'Vendor consolidation opportunity identified — top 3 vendors cover 68% of spend',
    analysis: `# Vendor Consolidation Analysis

## Executive Summary
Analysis of purchasing data reveals an opportunity to consolidate vendor relationships for better pricing leverage. Our top 3 vendors account for 68% of total purchasing spend, but we're spreading the remaining 32% across 7+ smaller vendors with no volume leverage.

## Current Vendor Distribution

| Vendor | % of Spend | Avg Unit Cost | Reliability |
|--------|-----------|---------------|-------------|
| Pacific Coast Distribution | 31% | $14.20 | 95% on-time |
| Golden Gate Supply Co | 22% | $16.80 | 88% on-time |
| NorCal Cannabis Wholesale | 15% | $12.50 | 92% on-time |
| Bay Bridge Distribution | 8% | $18.40 | 85% on-time |
| Others (6 vendors) | 24% | $17.60 avg | 78% avg |

## Key Findings

1. **Price disparity:** Smaller vendors charge 12-24% more per unit on comparable products
2. **Reliability gap:** The long-tail vendors have 17% lower on-time delivery rates
3. **Administrative overhead:** Each vendor relationship costs ~4 hours/month in ordering, receiving, and reconciliation

## Consolidation Recommendation

### Phase 1: Immediate (Next 30 days)
- Shift Bay Bridge Distribution volume to NorCal Cannabis Wholesale — similar product lines, better pricing
- Expected savings: **$1,200/month**

### Phase 2: Negotiation (60 days)
- Approach Pacific Coast with a 40% volume commitment for 5% price reduction
- Expected savings: **$2,100/month**

### Phase 3: Long-tail reduction (90 days)
- Reduce from 10 vendors to 5 core partners
- Expected savings: **$800/month** in admin costs alone

## Total Annual Impact
Estimated **$49,200/year** in combined procurement savings and reduced overhead.`,
  },
];

// ─── Available Insights (for investigation with simulated responses) ──────────

export interface DemoInsight {
  id: string;
  category: string;
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  prewrittenResponse: string;
}

export const EXAMPLE_AVAILABLE_INSIGHTS: DemoInsight[] = [
  {
    id: 'demo-avail-001',
    category: 'brands',
    insight: 'Three vape brands showing consistent margin improvement over 60 days while flower margins decline — potential category rebalancing opportunity',
    confidence: 'high',
    source: 'Brand Performance Analysis',
    prewrittenResponse: `# Vape Category Margin Opportunity Analysis

## Finding
Three vape brands — **Sunset Valley Farms**, **Sierra Gold**, and **Presidio Premium** — have shown margin improvements of 2.8%, 3.1%, and 1.9% respectively over the past 60 days. Meanwhile, flower category margins have compressed by 3.2% in the same period.

## Data Points
- Vape category now at **54.2% avg margin** (up from 51.8%)
- Flower category at **42.1% avg margin** (down from 45.3%)
- Vape share of total revenue: 18.4% (up from 16.2%)

## Strategic Implications

### Short-term (Next 30 days)
- Increase shelf prominence for the three high-performing vape brands
- Train budtenders to recommend vape alternatives when customers are price-sensitive on flower
- Consider a "Vape Week" promotion to accelerate category growth

### Medium-term (60-90 days)
- Negotiate better wholesale terms with Sunset Valley Farms based on volume growth
- Evaluate adding 2-3 new vape SKUs to capture the growing demand
- Monitor whether the flower margin decline stabilizes or requires vendor renegotiation

## Risk Assessment
- **Low risk:** Vape category growth is a national trend (up 22% YoY per BDSA)
- **Medium risk:** Over-indexing on vape could alienate flower-loyal customers
- **Recommendation:** Target a 22% vape revenue share (from current 18.4%) while maintaining flower selection depth`,
  },
  {
    id: 'demo-avail-002',
    category: 'customers',
    insight: 'Customer visit frequency dropped 18% for the "Regular" segment last month — retention risk for mid-tier customers',
    confidence: 'high',
    source: 'Customer Behavior Analysis',
    prewrittenResponse: `# Regular Segment Retention Risk Analysis

## Finding
The "Regular" customer segment (lifetime spend $500-$2,000) has seen an **18% decline in visit frequency** over the past 30 days. This segment represents 34% of our customer base and 28% of monthly revenue.

## Affected Population
- **Total Regular customers:** 2,847
- **Showing decreased frequency:** ~512 customers
- **Average basket size (declining group):** $42.80 (vs $48.20 for stable Regulars)

## Root Cause Analysis
1. **Price sensitivity:** This segment is most responsive to competitive pricing. Two new competitors are offering first-time discounts
2. **Product availability:** 3 popular mid-price flower strains were out of stock for 8+ days last month
3. **Seasonal pattern:** Partial — but the decline exceeds normal seasonal variation by 11%

## Recommended Actions

### Immediate
- Launch a "Welcome Back" campaign targeting Regulars who haven't visited in 14+ days — offer $5 off next purchase
- Ensure top-20 mid-price SKUs maintain consistent stock levels

### This Month
- Implement a simple punch-card loyalty program (buy 5, get 10% off the 6th)
- Add text/email alerts for new product drops in their preferred categories

## Revenue at Risk
If the declining cohort fully churns, the monthly revenue impact is approximately **$21,900**. A 50% recovery rate through re-engagement would preserve ~$11,000/month.`,
  },
  {
    id: 'demo-avail-003',
    category: 'sales',
    insight: 'Average order value trending upward but transaction count declining — fewer customers spending more per visit',
    confidence: 'medium',
    source: 'Sales Trend Analysis',
    prewrittenResponse: `# AOV vs Transaction Count Divergence

## Finding
Over the past 45 days, **average order value increased 8.4%** (from $52.10 to $56.48) while **daily transaction count decreased 11.2%** (from 142 to 126 average daily transactions).

## Net Impact
- Revenue is roughly flat (-3.7%) despite the transaction decline
- The higher AOV is masking a foot traffic problem

## Contributing Factors
1. **Basket upselling working:** Budtender training on add-on suggestions is driving larger baskets
2. **Loss of casual shoppers:** The low-AOV segment ($15-30 baskets) has declined 22%
3. **Premium mix shift:** Customers who remain are buying higher-priced products

## Concern Level: Medium-High
While revenue is stable now, losing foot traffic is a leading indicator. Today's casual shoppers become tomorrow's regulars.

## Recommended Actions

1. **Entry-level pricing:** Introduce a "$25 and under" featured shelf to attract casual shoppers
2. **Foot traffic drivers:** Partner with neighboring businesses for cross-promotions
3. **Track the metric:** Add daily transaction count to the dashboard KPI alerts
4. **Budtender goal:** Add a secondary KPI for transaction count alongside revenue targets

## Projection
Without intervention, transaction count could decline another 8-10% over the next 60 days, putting monthly revenue at risk of a $12,000-15,000 decline.`,
  },
];

// ─── Available Buyer Insights (for investigation with simulated responses) ────

export const EXAMPLE_AVAILABLE_BUYER_INSIGHTS: DemoInsight[] = [
  {
    id: 'demo-buyer-avail-001',
    category: 'purchasing',
    insight: 'Edible category wholesale costs increased 14% this quarter while retail pricing remained flat — margin squeeze developing',
    confidence: 'high',
    source: 'Invoice Trend Analysis',
    prewrittenResponse: `# Edible Category Margin Squeeze Analysis

## Finding
Wholesale costs for the Edible category have increased **14% quarter-over-quarter** across our primary vendors, while our retail pricing has remained essentially flat (up only 1.2%).

## Cost Breakdown

| Vendor | Q3 Avg Cost | Q4 Avg Cost | Change |
|--------|------------|------------|--------|
| Marina Mints | $6.80 | $7.90 | +16.2% |
| Ocean Beach Organics | $8.20 | $9.10 | +11.0% |
| Parkside Provisions | $7.50 | $8.70 | +16.0% |

## Impact on Margins
- **Previous edible margin:** 58.2%
- **Current edible margin:** 51.4%
- **Revenue impact:** ~$2,100/month in lost margin

## Root Causes
1. Cannabis ingredient costs rose due to cultivation energy cost increases
2. Packaging compliance changes added $0.40-0.80 per unit
3. One vendor (Marina Mints) lost their primary supplier and is sourcing at higher cost

## Recommendations
1. **Price adjustment:** Raise retail on edibles by 5-8% — customers in this category are less price-sensitive
2. **Alternative sourcing:** Test 2 new edible vendors for competitive quotes
3. **Private label opportunity:** The edible category has the highest private-label potential — explore co-manufacturing

## Timeline
Implement pricing changes within 2 weeks. Begin vendor outreach immediately. Private label evaluation is a 90-day project.`,
  },
  {
    id: 'demo-buyer-avail-002',
    category: 'vendors',
    insight: 'Pacific Coast Distribution delivery reliability declined from 95% to 82% over 60 days — supply chain risk for our largest vendor',
    confidence: 'high',
    source: 'Vendor Performance Tracking',
    prewrittenResponse: `# Pacific Coast Distribution Reliability Assessment

## Finding
Our largest vendor by spend (31% of total purchasing) has seen delivery reliability drop from **95% on-time to 82%** over the past 60 days. This is causing stockout events and lost sales.

## Impact Assessment
- **Stockout incidents linked to late deliveries:** 7 in past 30 days
- **Estimated lost sales from stockouts:** $4,800
- **Affected product categories:** Flower (primary), Vape (secondary)

## Investigation Findings
1. Pacific Coast recently changed their distribution warehouse location
2. They onboarded 12 new retail clients in our region, stretching capacity
3. Two delivery drivers left the company in the past month

## Risk Level: High
As our single largest vendor, sustained reliability issues create significant business risk.

## Action Plan

### Immediate (This week)
- Contact Pacific Coast account rep — request a dedicated delivery window for our stores
- Increase safety stock by 20% on Pacific Coast SKUs to buffer late deliveries

### Short-term (30 days)
- Identify 3-5 key SKUs that could be dual-sourced from Golden Gate Supply Co
- Request a service level agreement (SLA) with financial penalties for late deliveries

### Contingency
- If reliability doesn't improve to 90%+ within 45 days, begin shifting 15% of spend to NorCal Cannabis Wholesale as a backup

## Financial Protection
Dual-sourcing and safety stock increases will cost approximately $1,200/month but protect against the $4,800+/month stockout risk.`,
  },
];

// ─── Completed Learning Model Report ──────────────────────────────────────────

export const EXAMPLE_LEARNING_REPORT: AIRecommendation = {
  id: 'demo-learning-001',
  type: 'insights',
  date: new Date(Date.now() - 1 * 86400000).toISOString(),
  summary: 'Daily Learning Digest — Market Intelligence Update',
  analysis: `# Daily Business Intelligence Digest

## Executive Summary
Today's analysis identified 3 priority actions and 2 market trends relevant to your operations. Overall data health score is 84/100 with a confidence score of 0.87.

## Priority Actions

### 1. Restock Pacific Bloom Flower (Urgent)
Pacific Bloom inventory at Greenleaf Market is projected to stock out within 3 days based on current sell-through rate. This is your #2 revenue brand at this location.
- **Timeframe:** Order today
- **Impact:** High — $1,800/week revenue at risk

### 2. Review Emerald Collective Wednesday Staffing
Wednesday traffic at Emerald Collective increased 22% over the past 3 weeks but staffing hasn't adjusted. Current staffing creates 15-minute average wait times.
- **Timeframe:** This week
- **Impact:** Medium — customer satisfaction and potential lost sales

### 3. Price Review on Concentrate Category
Your concentrate pricing is 8% above the local market average based on recent competitive data. Consider selective adjustments on the top 5 SKUs.
- **Timeframe:** Next 2 weeks
- **Impact:** Medium — may be contributing to the transaction count decline

## Market Intelligence

### Cannabis Beverage Growth Continues
National cannabis beverage sales grew 45% YoY according to BDSA Q4 data. This category currently represents only 2% of your sales mix — potential whitespace opportunity.

### California Regulatory Update
New packaging requirements take effect April 1st. Vendors should be shipping compliant packaging now — verify with your top 5 vendors that they're prepared.

## Quick Wins
- Move slow-moving topicals to the clearance shelf — 8 SKUs haven't sold in 30+ days
- Cross-promote edibles with beverages at the register for impulse purchases`,
};
