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

export interface LearnedBuyerInsight extends DemoInsight {
  breadcrumbs: {
    dataSource: string;
    leadingIndicator: string;
    suggestedNext: string;
  };
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

// ─── Learned Buyer Insights (Progressive Learning breadcrumbs) ────────────────

export const EXAMPLE_LEARNED_BUYER_INSIGHTS: LearnedBuyerInsight[] = [
  {
    id: 'demo-learned-buyer-001',
    category: 'vendors',
    insight: 'Vendor delivery reliability declining — Pacific Coast Distribution late delivery rate increasing over past 60 days, creating stockout risk for our largest supplier',
    confidence: 'high',
    source: 'Progressive Learning - Phase 4',
    breadcrumbs: {
      dataSource: 'Invoice date analysis - Last 60 days',
      leadingIndicator: 'On-time rate dropped from 95% to 82%',
      suggestedNext: 'Review delivery windows and consider backup vendor',
    },
    prewrittenResponse: `# Vendor Delivery Reliability Decline — Pacific Coast Distribution

## Executive Summary
Progressive Learning analysis of invoice receipt dates over the past 60 days reveals a **significant deterioration in Pacific Coast Distribution's delivery reliability**. Their on-time delivery rate has dropped from 95% to 82%, representing a 13-percentage-point decline that is now impacting inventory availability across both locations.

## How This Was Discovered
The system cross-referenced expected delivery dates (based on PO submission and historical lead times) against actual invoice receipt dates for all vendors over the trailing 60-day window. Pacific Coast Distribution stood out as the only top-5 vendor with a statistically significant negative trend.

## Detailed Findings

### Delivery Performance Trend
| Period | On-Time Rate | Late Deliveries | Avg Days Late |
|--------|-------------|-----------------|---------------|
| 60-90 days ago | 95.2% | 2 of 42 | 1.2 days |
| 30-60 days ago | 89.1% | 5 of 46 | 1.8 days |
| Last 30 days | 82.0% | 9 of 50 | 2.4 days |

### Impact on Operations
- **Stockout events:** 7 incidents in the past 30 days directly linked to late Pacific Coast deliveries
- **Lost revenue estimate:** $4,800 from out-of-stock flower and vape products
- **Emergency orders placed:** 3 rush orders to backup vendors at premium pricing ($680 additional cost)
- **Staff time:** Approximately 6 hours spent managing delivery exceptions and customer communication

### Root Cause Indicators
Based on pattern analysis, the system identified several contributing factors:
1. **Warehouse relocation:** Pacific Coast moved their distribution center in early Q4, likely causing logistical disruption
2. **Capacity strain:** Order volumes from Pacific Coast have increased 18% (they appear to be onboarding new clients)
3. **Route changes:** Delivery windows shifted from morning (before store open) to mid-afternoon, creating receiving conflicts

### Affected Product Categories
| Category | % of Pacific Coast Orders | Stockout Risk |
|----------|--------------------------|---------------|
| Flower | 62% | High — 3 stockouts last month |
| Vape | 24% | Medium — 2 stockouts last month |
| Concentrates | 14% | Low — adequate safety stock |

## Recommended Actions

### Immediate (This Week)
1. **Contact Pacific Coast account rep** — Request a formal meeting to discuss service level expectations and their operational changes
2. **Increase safety stock** — Add 20% buffer inventory on top-selling Pacific Coast SKUs (estimated cost: $2,400 one-time)
3. **Set up delivery alerts** — Flag any Pacific Coast PO not confirmed for delivery within 48 hours of expected date

### Short-Term (Next 30 Days)
1. **Dual-source critical SKUs** — Identify the top 5 flower SKUs from Pacific Coast and establish backup supply through Golden Gate Supply Co or NorCal Cannabis Wholesale
2. **Negotiate SLA** — Propose a formal service level agreement with Pacific Coast that includes delivery windows and financial penalties for consistent late performance
3. **Track weekly** — Add Pacific Coast delivery metrics to the weekly operations review

### Contingency Plan
If reliability does not improve to 90%+ within 45 days:
- Begin shifting 15-20% of Pacific Coast spend to NorCal Cannabis Wholesale
- Focus the shift on flower products where stockout impact is highest
- Maintain Pacific Coast for concentrates where their pricing advantage is strongest

## Financial Analysis
| Scenario | Monthly Cost Impact |
|----------|-------------------|
| Status quo (do nothing) | -$5,480 (stockouts + rush orders) |
| Safety stock increase | -$800 (carrying cost) but prevents most stockouts |
| Dual sourcing (15% shift) | -$400 (slightly higher unit costs) but eliminates single-vendor risk |
| Full vendor negotiation | Potential $1,200/month savings if SLA pricing is secured |

## System Confidence
This insight carries **high confidence** based on 138 invoice records analyzed with clear statistical trend. The on-time rate decline passes a 95% confidence interval test, ruling out normal delivery variance.`,
  },
  {
    id: 'demo-learned-buyer-002',
    category: 'pricing',
    insight: 'Bulk ordering margin opportunity — Marina Mints edibles show 15% better margins on quarterly bulk orders vs monthly purchasing',
    confidence: 'high',
    source: 'Progressive Learning - Phase 4',
    breadcrumbs: {
      dataSource: 'Invoice cost trending - 12 months',
      leadingIndicator: 'Unit cost drops $1.20 on orders >500 units',
      suggestedNext: 'Model quarterly vs monthly ordering for top 10 edible SKUs',
    },
    prewrittenResponse: `# Bulk Ordering Margin Opportunity — Marina Mints Edibles

## Executive Summary
A 12-month analysis of Marina Mints invoice data reveals a **consistent volume discount pattern**: orders exceeding 500 units receive an average **$1.20 per unit reduction**, translating to approximately 15% better margins when purchasing quarterly in bulk versus monthly in smaller quantities.

## How This Was Discovered
The Progressive Learning system analyzed unit cost variations across all Marina Mints invoices over the trailing 12 months, segmented by order size. A clear price-break threshold emerged at 500 units, with the discount appearing consistently across all edible SKUs from this vendor.

## Detailed Analysis

### Unit Cost by Order Volume
| Order Size | Avg Unit Cost | Margin at Retail $14.99 | Orders Analyzed |
|-----------|--------------|------------------------|-----------------|
| < 200 units | $8.40 | 44.0% | 18 |
| 200-499 units | $7.80 | 48.0% | 14 |
| 500+ units | $7.20 | 52.0% | 6 |

### Current Ordering Pattern
Both Greenleaf Market and Emerald Collective currently order Marina Mints edibles on a **monthly cadence**, typically in quantities of 150-300 units per location. This places orders firmly in the mid-tier pricing bracket.

### Proposed Quarterly Bulk Model
By consolidating 3 months of projected demand into a single quarterly order for both stores:
- **Combined quarterly volume:** ~1,400 units (well above the 500-unit threshold)
- **Unit cost savings:** $1.20 per unit
- **Quarterly savings:** $1,680
- **Annual savings:** $6,720

### Top 10 Edible SKUs for Bulk Ordering
| SKU | Monthly Volume (Both Stores) | Quarterly Projection | Current Cost | Bulk Cost |
|-----|------------------------------|---------------------|--------------|-----------|
| Marina Mints 10mg Variety Pack | 120 | 360 | $8.40 | $7.20 |
| Marina Mints 25mg Indica Gummies | 95 | 285 | $8.20 | $7.00 |
| Marina Mints Micro-Dose 2.5mg | 88 | 264 | $7.80 | $6.60 |
| Marina Mints CBD:THC 1:1 | 72 | 216 | $9.10 | $7.90 |
| Marina Mints Sativa Chews | 65 | 195 | $8.00 | $6.80 |
| Marina Mints Sleep Formula | 58 | 174 | $9.40 | $8.20 |
| Marina Mints Sour Strips | 52 | 156 | $7.60 | $6.40 |
| Marina Mints Dark Chocolate Bar | 48 | 144 | $10.20 | $9.00 |
| Marina Mints Honey Drops | 42 | 126 | $8.80 | $7.60 |
| Marina Mints Energy Chews | 38 | 114 | $8.60 | $7.40 |

### Risk Considerations

**Inventory Carrying Cost:**
- Quarterly ordering means holding ~2 months of additional inventory
- Estimated carrying cost: $340/quarter (storage, insurance, capital)
- Net benefit after carrying cost: $1,340/quarter ($5,360/year)

**Shelf Life:**
- Marina Mints products have 12-month shelf life
- Quarterly ordering creates a maximum 3-month holding period — well within safety margins

**Demand Variability:**
- Edible demand is relatively stable (coefficient of variation: 0.12)
- Low risk of overstock compared to categories like flower

## Implementation Plan

### Phase 1: Pilot (Next Quarter)
- Place a single bulk order for the top 5 Marina Mints SKUs
- Warehouse the combined order and distribute between stores as needed
- Track actual sell-through vs projections

### Phase 2: Expand (Following Quarter)
- If pilot validates savings, expand to all 10 SKUs
- Negotiate a formal quarterly pricing agreement with Marina Mints
- Explore whether similar volume discounts exist with other edible vendors

### Phase 3: Cross-Vendor (6 Months)
- Apply the same analysis to Ocean Beach Organics and Parkside Provisions
- Estimated additional savings opportunity: $3,000-5,000/year

## System Confidence
This insight carries **high confidence** based on 38 invoices spanning 12 months with consistent pricing patterns. The volume discount is not advertised by the vendor but is applied automatically at the 500-unit threshold.`,
  },
  {
    id: 'demo-learned-buyer-003',
    category: 'pricing',
    insight: 'Cross-store pricing variance — Same products from same vendor cost 8% more at Greenleaf Market vs Emerald Collective on 14 shared SKUs',
    confidence: 'medium',
    source: 'Progressive Learning - Phase 4',
    breadcrumbs: {
      dataSource: 'Cross-store invoice comparison',
      leadingIndicator: '8.2% average unit cost difference on 14 shared SKUs',
      suggestedNext: 'Consolidate purchasing under single store account for volume discount',
    },
    prewrittenResponse: `# Cross-Store Pricing Variance Analysis

## Executive Summary
A comparison of invoices across both storefronts reveals that **Greenleaf Market pays an average of 8.2% more** than Emerald Collective for the same products from the same vendors across 14 shared SKUs. This pricing disparity appears to stem from separate vendor accounts and differing order volumes.

## How This Was Discovered
The Progressive Learning system matched invoice line items across stores by vendor name and product SKU, then compared unit costs for identical products purchased within the same 30-day windows. The 8.2% average difference exceeds normal pricing variance and indicates a systematic rather than random difference.

## Detailed Findings

### Price Comparison: Shared SKUs
| Product | Vendor | Greenleaf Cost | Emerald Cost | Difference |
|---------|--------|---------------|--------------|------------|
| OG Kush 3.5g | Pacific Coast | $15.80 | $14.40 | +9.7% |
| Blue Dream 3.5g | Pacific Coast | $14.20 | $13.10 | +8.4% |
| Gelato Vape 1g | Golden Gate | $18.90 | $17.60 | +7.4% |
| Sour Diesel 3.5g | Pacific Coast | $16.40 | $15.00 | +9.3% |
| Indica Gummies 10pk | Marina Mints | $8.40 | $7.80 | +7.7% |
| GSC Concentrate 1g | NorCal | $22.10 | $20.80 | +6.3% |
| Hybrid Preroll 5pk | Pacific Coast | $11.20 | $10.20 | +9.8% |
| CBD Tincture 30ml | Ocean Beach | $14.60 | $13.40 | +9.0% |
| Sativa Chews 20pk | Marina Mints | $9.80 | $9.10 | +7.7% |
| Purple Punch 7g | Pacific Coast | $28.40 | $26.20 | +8.4% |
| Wedding Cake 3.5g | Golden Gate | $17.20 | $16.00 | +7.5% |
| Live Resin Cart 0.5g | NorCal | $19.60 | $18.40 | +6.5% |
| Mango Haze 3.5g | Pacific Coast | $15.00 | $13.60 | +10.3% |
| Edible Variety Pack | Parkside | $12.80 | $11.90 | +7.6% |

**Average variance: 8.2%**

### Why the Difference Exists
1. **Separate vendor accounts:** Each store has its own account with vendors, treated as independent customers
2. **Volume tiers:** Emerald Collective orders 25-30% higher volumes on flower, qualifying for better pricing
3. **Account history:** Emerald Collective was our first location — longer vendor relationships may have earned loyalty pricing
4. **Negotiation gaps:** Greenleaf pricing was set at store launch and hasn't been renegotiated

### Annual Cost of the Variance
- **Total shared-SKU spend at Greenleaf:** ~$142,000/year
- **Overpayment vs Emerald pricing:** ~$11,600/year
- **If consolidated under best pricing:** Save $11,600+ annually

## Recommended Actions

### Immediate
1. **Audit all vendor accounts** — Request current pricing schedules from each vendor for both locations
2. **Price-match request** — Contact vendors and request Greenleaf be moved to the same pricing tier as Emerald

### Short-Term (30 Days)
1. **Consolidate accounts** — Merge both store accounts into a single organizational account with each vendor
2. **Combined POs** — Place purchase orders under the single account and distribute between stores
3. **Volume leverage** — Combined volumes should qualify for even better pricing than either store alone

### Medium-Term (60 Days)
1. **Centralized purchasing** — Assign purchasing responsibility to one person/team for both stores
2. **Negotiate new terms** — Use the combined volume as leverage for 5-10% price reductions beyond current best pricing

## Financial Impact
| Action | Annual Savings |
|--------|---------------|
| Price-match Greenleaf to Emerald rates | $11,600 |
| Consolidate for additional volume discount (est 3%) | $7,200 |
| **Total potential savings** | **$18,800/year** |

## System Confidence
This insight carries **medium confidence** because while the pricing variance is clearly documented across invoices, some of the difference may be attributable to product packaging variations or promotional pricing that the system cannot fully distinguish from standard pricing.`,
  },
  {
    id: 'demo-learned-buyer-004',
    category: 'inventory',
    insight: 'Dead inventory accumulating — 6 SKUs are being purchased monthly but have not sold in 45+ days, tying up $4,200 in working capital',
    confidence: 'high',
    source: 'Progressive Learning - Phase 4',
    breadcrumbs: {
      dataSource: 'Invoice vs sales cross-reference - 90 days',
      leadingIndicator: '6 SKUs with $4,200 in unsold inventory',
      suggestedNext: 'Identify affected SKUs and plan clearance or return to vendor',
    },
    prewrittenResponse: `# Dead Inventory Accumulation Alert

## Executive Summary
Cross-referencing purchase invoices with point-of-sale data over the past 90 days reveals **6 SKUs that continue to be reordered on a monthly cycle despite having zero or near-zero sales for 45+ days**. These products represent approximately $4,200 in tied-up working capital that is not generating revenue.

## How This Was Discovered
The Progressive Learning system compared invoice line items (purchases) against sales records for every active SKU. It flagged products where purchase frequency remained constant but sales velocity dropped below 1 unit per week for 45+ consecutive days — indicating an automatic reorder pattern that hasn't been adjusted for declining demand.

## Affected SKUs

### Detailed Inventory Analysis
| SKU | Store | Last Sale | Units in Stock | Cost Basis | Monthly Reorder |
|-----|-------|-----------|---------------|-----------|-----------------|
| Topical Relief Cream 2oz | Greenleaf | 52 days ago | 24 units | $720 | 12 units |
| CBD Bath Bomb Variety | Greenleaf | 48 days ago | 18 units | $540 | 6 units |
| Cannabis-Infused Honey 8oz | Both | 61 days ago | 15 units | $675 | 8 units |
| THC Capsules 30ct (Legacy) | Emerald | 45 days ago | 30 units | $1,080 | 15 units |
| Indica Patch 10mg (Old Pack) | Greenleaf | 56 days ago | 20 units | $600 | 10 units |
| Hemp Protein Powder 16oz | Emerald | 67 days ago | 12 units | $585 | 6 units |

**Total dead inventory value: $4,200**
**Monthly reorder cost if unchanged: $1,890**

### Why These SKUs Stopped Selling
1. **Topical Relief Cream:** A newer, better-reviewed topical launched 2 months ago and captured this product's shelf position
2. **CBD Bath Bomb:** Seasonal item — sold well in winter gift season, demand dropped sharply in January
3. **Cannabis Honey:** Price point ($45 retail) is too high for the current customer base; competitor offers similar at $32
4. **THC Capsules (Legacy):** Vendor updated packaging and formulation — new version sells fine, but old inventory remains
5. **Indica Patch (Old Pack):** Same issue as capsules — new packaging launched, old stock is stale
6. **Hemp Protein Powder:** Niche product that attracted a small customer base; those customers may have churned

## Recommended Actions

### Immediate: Stop Reorders
1. **Remove all 6 SKUs from automatic reorder lists** — prevents an additional $1,890/month in dead stock accumulation
2. **Flag in inventory system** — mark these SKUs as "clearance" to prevent accidental manual reorders

### This Week: Clearance Strategy
| SKU | Recommended Action | Expected Recovery |
|-----|-------------------|-------------------|
| Topical Relief Cream | 40% off clearance rack | $432 (60% recovery) |
| CBD Bath Bomb | Bundle with other products | $378 (70% recovery) |
| Cannabis Honey | Mark down to $32 (match competitor) | $450 (67% recovery) |
| THC Capsules (Legacy) | Contact vendor for return/exchange | $1,080 (100% if accepted) |
| Indica Patch (Old Pack) | Contact vendor for return/exchange | $600 (100% if accepted) |
| Hemp Protein Powder | 50% off, then donate remainder | $292 (50% recovery) |

### Vendor Return Requests
- **THC Capsules and Indica Patch:** Both are packaging-related obsolescence. Contact the vendor — many will accept returns or offer credit toward new inventory when the issue is their packaging change
- **Estimated credit recovery:** $1,680 if vendor accepts returns

### Process Improvement
1. **Implement velocity alerts:** Flag any SKU with zero sales for 21+ days for review before next reorder
2. **Weekly dead stock report:** Add to the operations dashboard — show any SKU with >30 days of inventory and declining velocity
3. **Reorder approval gate:** Require manual approval for reorders on SKUs with sell-through below 2 units/week

## Financial Summary
| Category | Amount |
|----------|--------|
| Current dead inventory | $4,200 |
| Monthly reorder waste (if continued) | $1,890 |
| Expected clearance recovery | $2,232 (53%) |
| Expected vendor credit | $1,680 |
| **Net write-off** | **$288** |
| **Future monthly savings** | **$1,890/month** |

## System Confidence
This insight carries **high confidence** based on complete invoice and POS data with exact unit-level matching. The 45-day no-sale threshold was validated against historical patterns where products that go unsold for 45+ days have only a 12% chance of returning to normal velocity without intervention.`,
  },
  {
    id: 'demo-learned-buyer-005',
    category: 'trends',
    insight: 'Seasonal purchasing pattern detected — Vape category demand spikes 35% in December but purchasing orders remain flat, causing stockouts during peak season',
    confidence: 'medium',
    source: 'Progressive Learning - Phase 4',
    breadcrumbs: {
      dataSource: 'Multi-year sales vs purchasing seasonality',
      leadingIndicator: 'December vape sales up 35% YoY but purchase orders unchanged',
      suggestedNext: 'Pre-order additional vape inventory in November to prevent stockouts',
    },
    prewrittenResponse: `# Seasonal Purchasing Pattern — Vape Category December Spike

## Executive Summary
Multi-year analysis of sales data versus purchasing patterns reveals a **consistent mismatch in the vape category during December**. Sales spike approximately 35% above the annual average, but purchase order volumes remain flat, leading to predictable stockouts during the highest-revenue month of the year.

## How This Was Discovered
The Progressive Learning system analyzed 24 months of sales data alongside invoice records, segmented by product category and month. The vape category showed the strongest seasonal signal — a December spike that was present in both years of available data but was not reflected in purchasing behavior.

## Multi-Year Trend Analysis

### Vape Category Monthly Sales (Units)
| Month | Year 1 | Year 2 | Avg | vs Annual Avg |
|-------|--------|--------|-----|---------------|
| January | 420 | 460 | 440 | -8% |
| February | 390 | 410 | 400 | -16% |
| March | 440 | 470 | 455 | -5% |
| April | 460 | 480 | 470 | -2% |
| May | 470 | 490 | 480 | 0% |
| June | 480 | 510 | 495 | +3% |
| July | 500 | 520 | 510 | +6% |
| August | 490 | 510 | 500 | +4% |
| September | 470 | 490 | 480 | 0% |
| October | 460 | 480 | 470 | -2% |
| November | 500 | 530 | 515 | +7% |
| **December** | **620** | **680** | **650** | **+35%** |

### Purchase Orders vs Demand (December)
| Metric | Year 1 | Year 2 | Gap |
|--------|--------|--------|-----|
| Units Sold | 620 | 680 | — |
| Units Ordered | 485 | 500 | — |
| Stockout Days | 8 | 11 | Worsening |
| Estimated Lost Sales | $3,200 | $4,800 | +50% |

### Why December Spikes
1. **Holiday gifting:** Vape products are popular gifts — compact, premium-packaged, and widely appealing
2. **New user trials:** Holiday parties and social settings drive trial purchases from occasional users
3. **Gift cards redeemed:** January shows continued elevated sales as holiday gift card recipients shop
4. **Bonus spending:** Year-end bonuses and holiday cash increase discretionary spending

## Stockout Impact Analysis

### Year 2 December Stockouts (Detailed)
| SKU | Stockout Start | Days Out | Est. Lost Revenue |
|-----|---------------|----------|-------------------|
| Sunset Valley 1g Cart | Dec 14 | 6 days | $1,440 |
| Sierra Gold Disposable | Dec 18 | 4 days | $960 |
| Presidio Premium Pod | Dec 12 | 8 days | $1,280 |
| Fog City Live Resin Cart | Dec 20 | 3 days | $720 |
| Bay Vape Starter Kit | Dec 16 | 5 days | $400 |

**Total estimated lost revenue: $4,800**

## Recommended Purchasing Strategy

### Pre-Season Order (November)
Place a supplemental vape order in the **first week of November** to arrive by November 15th:
- **Target:** 35% above normal monthly order volume for vape category
- **Focus:** Top 10 vape SKUs by December velocity (from historical data)
- **Estimated additional order cost:** $4,200
- **Expected additional revenue:** $8,500+ (based on unmet demand from prior years)

### Specific SKU Targets
| SKU | Normal Monthly Order | Recommended November Order | Total December Stock |
|-----|---------------------|---------------------------|---------------------|
| Sunset Valley 1g Cart | 80 | 110 | 110 (buffer carries) |
| Sierra Gold Disposable | 65 | 90 | 90 |
| Presidio Premium Pod | 55 | 75 | 75 |
| Fog City Live Resin Cart | 45 | 62 | 62 |
| Bay Vape Starter Kit | 40 | 55 | 55 |

### Mid-Season Check (December 10)
- Review sell-through rates against projections
- Place a **quick-turn reorder** for any SKU tracking above 120% of projection
- Most vape vendors can fulfill rush orders within 3-5 business days

### Post-Season (January)
- Analyze actual vs projected December sales
- Adjust the seasonal model for next year
- Any excess inventory will sell through naturally in January (historically elevated month)

## Broader Seasonal Patterns Worth Monitoring
| Category | Seasonal Peak | Magnitude | Currently Planned For? |
|----------|--------------|-----------|----------------------|
| Vape | December | +35% | No |
| Edibles | October-November | +22% | Partially |
| Flower | April (4/20) | +45% | Yes |
| Topicals | June-August | +18% | No |
| Beverages | July-August | +28% | No |

## Financial Opportunity
| Metric | Current (No Planning) | With Pre-Season Order |
|--------|----------------------|----------------------|
| December vape revenue | $14,200 | $19,000+ |
| Stockout days | 8-11 | 0-2 |
| Lost sales | $4,800 | <$500 |
| **Net revenue gain** | — | **$4,300+** |

## System Confidence
This insight carries **medium confidence** because it is based on only 2 years of data. The December pattern is clear and consistent across both years, but a longer data history would increase certainty around the exact magnitude of the spike. The 35% figure could range from 28-42% in any given year.`,
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
