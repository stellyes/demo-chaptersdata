/**
 * Example QR code and analytics data for the demo experience.
 */

export const EXAMPLE_QR_CODES = [
  {
    id: 'demo-qr-001',
    shortCode: 'gl-menu',
    originalUrl: 'https://greenleafmarket.com/menu',
    trackingUrl: 'https://demo.chaptersdata.com/r/gl-menu',
    name: 'Greenleaf Market Menu',
    description: 'In-store table tent QR code linking to the live online menu',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    totalClicks: 1847,
    active: true,
  },
  {
    id: 'demo-qr-002',
    shortCode: 'gl-review',
    originalUrl: 'https://google.com/maps/place/greenleaf-market',
    trackingUrl: 'https://demo.chaptersdata.com/r/gl-review',
    name: 'Leave a Review - Greenleaf',
    description: 'Post-purchase receipt QR code directing customers to leave a Google review',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    totalClicks: 423,
    active: true,
  },
  {
    id: 'demo-qr-003',
    shortCode: 'ec-loyalty',
    originalUrl: 'https://emeraldcollective.com/loyalty-signup',
    trackingUrl: 'https://demo.chaptersdata.com/r/ec-loyalty',
    name: 'Emerald Collective Loyalty Signup',
    description: 'Counter display QR code for loyalty program registration',
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    totalClicks: 612,
    active: true,
  },
  {
    id: 'demo-qr-004',
    shortCode: 'ec-deals',
    originalUrl: 'https://emeraldcollective.com/deals',
    trackingUrl: 'https://demo.chaptersdata.com/r/ec-deals',
    name: 'Weekly Deals - Emerald',
    description: 'Window display QR code for current weekly deals and promotions',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    totalClicks: 289,
    active: true,
  },
];

function generateDailyScans(days: number, baseScans: number): Array<{ date: string; scans: number }> {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    // Weekend boost
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 1.6 : 1.0;
    // Small random variation using a deterministic seed-like pattern
    const variation = 0.7 + ((i * 7 + 13) % 10) / 15;
    const scans = Math.round(baseScans * weekendFactor * variation);
    data.push({
      date: d.toISOString().split('T')[0],
      scans,
    });
  }
  return data;
}

export const EXAMPLE_QR_ANALYTICS = {
  totalScans: 3171,
  avgPerDay: 42,
  activeQrCodes: 4,
  totalQrCodes: 4,
  dailyScans: generateDailyScans(30, 42),
  topPerforming: [
    { name: 'Greenleaf Market Menu', scans: 1847, shortCode: 'gl-menu' },
    { name: 'Emerald Collective Loyalty Signup', scans: 612, shortCode: 'ec-loyalty' },
    { name: 'Leave a Review - Greenleaf', scans: 423, shortCode: 'gl-review' },
    { name: 'Weekly Deals - Emerald', scans: 289, shortCode: 'ec-deals' },
  ],
  deviceBreakdown: [
    { device: 'Mobile', percentage: 78, count: 2473 },
    { device: 'Tablet', percentage: 14, count: 444 },
    { device: 'Desktop', percentage: 8, count: 254 },
  ],
  browserBreakdown: [
    { browser: 'Safari', percentage: 52, count: 1649 },
    { browser: 'Chrome', percentage: 38, count: 1205 },
    { browser: 'Samsung Internet', percentage: 6, count: 190 },
    { browser: 'Other', percentage: 4, count: 127 },
  ],
  osBreakdown: [
    { os: 'iOS', percentage: 55, count: 1744 },
    { os: 'Android', percentage: 37, count: 1173 },
    { os: 'Windows', percentage: 5, count: 159 },
    { os: 'macOS', percentage: 3, count: 95 },
  ],
  topReferrers: [
    { referrer: 'Direct (QR Scan)', count: 2854 },
    { referrer: 'Instagram Bio', count: 187 },
    { referrer: 'Google Maps', count: 130 },
  ],
  recentClicks: [
    { timestamp: new Date(Date.now() - 1200000).toISOString(), qrName: 'Greenleaf Market Menu', device: 'iPhone', browser: 'Safari', city: 'San Francisco' },
    { timestamp: new Date(Date.now() - 3600000).toISOString(), qrName: 'Leave a Review - Greenleaf', device: 'Pixel 8', browser: 'Chrome', city: 'San Francisco' },
    { timestamp: new Date(Date.now() - 7200000).toISOString(), qrName: 'Emerald Collective Loyalty Signup', device: 'iPhone', browser: 'Safari', city: 'Oakland' },
    { timestamp: new Date(Date.now() - 10800000).toISOString(), qrName: 'Weekly Deals - Emerald', device: 'Samsung Galaxy', browser: 'Samsung Internet', city: 'Berkeley' },
    { timestamp: new Date(Date.now() - 14400000).toISOString(), qrName: 'Greenleaf Market Menu', device: 'iPad', browser: 'Safari', city: 'San Francisco' },
  ],
};
