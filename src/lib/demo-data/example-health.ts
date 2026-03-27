/**
 * Example Data Health report for the demo experience.
 * Field names match the HealthCheckReport interface in DataHealthTab.tsx.
 */

export const EXAMPLE_HEALTH_REPORT = {
  report_id: 'demo-health-001',
  timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
  summary: {
    overallHealthScore: 82,
    totalGaps: 3,
    criticalGaps: 1,
    warningGaps: 4,
    infoGaps: 2,
    trendAnomalies: 2,
  },
  dataFreshness: [
    {
      source: 'Sales Data',
      lastDataPoint: new Date(Date.now() - 1 * 86400000).toISOString(),
      status: 'fresh' as const,
      dataLagDays: 1,
    },
    {
      source: 'Brand Data',
      lastDataPoint: new Date(Date.now() - 3 * 86400000).toISOString(),
      status: 'fresh' as const,
      dataLagDays: 3,
    },
    {
      source: 'Customer Data',
      lastDataPoint: new Date(Date.now() - 8 * 86400000).toISOString(),
      status: 'stale' as const,
      dataLagDays: 8,
    },
    {
      source: 'Invoice Data',
      lastDataPoint: new Date(Date.now() - 2 * 86400000).toISOString(),
      status: 'fresh' as const,
      dataLagDays: 2,
    },
    {
      source: 'Budtender Data',
      lastDataPoint: new Date(Date.now() - 1 * 86400000).toISOString(),
      status: 'fresh' as const,
      dataLagDays: 1,
    },
  ],
  gaps: [
    {
      id: 'gap-001',
      type: 'data_staleness',
      severity: 'critical' as const,
      source: 'Customer Data',
      description: 'Customer records have not been updated in 8 days. The expected refresh frequency is weekly. Stale customer data may cause inaccurate segment breakdowns and retention metrics.',
      affectedRecords: 830412,
      suggestedAction: 'Upload a fresh customer export from Treez in the Data Center > Customer Data tab.',
    },
    {
      id: 'gap-002',
      type: 'missing_data',
      severity: 'warning' as const,
      source: 'Product Data',
      description: 'Product category breakdown data is missing for March 22, 23, and 24. This may cause gaps in the Product Categories analytics view.',
      affectedRecords: 0,
      suggestedAction: 'Upload product data CSVs for the missing date range.',
    },
    {
      id: 'gap-003',
      type: 'coverage',
      severity: 'info' as const,
      source: 'Brand Mapping',
      description: '42 of 48 unique brand names in the sales data are mapped to canonical brands. 6 unmapped brands account for 4.2% of revenue.',
      affectedRecords: 6,
      suggestedAction: 'Review unmapped brands in Data Center > Brand Mapping and add aliases.',
    },
  ],
  trends: [
    {
      id: 'trend-001',
      metric: 'Daily Transaction Count',
      currentValue: 126,
      baselineValue: 142,
      percentChange: -11.2,
      direction: 'decrease' as const,
      severity: 'warning' as const,
    },
    {
      id: 'trend-002',
      metric: 'Emerald Collective Weekend Revenue',
      currentValue: 9240,
      baselineValue: 7890,
      percentChange: 17.1,
      direction: 'increase' as const,
      severity: 'info' as const,
    },
  ],
  insights: [
    'Overall data health is good at 82/100. The main action item is refreshing customer data.',
    'Sales and budtender data pipelines are functioning normally with daily updates.',
    'Brand mapping coverage is strong but could be improved by mapping 6 remaining brands.',
    'The transaction count decline deserves attention — see the Sales Trends tab for more detail.',
  ],
  recommendations: [
    'Upload fresh customer data this week to restore accurate segmentation.',
    'Set up automated customer data exports from Treez to prevent staleness.',
    'Map the remaining 6 brands to improve analytics accuracy from 87% to 100% coverage.',
    'Investigate the transaction count decline and consider weekday promotional strategies.',
  ],
};
