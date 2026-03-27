/**
 * Continuation seed script — picks up where seed-demo.ts left off.
 * Only seeds sections that have 0 records: products, budtenders, customers, digests, monthly reports.
 * Uses createMany for bulk inserts where possible.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Seeded PRNG (same as seed-demo.ts) ─────────────────────────────────────
let _seed = 42;
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(_seed);
// Fast-forward to consistent state after earlier sections:
// We need to skip the same number of rand() calls as the main seed uses for
// org + stores + brands + vendors + sales + brand records.
// For simplicity, we re-seed at a different offset for the continuation sections.
_seed = 9999;
rand = mulberry32(_seed);

function random(min: number, max: number) { return min + rand() * (max - min); }
function randomInt(min: number, max: number) { return Math.floor(random(min, max + 1)); }
function gaussRandom(mean: number, std: number) {
  const u = 1 - rand();
  const v = rand();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function d2(n: number) { return Math.round(n * 100) / 100; }
function d3(n: number) { return Math.round(n * 1000) / 1000; }
function d4(n: number) { return Math.round(n * 10000) / 10000; }
function d1(n: number) { return n.toFixed(1); }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function formatDate(d: Date) { return d.toISOString().split('T')[0]; }

const START_DATE = new Date('2016-01-01');
const END_DATE = new Date('2026-03-25');

const PRODUCT_TYPES = ['Flower', 'Pre-Roll', 'Vape', 'Edible', 'Concentrate', 'Tincture', 'Topical', 'Accessory'];
const PRODUCT_PROFILES: Record<string, { shareWeight: number; marginRange: [number, number]; avgCostRange: [number, number] }> = {
  Flower: { shareWeight: 0.30, marginRange: [0.45, 0.60], avgCostRange: [8, 18] },
  'Pre-Roll': { shareWeight: 0.18, marginRange: [0.50, 0.65], avgCostRange: [4, 10] },
  Vape: { shareWeight: 0.18, marginRange: [0.40, 0.55], avgCostRange: [12, 28] },
  Edible: { shareWeight: 0.12, marginRange: [0.50, 0.65], avgCostRange: [5, 15] },
  Concentrate: { shareWeight: 0.10, marginRange: [0.38, 0.52], avgCostRange: [15, 35] },
  Tincture: { shareWeight: 0.05, marginRange: [0.55, 0.70], avgCostRange: [10, 25] },
  Topical: { shareWeight: 0.04, marginRange: [0.55, 0.72], avgCostRange: [8, 20] },
  Accessory: { shareWeight: 0.03, marginRange: [0.60, 0.80], avgCostRange: [3, 12] },
};

const EMPLOYEE_NAMES = [
  'Alex Rivera', 'Jordan Chen', 'Sam Patel', 'Casey Nguyen', 'Morgan O\'Brien',
  'Taylor Kim', 'Riley Martinez', 'Quinn Jackson', 'Avery Washington', 'Jamie Li',
  'Dakota Moore', 'Skyler Thompson', 'Drew Garcia', 'Parker Anderson', 'Reese Scott',
];

const FIRST_NAMES = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Emma','Liam','Olivia','Noah','Ava','Isabella','Sophia','Mia','Charlotte','Amelia','Harper','Evelyn','Abigail','Daniel','Matthew','Andrew','Joshua','Ethan','Benjamin','Lucas','Mason'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores'];

function growthMultiplier(date: Date): number {
  const yearsFromStart = (date.getTime() - START_DATE.getTime()) / (365.25 * 86400000);
  return Math.pow(1.08, yearsFromStart);
}
function seasonalMultiplier(date: Date): number {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 3 && day >= 18 && day <= 22) return 1.40;
  if (month === 11 && day >= 20) return 1.20;
  const seasonMap = [0.90, 0.88, 0.95, 1.05, 1.02, 1.00, 1.05, 1.03, 0.98, 1.02, 1.08, 1.15];
  return seasonMap[month];
}
function weekendMultiplier(date: Date): number {
  const dow = date.getDay();
  if (dow === 5) return 1.15;
  if (dow === 6) return 1.25;
  if (dow === 0) return 1.10;
  return 1.0;
}

function* dateRange(start: Date, end: Date) {
  const d = new Date(start);
  while (d <= end) {
    yield new Date(d);
    d.setDate(d.getDate() + 1);
  }
}

function* monthRange(start: Date, end: Date) {
  let year = start.getFullYear();
  let month = start.getMonth();
  const endYear = end.getFullYear();
  const endMonth = end.getMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    yield { year, month };
    month++;
    if (month > 11) { month = 0; year++; }
  }
}

function monthStart(year: number, month: number) { return new Date(year, month, 1); }
function monthEnd(year: number, month: number) { return new Date(year, month + 1, 0); }
function daysBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }

// ─── Digest content generator (same templates as seed-demo.ts) ───────────────
function generateDigestContent(digestDate: Date, index: number) {
  const dateStr = formatDate(digestDate);
  const template = index % 3;

  const executiveSummaries = [
    `Yesterday's performance across both locations showed strong momentum heading into the final stretch of the quarter. Greenleaf Market posted $${randomInt(11000, 15000).toLocaleString()} in net sales (+${randomInt(3, 12)}% vs comparable day last year), driven primarily by flower and pre-roll categories. Emerald Collective contributed $${randomInt(8000, 11000).toLocaleString()}, with notable strength in the edible category following the new Pacific Bloom product placement. Combined ticket count reached ${randomInt(175, 260)} with an average basket size of $${randomInt(58, 78)}. Customer traffic patterns suggest increasing weekend concentration, which impacts staffing efficiency. Three brand partnerships showed meaningful movement worth monitoring.`,
    `Analysis for ${dateStr} reveals mixed signals across key metrics. Combined net sales of $${randomInt(18000, 25000).toLocaleString()} represent a ${randomInt(1, 8)}% increase over the same day last week, though Emerald Collective's weekday traffic continues its gradual softening trend (now ${randomInt(3, 7)}% below 30-day average). The bright spot is margin performance — gross margins hit ${d1(random(52, 57))}% driven by a product mix shift toward higher-margin pre-rolls and tinctures. Customer acquisition was solid with ${randomInt(8, 18)} new registrations, though the VIP segment's purchasing frequency dipped slightly. Budtender performance metrics show improving consistency after last week's training refresher.`,
    `${dateStr} delivered above-plan results for the Chapters demo portfolio. Greenleaf Market's strong showing ($${randomInt(12000, 16000).toLocaleString()} net sales, ${randomInt(95, 140)} tickets) was complemented by Emerald Collective's best weekday in ${randomInt(2, 4)} weeks ($${randomInt(7500, 10500).toLocaleString()}). The combined AOV of $${randomInt(62, 82)} reflects effective upselling from the budtender team, particularly in accessory attach rates which climbed to ${randomInt(15, 25)}%. Key concern: concentrate category margins compressed another ${randomInt(1, 3)} points, now at ${d1(random(38, 44))}% vs target of 48%. Investigation suggests pricing pressure from a new competitor's aggressive promotional strategy.`,
  ];

  const allPriorityActions = [
    [
      { action: 'Review flower pricing at Emerald — competitor dropped prices 8% this week', timeframe: '48 hours', impact: 'Could recover $2K-4K monthly margin', category: 'pricing' },
      { action: 'Schedule vendor meeting with Golden State Greens to discuss Q2 exclusives', timeframe: 'This week', impact: 'Potential 3-5% margin improvement on their top SKUs', category: 'purchasing' },
      { action: 'Address budtender cross-selling gap at Greenleaf morning shift', timeframe: 'Next training session', impact: 'Morning AOV $12 below evening — bridging gap = $800/week', category: 'staff' },
    ],
    [
      { action: 'Investigate Emerald Collective weekday traffic decline — now 7% below trend', timeframe: '72 hours', impact: 'Arresting decline could recover $5K-8K monthly', category: 'operations' },
      { action: 'Launch targeted win-back campaign for 90-120 day lapsed customers', timeframe: 'This week', impact: '${randomInt(200, 400)} customers eligible, avg LTV recovery $${randomInt(150, 300)}', category: 'customers' },
      { action: 'Renegotiate Bay Area Botanicals terms based on declining sell-through', timeframe: '2 weeks', impact: 'Current terms 5% below market for their volume tier', category: 'purchasing' },
      { action: 'Implement express checkout for pre-order pickups at both locations', timeframe: '1 week', impact: 'Reduces wait time 40%, improves customer experience scores', category: 'operations' },
    ],
    [
      { action: 'Deep dive on concentrate margin compression — identify root cause', timeframe: '48 hours', impact: '3-point margin recovery = $3K-5K monthly improvement', category: 'pricing' },
      { action: 'Fast-track Pacific Bloom exclusive partnership for Q2 launch', timeframe: '1 week', impact: 'First-mover advantage on their new infused pre-roll line', category: 'purchasing' },
      { action: 'Review and optimize weekend staffing model at both locations', timeframe: 'Before next weekend', impact: 'Current model overstaffs Tuesday, understaffs Saturday 2-6pm', category: 'staff' },
    ],
  ];

  const allQuickWins = [
    [
      { action: 'Move pre-roll display to checkout counter at Emerald', effort: '1 hour', impact: 'Estimated $200-400/week in impulse purchases' },
      { action: 'Update digital menu board with current top sellers', effort: '30 minutes', impact: 'Aligns recommendations with actual inventory availability' },
      { action: 'Text blast to VIP customers about Thursday flower drop', effort: '15 minutes', impact: 'Historical 12% conversion rate on VIP notifications' },
    ],
    [
      { action: 'Restock Greenleaf\'s top 3 SKUs that hit low inventory yesterday', effort: '1 hour', impact: 'These SKUs drive $1.2K/day — stockout costs $400-600/day' },
      { action: 'Post customer testimonial about Pacific Bloom to social media', effort: '20 minutes', impact: 'Social posts with reviews get 3x engagement vs product shots' },
      { action: 'Update loyalty point multiplier for slow-moving concentrates', effort: '15 minutes', impact: 'Could move $2K in aged inventory this week' },
    ],
    [
      { action: 'Cross-merchandise edibles with new tincture arrivals', effort: '45 minutes', impact: 'Bundled displays increase category basket size 22%' },
      { action: 'Send budtender performance leaderboard to team Slack', effort: '10 minutes', impact: 'Gamification drives 8-12% productivity lift in first week' },
      { action: 'Schedule social media post highlighting weekend specials', effort: '20 minutes', impact: 'Weekend promo posts drive avg 15 incremental visits' },
    ],
  ];

  return {
    executiveSummary: executiveSummaries[template],
    priorityActions: allPriorityActions[template],
    quickWins: allQuickWins[template],
    watchItems: [
      { item: 'Emerald Collective weekday traffic trend', reason: 'Down 7% MoM — new competitor effect?', monitorUntil: formatDate(new Date(digestDate.getTime() + 30 * 86400000)) },
      { item: 'Concentrate category margins', reason: 'Compressed 3 points in 2 weeks', monitorUntil: formatDate(new Date(digestDate.getTime() + 14 * 86400000)) },
      { item: 'Pacific Bloom launch performance', reason: 'New product — tracking trial and repeat rates', monitorUntil: formatDate(new Date(digestDate.getTime() + 21 * 86400000)) },
    ],
    industryHighlights: [
      { headline: 'California cannabis tax revenue hits record quarterly high', source: 'CA Dept of Tax and Fee Administration', relevance: 'Market growth validates expansion strategy', actionItem: 'Review tax rate impact on margins' },
      { headline: 'Pre-roll category overtakes flower in key urban markets', source: 'Headset Analytics', relevance: 'Our pre-roll growth aligns with national trend', actionItem: 'Evaluate expanding pre-roll shelf space' },
      { headline: 'SF considering cannabis consumption lounge permits', source: 'SF Chronicle', relevance: 'New revenue channel opportunity for existing operators' },
    ],
    regulatoryUpdates: [
      { update: 'SF DPH releasing updated ventilation requirements for dispensaries', source: 'SF Dept of Public Health', impactLevel: 'medium' as const, deadline: formatDate(new Date(digestDate.getTime() + 60 * 86400000)) },
      { update: 'State packaging compliance deadline approaching for child-resistant containers', source: 'CA BCC', impactLevel: 'high' as const, deadline: formatDate(new Date(digestDate.getTime() + 45 * 86400000)) },
    ],
    marketTrends: [
      { trend: 'Consumers shifting toward premium tier products', evidence: 'Avg price per gram up 8% YoY while volume flat', implication: 'Prioritize premium brand partnerships for margin' },
      { trend: 'Delivery services capturing increasing share of repeat purchases', evidence: 'Delivery orders up 35% market-wide', implication: 'Evaluate own delivery launch timeline' },
      { trend: 'Social equity brands gaining shelf space and consumer preference', evidence: 'Category growing 2x overall market rate', implication: 'Expand social equity brand partnerships for both customer appeal and community impact' },
    ],
    questionsForTomorrow: [
      { question: 'What is driving the vape category surge at Greenleaf but not Emerald?', priority: 8, category: 'sales_analysis' },
      { question: 'Are lapsed VIP customers responding to win-back communications?', priority: 7, category: 'customer_retention' },
      { question: 'How does our concentrate pricing compare to the top 5 SF dispensaries?', priority: 6, category: 'competitive_intel' },
      { question: 'What is the optimal product assortment for Emerald weekday maximization?', priority: 5, category: 'operations' },
    ],
    correlatedInsights: [
      { internalObservation: 'Pre-roll sales up 18% in last 2 weeks at both locations', externalEvidence: 'Industry data shows pre-roll category growing 25% YoY nationally', correlation: 'Our growth aligns with but slightly trails national trends — room to capture more', confidence: d2(random(0.75, 0.85)), actionItem: 'Expand pre-roll selection by 20%', category: 'product_trends' },
      { internalObservation: 'Customer acquisition cost stable while retention improving', externalEvidence: 'Industry benchmarks show rising CAC across cannabis retail', correlation: 'Our stable CAC vs rising industry suggests effective organic/referral channel', confidence: d2(random(0.71, 0.82)), actionItem: 'Double down on referral program investment', category: 'customer_retention' },
    ],
    dataHealthScore: d2(clamp(random(0.82, 0.97), 0.8, 1.0)),
    confidenceScore: d2(clamp(random(0.75, 0.92), 0.7, 0.95)),
  };
}

async function main() {
  console.log('=== Demo Seed Continuation ===\n');

  // Get storefronts
  const stores = await prisma.storefront.findMany();
  const storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }> = {};
  for (const s of stores) {
    const scale = s.name.includes('Greenleaf') ? 1.0 : 0.75;
    const sId = s.name.includes('Greenleaf') ? 'greenleaf' : 'emerald';
    storefronts[sId] = { dbId: s.id, storefrontId: sId, storeName: s.name, scaleFactor: scale };
  }
  console.log(`Found ${stores.length} storefronts\n`);

  // 1. Product Records
  const productCount = await prisma.productRecord.count();
  if (productCount === 0) {
    console.log('--- Seeding Product Records ---');
    let total = 0;
    for (const store of Object.values(storefronts)) {
      const batch: Prisma.ProductRecordCreateManyInput[] = [];
      let totalShareWeight = 0;
      for (const pt of PRODUCT_TYPES) totalShareWeight += PRODUCT_PROFILES[pt].shareWeight;

      for (const { year, month } of monthRange(START_DATE, END_DATE)) {
        const mStart = monthStart(year, month);
        const mEnd = monthEnd(year, month);
        const daysInMonth = mEnd.getDate();
        const midMonth = new Date(year, month, 15);
        const monthNetSales = 4800 * 0.88 * growthMultiplier(midMonth) * seasonalMultiplier(midMonth) * store.scaleFactor * daysInMonth;

        for (const productType of PRODUCT_TYPES) {
          const profile = PRODUCT_PROFILES[productType];
          const share = (profile.shareWeight / totalShareWeight) * clamp(1.0 + gaussRandom(0, 0.1), 0.7, 1.3);
          batch.push({
            storefrontId: store.dbId,
            storeId: store.storefrontId,
            storeName: store.storeName,
            productType,
            pctOfTotalNetSales: d4(clamp(share, 0.005, 0.5)),
            grossMarginPct: d3(clamp(random(profile.marginRange[0], profile.marginRange[1]), 0.3, 0.8)),
            avgCostWoExcise: d2(random(profile.avgCostRange[0], profile.avgCostRange[1])),
            netSales: d2(monthNetSales * share),
            uploadStartDate: mStart,
            uploadEndDate: mEnd,
          });
        }
      }
      await prisma.productRecord.createMany({ data: batch });
      total += batch.length;
      console.log(`  ${store.storefrontId}: ${batch.length} product records`);
    }
    console.log(`  Total: ${total}\n`);
  } else {
    console.log(`Product records: ${productCount} (skipping)\n`);
  }

  // 2. Budtender Records
  const budtenderCount = await prisma.budtenderRecord.count();
  if (budtenderCount === 0) {
    console.log('--- Seeding Budtender Records ---');
    const budtenderStart = new Date('2024-03-26');
    let total = 0;
    for (const store of Object.values(storefronts)) {
      const batch: Prisma.BudtenderRecordCreateManyInput[] = [];
      const employeeSkills: Record<string, { salesMultiplier: number; marginBonus: number }> = {};
      for (const emp of EMPLOYEE_NAMES) {
        employeeSkills[emp] = { salesMultiplier: clamp(gaussRandom(1.0, 0.25), 0.5, 1.8), marginBonus: gaussRandom(0, 0.03) };
      }

      for (const date of dateRange(budtenderStart, END_DATE)) {
        const growth = growthMultiplier(date);
        const season = seasonalMultiplier(date);
        const weekend = weekendMultiplier(date);
        const workingCount = randomInt(8, 12);
        const shuffled = [...EMPLOYEE_NAMES].sort(() => rand() - 0.5);
        const workingToday = shuffled.slice(0, workingCount);
        const storeDayBase = 4800 * growth * season * weekend * store.scaleFactor * 0.88;
        let remainingSales = storeDayBase;

        for (let i = 0; i < workingToday.length; i++) {
          const emp = workingToday[i];
          const skill = employeeSkills[emp];
          const isLast = i === workingToday.length - 1;
          const shareBase = (1.0 / workingToday.length) * skill.salesMultiplier;
          const empSales = isLast ? Math.max(0, remainingSales) : d2(storeDayBase * shareBase * clamp(1.0 + gaussRandom(0, 0.15), 0.5, 2.0));
          remainingSales -= empSales;
          const tickets = Math.max(1, Math.round(empSales / random(45, 80)));
          const customers = Math.max(1, Math.round(tickets * random(0.7, 0.95)));
          const units = Math.max(1, Math.round(tickets * random(2.0, 3.5)));

          batch.push({
            storefrontId: store.dbId,
            storeId: store.storefrontId,
            storeName: store.storeName,
            employeeName: emp,
            date,
            ticketsCount: tickets,
            customersCount: customers,
            netSales: Math.max(0, d2(empSales)),
            grossMarginPct: d3(clamp(random(0.45, 0.6) + skill.marginBonus, 0.35, 0.72)),
            avgOrderValue: d2(tickets > 0 ? empSales / tickets : 0),
            unitsSold: units,
          });
        }
      }

      // Insert in chunks of 500
      for (let i = 0; i < batch.length; i += 500) {
        await prisma.budtenderRecord.createMany({ data: batch.slice(i, i + 500) });
        process.stdout.write(`  ${store.storefrontId}: ${Math.min(i + 500, batch.length)}/${batch.length}...\r`);
      }
      total += batch.length;
      console.log(`  ${store.storefrontId}: ${batch.length} budtender records       `);
    }
    console.log(`  Total: ${total}\n`);
  } else {
    console.log(`Budtender records: ${budtenderCount} (skipping)\n`);
  }

  // 3. Customers
  const customerCount = await prisma.customer.count();
  if (customerCount === 0) {
    console.log('--- Seeding Customers ---');
    const CUSTOMERS_PER_STORE = 5000;
    let total = 0;
    for (const store of Object.values(storefronts)) {
      const batch: Prisma.CustomerCreateManyInput[] = [];
      for (let i = 0; i < CUSTOMERS_PER_STORE; i++) {
        const firstName = pick(FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        const customerId = `CUST-${store.storefrontId.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(5, '0')}`;
        const signupOffset = Math.floor(rand() * daysBetween(START_DATE, END_DATE));
        const signupDate = new Date(START_DATE.getTime() + signupOffset * 86400000);
        const maxDaysFromSignup = daysBetween(signupDate, END_DATE);
        const recencySkew = Math.pow(rand(), 0.5);
        const lastVisitOffset = Math.floor(maxDaysFromSignup * recencySkew);
        const lastVisitDate = new Date(signupDate.getTime() + lastVisitOffset * 86400000);
        const daysSinceSignup = daysBetween(signupDate, END_DATE);
        const daysSinceLastVisit = daysBetween(lastVisitDate, END_DATE);
        const tenureYears = daysSinceSignup / 365;
        const lifetimeVisits = Math.max(1, Math.round(clamp(gaussRandom(tenureYears * 12, tenureYears * 5), 1, tenureYears * 52)));
        const lifetimeTransactions = Math.max(1, Math.round(lifetimeVisits * random(0.8, 1.2)));
        const aov = d2(clamp(gaussRandom(62, 22), 15, 250));
        const lifetimeNetSales = d2(lifetimeTransactions * aov);
        const age = Math.max(21, Math.min(75, Math.round(gaussRandom(33, 10))));
        const birthYear = END_DATE.getFullYear() - age;
        const dateOfBirth = new Date(birthYear, randomInt(0, 11), randomInt(1, 28));

        let customerSegment: string;
        if (lifetimeNetSales > 3000 && lifetimeVisits > 50) customerSegment = 'VIP';
        else if (lifetimeVisits > 20) customerSegment = 'Regular';
        else if (lifetimeVisits > 5) customerSegment = 'Occasional';
        else if (daysSinceSignup < 90) customerSegment = 'New';
        else if (daysSinceLastVisit > 180) customerSegment = 'Lapsed';
        else customerSegment = 'At-Risk';

        let recencySegment: string;
        if (daysSinceLastVisit < 30) recencySegment = 'Active';
        else if (daysSinceLastVisit < 90) recencySegment = 'Recent';
        else if (daysSinceLastVisit < 180) recencySegment = 'Lapsing';
        else if (daysSinceLastVisit < 365) recencySegment = 'At-Risk';
        else recencySegment = 'Lost';

        batch.push({
          storefrontId: store.dbId,
          storeName: store.storeName,
          customerId,
          name: `${firstName} ${lastName}`,
          dateOfBirth,
          age,
          lifetimeVisits,
          lifetimeTransactions,
          lifetimeNetSales,
          lifetimeAov: aov,
          signupDate,
          lastVisitDate,
          customerSegment,
          recencySegment,
        });
      }
      // Insert in chunks of 500
      for (let i = 0; i < batch.length; i += 500) {
        await prisma.customer.createMany({ data: batch.slice(i, i + 500) });
        process.stdout.write(`  ${store.storefrontId}: ${Math.min(i + 500, batch.length)}/${CUSTOMERS_PER_STORE}...\r`);
      }
      total += batch.length;
      console.log(`  ${store.storefrontId}: ${CUSTOMERS_PER_STORE} customers          `);
    }
    console.log(`  Total: ${total}\n`);
  } else {
    console.log(`Customers: ${customerCount} (skipping)\n`);
  }

  // 4. Daily Digests
  const digestCount = await prisma.dailyDigest.count();
  if (digestCount === 0) {
    console.log('--- Seeding Daily Digests ---');
    for (let i = 29; i >= 0; i--) {
      const digestDate = new Date(END_DATE.getTime() - i * 86400000);
      const content = generateDigestContent(digestDate, i);
      const digest = await prisma.dailyDigest.create({
        data: {
          digestDate,
          executiveSummary: content.executiveSummary,
          priorityActions: content.priorityActions,
          quickWins: content.quickWins,
          watchItems: content.watchItems,
          industryHighlights: content.industryHighlights,
          regulatoryUpdates: content.regulatoryUpdates,
          marketTrends: content.marketTrends,
          questionsForTomorrow: content.questionsForTomorrow,
          correlatedInsights: content.correlatedInsights,
          dataHealthScore: content.dataHealthScore,
          confidenceScore: content.confidenceScore,
        },
      });
      const startedAt = new Date(digestDate.getTime() - randomInt(300, 600) * 1000);
      const completedAt = new Date(startedAt.getTime() + randomInt(120, 300) * 1000);
      await prisma.dailyLearningJob.create({
        data: {
          startedAt, completedAt, status: 'completed', currentPhase: 'completed', lastHeartbeat: completedAt,
          dataReviewDone: true, questionGenDone: true, webResearchDone: true, correlationDone: true, digestGenDone: true,
          inputTokens: randomInt(45000, 85000), outputTokens: randomInt(8000, 18000),
          searchesUsed: randomInt(3, 8), estimatedCost: d4(random(0.15, 0.45)),
          questionsGenerated: randomInt(5, 10), insightsDiscovered: randomInt(3, 8), articlesAnalyzed: randomInt(4, 12),
          digestId: digest.id,
        },
      });
      process.stdout.write(`  ${30 - i}/30 digests...\r`);
    }
    console.log(`  Created 30 daily digests with learning jobs\n`);
  } else {
    console.log(`Digests: ${digestCount} (skipping)\n`);
  }

  // 5. Monthly Strategic Reports
  const monthlyCount = await prisma.monthlyStrategicReport.count();
  if (monthlyCount === 0) {
    console.log('--- Seeding Monthly Strategic Reports ---');
    const reportMonths = [
      { year: 2025, month: 9, label: '2025-10' }, { year: 2025, month: 10, label: '2025-11' },
      { year: 2025, month: 11, label: '2025-12' }, { year: 2026, month: 0, label: '2026-01' },
      { year: 2026, month: 1, label: '2026-02' }, { year: 2026, month: 2, label: '2026-03' },
    ];
    const grades = ['A-', 'B+', 'A', 'B+', 'A-', 'B+'];

    for (let i = 0; i < reportMonths.length; i++) {
      const { year, month, label } = reportMonths[i];
      const grade = grades[i];
      const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const report = await prisma.monthlyStrategicReport.create({
        data: {
          monthYear: label,
          executiveSummary: `${monthName} delivered ${grade.startsWith('A') ? 'strong' : 'solid'} performance for Demo Retail Group with combined net sales of $${randomInt(380, 520)}K across both locations, representing ${randomInt(5, 15)}% year-over-year growth. Greenleaf Market contributed $${randomInt(220, 300)}K while Emerald Collective added $${randomInt(160, 220)}K. Gross margins held steady at ${d1(random(50, 58))}% despite competitive pricing pressure.`,
          performanceGrade: grade,
          monthOverMonthChange: { netSales: d2(random(-3, 12)), grossMargin: d2(random(-2, 3)), tickets: d2(random(-5, 10)), customers: d2(random(-2, 8)), aov: d2(random(-3, 6)) },
          strengthsAnalysis: [
            { strength: 'Consistent revenue growth trajectory', evidence: `${randomInt(6, 14)}% YoY growth maintained`, impact: 'Revenue compounding provides reinvestment capacity' },
            { strength: 'Strong brand portfolio diversity', evidence: `30 active brands, no single brand > ${randomInt(8, 12)}%`, impact: 'Reduces vendor dependency risk' },
            { strength: 'Above-average VIP retention', evidence: `VIP 90-day retention at ${randomInt(78, 88)}%`, impact: 'Stable revenue foundation' },
            { strength: 'Effective budtender team', evidence: `Avg AOV $${randomInt(62, 78)} vs industry $55-60`, impact: 'Higher transaction values' },
          ],
          weaknessesAnalysis: [
            { weakness: 'Emerald Collective weekday traffic below potential', evidence: `Weekday avg ${randomInt(65, 85)} vs Greenleaf ${randomInt(95, 120)}`, impact: '$${randomInt(15, 30)}K monthly opportunity' },
            { weakness: 'Concentrate margin compression', evidence: `Down ${d1(random(2, 5))} points over 3 months`, impact: 'Affecting overall profitability' },
            { weakness: 'New customer second-visit conversion', evidence: `${randomInt(35, 42)}% return within 30 days`, impact: 'CAC not fully recovered' },
          ],
          opportunitiesAnalysis: [
            { opportunity: 'Cannabis beverage expansion', evidence: 'Category growing 45% nationally', potential: '$${randomInt(8, 15)}K/month' },
            { opportunity: 'Delivery service launch', evidence: 'SF delivery market growing 30%', potential: '$${randomInt(25, 50)}K/month within 6 months' },
          ],
          threatsAnalysis: [
            { threat: 'New MSO competition in SF', likelihood: 'High', impact: 'Margin and share pressure', mitigation: 'Accelerate loyalty program' },
            { threat: 'Potential cannabis tax increases', likelihood: 'Medium', impact: '2-4% effective tax rate increase', mitigation: 'Industry advocacy engagement' },
          ],
          salesTrends: [
            { metric: 'Net Sales', trend: 'Upward', change: `+${d1(random(5, 14))}% YoY`, detail: 'Growth from acquisition and AOV' },
            { metric: 'Gross Margin', trend: 'Stable', change: `${d1(random(-1, 2))}%`, detail: 'Holding despite mix shift' },
            { metric: 'Tickets/Day', trend: 'Upward', change: `+${d1(random(3, 8))}% MoM`, detail: 'Marketing-driven traffic' },
          ],
          customerTrends: [
            { metric: 'New Registrations', trend: 'Stable', change: `${randomInt(300, 500)} this month`, detail: 'Organic + referral channels' },
            { metric: 'VIP Growth', trend: 'Upward', change: `+${randomInt(12, 28)} VIPs`, detail: 'Loyalty program upgrades' },
          ],
          brandTrends: [
            { brand: 'Pacific Bloom', trend: 'Growing', shareChange: `+${d1(random(0.5, 2.0))}%`, detail: 'New drops driving trial' },
            { brand: 'Golden State Greens', trend: 'Stable', shareChange: `${d1(random(-0.5, 0.5))}%`, detail: 'Consistent performer' },
          ],
          marketTrends: [
            { trend: 'Premium demand increasing', evidence: 'Avg price up 8% YoY', implication: 'Supports margin expansion' },
            { trend: 'Digital-first shopping', evidence: '65% check online menu first', implication: 'Digital investment critical' },
          ],
          strategicPriorities: [
            { priority: 'Strengthen retention and loyalty', timeline: 'Q1-Q2 2026', owner: 'Operations', kpis: ['VIP +15%', '30-day return 50%'] },
            { priority: 'Optimize product mix for margins', timeline: 'Q1 2026', owner: 'Purchasing', kpis: ['Gross margin 55%', 'Aged inventory -30%'] },
          ],
          quarterlyGoals: [
            { goal: `$${randomInt(1200, 1600)}K quarterly net sales`, status: 'On Track', progress: randomInt(60, 95) },
            { goal: '52%+ gross margin', status: randomInt(0, 1) ? 'On Track' : 'At Risk', progress: randomInt(45, 85) },
          ],
          resourceAllocations: [
            { resource: 'Marketing', allocation: `$${randomInt(8, 15)}K/month`, recommendation: 'Shift 20% print to digital' },
          ],
          riskMitigations: [
            { risk: 'Supply chain disruption', probability: 'Low', impact: 'High', mitigation: '30-day safety stock on top 50 SKUs' },
          ],
          competitiveLandscape: { summary: 'SF market increasingly competitive', keyCompetitors: ['Green Cross SF', 'SPARC', 'The Apothecarium'], competitiveAdvantage: 'Community relationships + data-driven ops', marketPosition: 'Top-tier independent' },
          marketPositioning: { currentPosition: 'Premium independent retailer', targetPosition: 'Smartest dispensary in SF', differentiators: ['AI intelligence', 'Best budtenders', 'Local brand curation'] },
          regulatoryOutlook: { summary: 'Stable with incremental updates', upcomingChanges: ['Packaging update Q2', 'Track-and-trace upgrade'], complianceStatus: 'Fully compliant' },
          revenueProjections: [
            { period: 'Q2 2026', projected: randomInt(420, 520), basis: '4/20 seasonal uplift', confidence: 'High' },
            { period: 'Q3 2026', projected: randomInt(440, 540), basis: 'Growth + delivery launch', confidence: 'Medium' },
          ],
          growthOpportunities: [
            { opportunity: 'Delivery service', estimatedRevenue: `$${randomInt(25, 50)}K/mo by month 6`, investmentRequired: `$${randomInt(30, 60)}K`, timeline: 'Q2 2026' },
          ],
          riskFactors: [
            { factor: 'Competition intensifying', severity: 'Medium', trend: 'Increasing', mitigation: 'Loyalty and differentiation' },
          ],
          keyQuestionsNext: [
            { question: 'Accelerate delivery launch given competitive pressure?', priority: 'High', context: '2 competitors launched delivery recently' },
            { question: 'Optimal store count for SF market?', priority: 'Medium', context: 'Third location study underway' },
          ],
          dataHealthScore: d2(clamp(random(0.82, 0.95), 0.8, 1.0)),
          confidenceScore: d2(clamp(random(0.78, 0.92), 0.75, 0.95)),
          dailyDigestsIncluded: randomInt(22, 30),
        },
      });

      // Create linked MonthlyAnalysisJob
      const startedAt = new Date(new Date(year, month + 1, 1).getTime() - randomInt(3600, 7200) * 1000);
      const completedAt = new Date(startedAt.getTime() + randomInt(600, 1800) * 1000);
      await prisma.monthlyAnalysisJob.create({
        data: {
          monthYear: label,
          startedAt,
          completedAt,
          status: 'completed',
          currentPhase: 'completed',
          inputTokens: randomInt(120000, 200000),
          outputTokens: randomInt(25000, 45000),
          estimatedCost: d4(random(1.5, 4.5)),
          reportId: report.id,
        },
      });
      console.log(`  ${label}: ${grade}`);
    }
    console.log(`  Created 6 monthly strategic reports\n`);
  } else {
    console.log(`Monthly reports: ${monthlyCount} (skipping)\n`);
  }

  console.log('=== Seed continuation complete ===');
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
