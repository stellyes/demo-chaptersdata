/**
 * seed-demo.ts
 *
 * Comprehensive demo data seed script for demo.chaptersdata.com
 * Generates 10 years of realistic cannabis retail data.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-demo.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Seeded PRNG (Mulberry32) ────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42_420_2016);

/** Returns a seeded random number in [min, max) */
function random(min: number, max: number): number {
  return min + rand() * (max - min);
}

/** Returns a seeded random integer in [min, max] */
function randomInt(min: number, max: number): number {
  return Math.floor(random(min, max + 1));
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** Gaussian-ish random via Box-Muller (seeded) */
function gaussRandom(mean: number, stddev: number): number {
  const u1 = rand();
  const u2 = rand();
  const z = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stddev;
}

/** Clamp a number to [min, max] */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Format a number to 2 decimal places */
function d2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format a number to 3 decimal places */
function d3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Format a number to 4 decimal places */
function d4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = 'demo-org-001';
const START_DATE = new Date('2016-01-01');
const END_DATE = new Date('2026-03-25');

const STORES = [
  {
    storefrontId: 'greenleaf',
    name: 'Greenleaf Market',
    storeName: 'Greenleaf Market - Downtown',
    address: '420 Market Street',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94102',
    phone: '(415) 555-0142',
    scaleFactor: 1.0,
  },
  {
    storefrontId: 'emerald',
    name: 'Emerald Collective',
    storeName: 'Emerald Collective - Midtown',
    address: '710 Valencia Street',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94110',
    phone: '(415) 555-0187',
    scaleFactor: 0.75,
  },
];

const BRAND_NAMES = [
  'Pacific Bloom',
  'Golden State Greens',
  'Bay Area Botanicals',
  'Sunset Valley Farms',
  'Redwood Reserve',
  'Coastal Harvest',
  'Sierra Gold',
  'Mission District Meds',
  'NorCal Naturals',
  'Fog City Flower',
  'Emerald Triangle OG',
  'Humboldt Heritage',
  'Cali Craft Cannabis',
  'Ocean Beach Organics',
  'Presidio Premium',
  'Haight Street Herbals',
  'Castro Cultivars',
  'Nob Hill Nugs',
  'Tenderloin Terpenes',
  'SoMa Solventless',
  'Potrero Puffs',
  'Dogpatch Dabs',
  'Fillmore Flower Co',
  'Twin Peaks Terps',
  'Marina Mints',
  'Excelsior Extracts',
  'Richmond Roots',
  'Bayview Buds',
  'Parkside Provisions',
  'Outer Lands Labs',
];

const VENDOR_NAMES = [
  'Pacific Coast Distribution',
  'Golden Gate Supply Co',
  'NorCal Cannabis Wholesale',
  'Bay Bridge Distribution',
  'Emerald Valley Trading',
  'Sierra Cannabis Partners',
  'Coastal Range Distributors',
  'Mission Creek Supply',
  'Redwood Distribution Group',
  'Sunset Supply Chain',
];

const PRODUCT_TYPES = [
  'Flower',
  'Pre-Roll',
  'Vape',
  'Edible',
  'Concentrate',
  'Tincture',
  'Topical',
  'Accessory',
  'Beverage',
];

// Product type weights (share of sales) and margin profiles
const PRODUCT_PROFILES: Record<
  string,
  { shareWeight: number; marginRange: [number, number]; avgCostRange: [number, number] }
> = {
  Flower: { shareWeight: 0.32, marginRange: [0.4, 0.55], avgCostRange: [8, 18] },
  'Pre-Roll': { shareWeight: 0.15, marginRange: [0.45, 0.6], avgCostRange: [4, 10] },
  Vape: { shareWeight: 0.2, marginRange: [0.42, 0.58], avgCostRange: [12, 28] },
  Edible: { shareWeight: 0.12, marginRange: [0.5, 0.65], avgCostRange: [5, 15] },
  Concentrate: { shareWeight: 0.1, marginRange: [0.38, 0.52], avgCostRange: [15, 35] },
  Tincture: { shareWeight: 0.05, marginRange: [0.55, 0.68], avgCostRange: [8, 22] },
  Topical: { shareWeight: 0.03, marginRange: [0.58, 0.72], avgCostRange: [6, 18] },
  Accessory: { shareWeight: 0.03, marginRange: [0.6, 0.75], avgCostRange: [3, 12] },
  Beverage: { shareWeight: 0.02, marginRange: [0.48, 0.62], avgCostRange: [4, 10] },
};

const EMPLOYEE_NAMES = [
  'Jordan Rivera',
  'Casey Chen',
  'Morgan Williams',
  'Riley Patel',
  'Avery Jackson',
  'Taylor Nguyen',
  'Jamie Lopez',
  'Sam Washington',
  'Alex Kim',
  'Dakota Brown',
  'Quinn Martinez',
  'Skyler Davis',
  'Reese Thompson',
  'Cameron Lee',
  'Drew Garcia',
];

const FIRST_NAMES = [
  'James', 'Mary', 'Michael', 'Patricia', 'Robert', 'Jennifer', 'David', 'Linda',
  'William', 'Elizabeth', 'Richard', 'Barbara', 'Joseph', 'Susan', 'Thomas', 'Jessica',
  'Christopher', 'Sarah', 'Daniel', 'Karen', 'Matthew', 'Lisa', 'Anthony', 'Nancy',
  'Mark', 'Betty', 'Donald', 'Margaret', 'Steven', 'Sandra', 'Andrew', 'Ashley',
  'Paul', 'Dorothy', 'Joshua', 'Kimberly', 'Kenneth', 'Emily', 'Kevin', 'Donna',
  'Brian', 'Michelle', 'George', 'Carol', 'Timothy', 'Amanda', 'Ronald', 'Melissa',
  'Jason', 'Deborah', 'Ryan', 'Stephanie', 'Jacob', 'Rebecca', 'Gary', 'Sharon',
  'Nicholas', 'Laura', 'Eric', 'Cynthia', 'Jonathan', 'Kathleen', 'Stephen', 'Amy',
  'Larry', 'Angela', 'Justin', 'Shirley', 'Scott', 'Brenda', 'Brandon', 'Emma',
  'Benjamin', 'Anna', 'Samuel', 'Pamela', 'Raymond', 'Nicole', 'Gregory', 'Samantha',
  'Frank', 'Katherine', 'Alexander', 'Christine', 'Patrick', 'Helen', 'Jack', 'Debra',
  'Dennis', 'Rachel', 'Jerry', 'Carolyn', 'Tyler', 'Janet', 'Aaron', 'Maria',
  'Jose', 'Catherine', 'Nathan', 'Heather', 'Henry', 'Diane',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
  'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
  'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
  'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
  'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers',
  'Long', 'Ross', 'Foster', 'Jimenez',
];

const CUSTOMER_SEGMENTS = ['VIP', 'Regular', 'Occasional', 'New', 'At-Risk', 'Lapsed'];
const RECENCY_SEGMENTS = ['Active', 'Recent', 'Lapsing', 'At-Risk', 'Lost'];

// ─── Helper: date iteration ─────────────────────────────────────────────────

function* dateRange(start: Date, end: Date): Generator<Date> {
  const d = new Date(start);
  while (d <= end) {
    yield new Date(d);
    d.setDate(d.getDate() + 1);
  }
}

function* monthRange(start: Date, end: Date): Generator<{ year: number; month: number }> {
  let y = start.getFullYear();
  let m = start.getMonth();
  const ey = end.getFullYear();
  const em = end.getMonth();
  while (y < ey || (y === ey && m <= em)) {
    yield { year: y, month: m };
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

function monthStart(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function dayOfWeek(d: Date): number {
  return d.getDay();
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Growth & Seasonality Model ──────────────────────────────────────────────

/**
 * Annual growth: 8% compounding from 2016 base
 * Seasonality multiplier by month (1-indexed):
 *   Jan: 0.85, Feb: 0.88, Mar: 0.95, Apr: 1.25 (4/20!)
 *   May: 1.05, Jun: 1.08, Jul: 1.10, Aug: 1.06
 *   Sep: 0.95, Oct: 1.00, Nov: 1.02, Dec: 1.12 (holidays)
 */
const SEASONALITY: Record<number, number> = {
  0: 0.85, // Jan
  1: 0.88, // Feb
  2: 0.95, // Mar
  3: 1.25, // Apr — 4/20 boost
  4: 1.05, // May
  5: 1.08, // Jun
  6: 1.1, // Jul
  7: 1.06, // Aug
  8: 0.95, // Sep
  9: 1.0, // Oct
  10: 1.02, // Nov
  11: 1.12, // Dec — holiday boost
};

function growthMultiplier(date: Date): number {
  const yearsFromBase = (date.getTime() - START_DATE.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.pow(1.08, yearsFromBase);
}

function seasonalMultiplier(date: Date): number {
  const m = date.getMonth();
  let base = SEASONALITY[m];

  // Extra 4/20 boost for April 15-20
  const day = date.getDate();
  if (m === 3 && day >= 15 && day <= 20) {
    base *= 1.0 + (day === 20 ? 0.6 : day >= 18 ? 0.3 : 0.15);
  }

  // Black Friday / Cyber Monday area (late November)
  if (m === 10 && day >= 25) {
    base *= 1.15;
  }

  // Christmas week
  if (m === 11 && day >= 20 && day <= 26) {
    base *= 1.18;
  }

  // New Year's Eve
  if (m === 11 && day === 31) {
    base *= 1.25;
  }

  return base;
}

function weekendMultiplier(date: Date): number {
  const dow = dayOfWeek(date);
  if (dow === 5) return 1.2; // Friday
  if (dow === 6) return 1.2; // Saturday
  if (dow === 0) return 1.1; // Sunday
  return 1.0;
}

// ─── Data Generation ─────────────────────────────────────────────────────────

async function seedOrganization() {
  console.log('\n--- Seeding Organization ---');
  const org = await prisma.organization.upsert({
    where: { orgId: ORG_ID },
    update: { name: 'Demo Retail Group', type: 'dispensary', status: 'active' },
    create: {
      orgId: ORG_ID,
      name: 'Demo Retail Group',
      type: 'dispensary',
      status: 'active',
      location: 'San Francisco, CA',
      monthlyBilling: 0,
    },
  });
  console.log(`  Organization: ${org.name} (${org.orgId})`);
  return org;
}

async function seedStorefronts(orgDbId: string) {
  console.log('\n--- Seeding Storefronts ---');
  const storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }> =
    {};

  for (const s of STORES) {
    const sf = await prisma.storefront.upsert({
      where: { storefrontId: s.storefrontId },
      update: {
        name: s.name,
        type: 'dispensary',
        status: 'active',
        location: `${s.city}, ${s.state}`,
        address: s.address,
        city: s.city,
        state: s.state,
        zipCode: s.zipCode,
        phone: s.phone,
      },
      create: {
        storefrontId: s.storefrontId,
        orgId: orgDbId,
        name: s.name,
        type: 'dispensary',
        status: 'active',
        location: `${s.city}, ${s.state}`,
        address: s.address,
        city: s.city,
        state: s.state,
        zipCode: s.zipCode,
        phone: s.phone,
      },
    });
    storefronts[s.storefrontId] = {
      dbId: sf.id,
      storefrontId: s.storefrontId,
      storeName: s.storeName,
      scaleFactor: s.scaleFactor,
    };
    console.log(`  Storefront: ${sf.name} (${sf.storefrontId})`);
  }
  return storefronts;
}

async function seedBrands() {
  console.log('\n--- Seeding Canonical Brands ---');
  const brandMap: Record<string, string> = {};

  for (const name of BRAND_NAMES) {
    const brand = await prisma.canonicalBrand.upsert({
      where: { canonicalName: name },
      update: {},
      create: { canonicalName: name },
    });
    brandMap[name] = brand.id;
  }
  console.log(`  Created ${BRAND_NAMES.length} canonical brands`);
  return brandMap;
}

async function seedVendors() {
  console.log('\n--- Seeding Vendors ---');
  const vendorMap: Record<string, string> = {};

  for (const name of VENDOR_NAMES) {
    const vendor = await prisma.vendor.upsert({
      where: { canonicalName: name },
      update: {},
      create: { canonicalName: name },
    });
    vendorMap[name] = vendor.id;
  }
  console.log(`  Created ${VENDOR_NAMES.length} vendors`);
  return vendorMap;
}

async function seedSalesRecords(
  storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }>
) {
  console.log('\n--- Seeding Sales Records ---');

  // Base daily metrics for the "large" store in early 2016
  const BASE_GROSS = 4800; // ~$4,800/day gross in Jan 2016
  const BASE_TICKETS = 85;
  const BASE_UNITS = 210;
  const BASE_CUSTOMERS = 72;

  let totalRecords = 0;
  const batchSize = 500;

  for (const store of Object.values(storefronts)) {
    let batch: Parameters<typeof prisma.salesRecord.create>[0]['data'][] = [];
    let storeRecords = 0;

    for (const date of dateRange(START_DATE, END_DATE)) {
      const growth = growthMultiplier(date);
      const season = seasonalMultiplier(date);
      const weekend = weekendMultiplier(date);
      const noise = 1.0 + gaussRandom(0, 0.08); // +/- 8% daily noise
      const combined = clamp(growth * season * weekend * noise * store.scaleFactor, 0.3, 5.0);

      const grossSales = d2(BASE_GROSS * combined);
      const discountPct = d3(clamp(random(0.03, 0.12), 0.03, 0.12));
      const discounts = d2(grossSales * discountPct);
      const returnPct = d3(clamp(random(0.005, 0.03), 0.005, 0.03));
      const returns = d2(grossSales * returnPct);
      const netSales = d2(grossSales - discounts - returns);
      const taxRate = clamp(random(0.25, 0.35), 0.25, 0.35);
      const taxes = d2(netSales * taxRate);
      const grossReceipts = d2(netSales + taxes);
      const grossMarginPct = d3(clamp(random(0.45, 0.65), 0.45, 0.65));
      const cogsWithExcise = d2(netSales * (1 - grossMarginPct));
      const grossIncome = d2(netSales - cogsWithExcise);
      const costPct = d3(1 - grossMarginPct);

      const tickets = Math.max(10, Math.round(BASE_TICKETS * combined + gaussRandom(0, 5)));
      const units = Math.max(15, Math.round(BASE_UNITS * combined + gaussRandom(0, 10)));
      const customers = Math.max(8, Math.round(BASE_CUSTOMERS * combined + gaussRandom(0, 4)));
      const newCustomers = Math.max(0, Math.round(customers * clamp(random(0.05, 0.2), 0.05, 0.2)));

      const avgBasketSize = d2(units / tickets);
      const avgOrderValue = d2(netSales / tickets);
      const avgOrderProfit = d2(grossIncome / tickets);

      // Week label: "YYYY-Www"
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
      const week = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

      batch.push({
        storefrontId: store.dbId,
        storeId: store.storefrontId,
        storeName: store.storeName,
        date,
        week,
        ticketsCount: tickets,
        unitsSold: units,
        customersCount: customers,
        newCustomers,
        grossSales,
        discounts,
        returns,
        netSales,
        taxes,
        grossReceipts,
        cogsWithExcise,
        grossIncome,
        grossMarginPct,
        discountPct,
        costPct,
        avgBasketSize,
        avgOrderValue,
        avgOrderProfit,
      });

      if (batch.length >= batchSize) {
        await upsertSalesRecordBatch(batch);
        storeRecords += batch.length;
        batch = [];
        if (storeRecords % 1000 === 0) {
          process.stdout.write(`  ${store.storefrontId}: ${storeRecords} records...\r`);
        }
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await upsertSalesRecordBatch(batch);
      storeRecords += batch.length;
    }

    totalRecords += storeRecords;
    console.log(`  ${store.storefrontId}: ${storeRecords} sales records`);
  }

  console.log(`  Total sales records: ${totalRecords}`);
  return totalRecords;
}

async function upsertSalesRecordBatch(
  batch: Parameters<typeof prisma.salesRecord.create>[0]['data'][]
) {
  for (const rec of batch) {
    await prisma.salesRecord.upsert({
      where: {
        storeId_date: {
          storeId: rec.storeId as string,
          date: rec.date as Date,
        },
      },
      update: {
        ...rec,
      },
      create: {
        ...rec,
      },
    });
  }
}

async function seedBrandRecords(
  storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }>,
  brandMap: Record<string, string>
) {
  console.log('\n--- Seeding Brand Records ---');

  let totalRecords = 0;
  const brandNames = Object.keys(brandMap);

  // Assign each brand a relative weight (persistent across months)
  const brandWeights: Record<string, number> = {};
  let totalWeight = 0;
  for (const name of brandNames) {
    const w = random(0.5, 5.0);
    brandWeights[name] = w;
    totalWeight += w;
  }

  for (const store of Object.values(storefronts)) {
    let storeRecords = 0;

    for (const { year, month } of monthRange(START_DATE, END_DATE)) {
      const mStart = monthStart(year, month);
      const mEnd = monthEnd(year, month);

      // Total net sales for the month (rough estimate from daily base)
      const daysInMonth = mEnd.getDate();
      const midMonth = new Date(year, month, 15);
      const monthGrowth = growthMultiplier(midMonth);
      const monthSeason = seasonalMultiplier(midMonth);
      const monthNetSales = 4800 * 0.88 * monthGrowth * monthSeason * store.scaleFactor * daysInMonth;

      for (const brandName of brandNames) {
        const share = (brandWeights[brandName] / totalWeight) * clamp(1.0 + gaussRandom(0, 0.15), 0.5, 2.0);
        const brandNetSales = d2(monthNetSales * share * random(0.6, 1.4) * 0.03);
        const pctOfTotal = d4(clamp(share / totalWeight, 0.001, 0.25));
        const marginPct = d3(clamp(random(0.35, 0.65), 0.35, 0.65));
        const avgCost = d2(random(5, 25));

        await prisma.brandRecord.create({
          data: {
            storefrontId: store.dbId,
            storeId: store.storefrontId,
            storeName: store.storeName,
            brandId: brandMap[brandName],
            originalBrandName: brandName,
            pctOfTotalNetSales: pctOfTotal,
            grossMarginPct: marginPct,
            avgCostWoExcise: avgCost,
            netSales: brandNetSales,
            uploadStartDate: mStart,
            uploadEndDate: mEnd,
          },
        });
        storeRecords++;
      }

      if (storeRecords % 500 === 0) {
        process.stdout.write(`  ${store.storefrontId}: ${storeRecords} brand records...\r`);
      }
    }

    totalRecords += storeRecords;
    console.log(`  ${store.storefrontId}: ${storeRecords} brand records`);
  }

  console.log(`  Total brand records: ${totalRecords}`);
}

async function seedProductRecords(
  storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }>
) {
  console.log('\n--- Seeding Product Records ---');

  let totalRecords = 0;

  for (const store of Object.values(storefronts)) {
    let storeRecords = 0;

    for (const { year, month } of monthRange(START_DATE, END_DATE)) {
      const mStart = monthStart(year, month);
      const mEnd = monthEnd(year, month);

      const daysInMonth = mEnd.getDate();
      const midMonth = new Date(year, month, 15);
      const monthGrowth = growthMultiplier(midMonth);
      const monthSeason = seasonalMultiplier(midMonth);
      const monthNetSales = 4800 * 0.88 * monthGrowth * monthSeason * store.scaleFactor * daysInMonth;

      // Normalize shares
      let totalShareWeight = 0;
      for (const pt of PRODUCT_TYPES) {
        totalShareWeight += PRODUCT_PROFILES[pt].shareWeight;
      }

      for (const productType of PRODUCT_TYPES) {
        const profile = PRODUCT_PROFILES[productType];
        const share = (profile.shareWeight / totalShareWeight) * clamp(1.0 + gaussRandom(0, 0.1), 0.7, 1.3);
        const productNetSales = d2(monthNetSales * share);
        const pctOfTotal = d4(clamp(share, 0.005, 0.5));
        const marginPct = d3(clamp(random(profile.marginRange[0], profile.marginRange[1]), 0.3, 0.8));
        const avgCost = d2(random(profile.avgCostRange[0], profile.avgCostRange[1]));

        await prisma.productRecord.create({
          data: {
            storefrontId: store.dbId,
            storeId: store.storefrontId,
            storeName: store.storeName,
            productType,
            pctOfTotalNetSales: pctOfTotal,
            grossMarginPct: marginPct,
            avgCostWoExcise: avgCost,
            netSales: productNetSales,
            uploadStartDate: mStart,
            uploadEndDate: mEnd,
          },
        });
        storeRecords++;
      }

      if (storeRecords % 200 === 0) {
        process.stdout.write(`  ${store.storefrontId}: ${storeRecords} product records...\r`);
      }
    }

    totalRecords += storeRecords;
    console.log(`  ${store.storefrontId}: ${storeRecords} product records`);
  }

  console.log(`  Total product records: ${totalRecords}`);
}

async function seedBudtenderRecords(
  storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }>
) {
  console.log('\n--- Seeding Budtender Records ---');

  // Last 2 years of daily data
  const budtenderStart = new Date('2024-03-26');
  const budtenderEnd = END_DATE;

  let totalRecords = 0;

  for (const store of Object.values(storefronts)) {
    let storeRecords = 0;

    // Assign employees with varying skill levels
    const employeeSkills: Record<string, { salesMultiplier: number; marginBonus: number }> = {};
    for (const emp of EMPLOYEE_NAMES) {
      employeeSkills[emp] = {
        salesMultiplier: clamp(gaussRandom(1.0, 0.25), 0.5, 1.8),
        marginBonus: gaussRandom(0, 0.03),
      };
    }

    for (const date of dateRange(budtenderStart, budtenderEnd)) {
      const growth = growthMultiplier(date);
      const season = seasonalMultiplier(date);
      const weekend = weekendMultiplier(date);

      // On any given day, ~8-12 employees are working
      const workingCount = randomInt(8, 12);
      const shuffled = [...EMPLOYEE_NAMES].sort(() => rand() - 0.5);
      const workingToday = shuffled.slice(0, workingCount);

      // Divide the day's sales among working employees
      const storeDayBase = 4800 * growth * season * weekend * store.scaleFactor * 0.88;
      let remainingSales = storeDayBase;

      for (let i = 0; i < workingToday.length; i++) {
        const emp = workingToday[i];
        const skill = employeeSkills[emp];
        const isLast = i === workingToday.length - 1;

        // Each employee gets a weighted share
        const shareBase = (1.0 / workingToday.length) * skill.salesMultiplier;
        const empSales = isLast
          ? Math.max(0, remainingSales)
          : d2(storeDayBase * shareBase * clamp(1.0 + gaussRandom(0, 0.15), 0.5, 2.0));
        remainingSales -= empSales;

        const tickets = Math.max(1, Math.round(empSales / random(45, 80)));
        const customers = Math.max(1, Math.round(tickets * random(0.7, 0.95)));
        const units = Math.max(1, Math.round(tickets * random(2.0, 3.5)));
        const marginPct = d3(clamp(random(0.45, 0.6) + skill.marginBonus, 0.35, 0.72));
        const aov = d2(tickets > 0 ? empSales / tickets : 0);

        await prisma.budtenderRecord.create({
          data: {
            storefrontId: store.dbId,
            storeId: store.storefrontId,
            storeName: store.storeName,
            employeeName: emp,
            date,
            ticketsCount: tickets,
            customersCount: customers,
            netSales: Math.max(0, d2(empSales)),
            grossMarginPct: marginPct,
            avgOrderValue: aov,
            unitsSold: units,
          },
        });
        storeRecords++;
      }

      if (storeRecords % 1000 === 0) {
        process.stdout.write(`  ${store.storefrontId}: ${storeRecords} budtender records...\r`);
      }
    }

    totalRecords += storeRecords;
    console.log(`  ${store.storefrontId}: ${storeRecords} budtender records`);
  }

  console.log(`  Total budtender records: ${totalRecords}`);
}

async function seedCustomers(
  storefronts: Record<string, { dbId: string; storefrontId: string; storeName: string; scaleFactor: number }>
) {
  console.log('\n--- Seeding Customers ---');

  let totalCustomers = 0;
  const CUSTOMERS_PER_STORE = 5000;

  for (const store of Object.values(storefronts)) {
    const batch: Parameters<typeof prisma.customer.create>[0]['data'][] = [];

    for (let i = 0; i < CUSTOMERS_PER_STORE; i++) {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const customerId = `CUST-${store.storefrontId.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(5, '0')}`;

      // Signup date spread across the full 10 years
      const signupOffset = Math.floor(rand() * daysBetween(START_DATE, END_DATE));
      const signupDate = new Date(START_DATE.getTime() + signupOffset * 86400000);

      // Last visit: weighted toward recent dates
      const maxDaysFromSignup = daysBetween(signupDate, END_DATE);
      const recencySkew = Math.pow(rand(), 0.5); // bias toward recent
      const lastVisitOffset = Math.floor(maxDaysFromSignup * recencySkew);
      const lastVisitDate = new Date(signupDate.getTime() + lastVisitOffset * 86400000);

      const daysSinceSignup = daysBetween(signupDate, END_DATE);
      const daysSinceLastVisit = daysBetween(lastVisitDate, END_DATE);

      // Lifetime metrics scale with tenure
      const tenureYears = daysSinceSignup / 365;
      const isActive = daysSinceLastVisit < 30;
      const isRecent = daysSinceLastVisit < 90;
      const isLapsing = daysSinceLastVisit >= 90 && daysSinceLastVisit < 180;

      const lifetimeVisits = Math.max(
        1,
        Math.round(clamp(gaussRandom(tenureYears * 12, tenureYears * 5), 1, tenureYears * 52))
      );
      const lifetimeTransactions = Math.max(1, Math.round(lifetimeVisits * random(0.8, 1.2)));
      const aov = d2(clamp(gaussRandom(62, 22), 15, 250));
      const lifetimeNetSales = d2(lifetimeTransactions * aov);

      // Age: 21-75 with peak around 30-35
      const age = Math.max(21, Math.min(75, Math.round(gaussRandom(33, 10))));
      const birthYear = END_DATE.getFullYear() - age;
      const dateOfBirth = new Date(birthYear, randomInt(0, 11), randomInt(1, 28));

      // Segments
      let customerSegment: string;
      if (lifetimeNetSales > 3000 && lifetimeVisits > 50) {
        customerSegment = 'VIP';
      } else if (lifetimeVisits > 20) {
        customerSegment = 'Regular';
      } else if (lifetimeVisits > 5) {
        customerSegment = 'Occasional';
      } else if (daysSinceSignup < 90) {
        customerSegment = 'New';
      } else if (daysSinceLastVisit > 180) {
        customerSegment = 'Lapsed';
      } else {
        customerSegment = 'At-Risk';
      }

      let recencySegment: string;
      if (isActive) {
        recencySegment = 'Active';
      } else if (isRecent) {
        recencySegment = 'Recent';
      } else if (isLapsing) {
        recencySegment = 'Lapsing';
      } else if (daysSinceLastVisit < 365) {
        recencySegment = 'At-Risk';
      } else {
        recencySegment = 'Lost';
      }

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

    // Bulk insert in chunks
    const chunkSize = 250;
    for (let c = 0; c < batch.length; c += chunkSize) {
      const chunk = batch.slice(c, c + chunkSize);
      await Promise.all(
        chunk.map((cust) =>
          prisma.customer.upsert({
            where: {
              storeName_customerId: {
                storeName: cust.storeName as string,
                customerId: cust.customerId as string,
              },
            },
            update: { ...cust },
            create: { ...cust },
          })
        )
      );
      process.stdout.write(`  ${store.storefrontId}: ${Math.min(c + chunkSize, batch.length)}/${CUSTOMERS_PER_STORE} customers...\r`);
    }

    totalCustomers += batch.length;
    console.log(`  ${store.storefrontId}: ${CUSTOMERS_PER_STORE} customers                    `);
  }

  console.log(`  Total customers: ${totalCustomers}`);
}

// ─── Daily Digest Templates ──────────────────────────────────────────────────

function generateDigestContent(digestDate: Date, index: number) {
  const dateStr = formatDate(digestDate);
  const month = digestDate.toLocaleString('en-US', { month: 'long' });
  const dayOfMonth = digestDate.getDate();
  const year = digestDate.getFullYear();
  const template = index % 3;

  const executiveSummaries = [
    `Yesterday's performance across both locations showed strong momentum heading into ${month}. Greenleaf Market posted $${randomInt(11, 15)}K in net sales (+${randomInt(3, 12)}% vs. last ${dayOfWeek(digestDate) === 1 ? 'Monday' : 'comparable day'}), while Emerald Collective delivered $${randomInt(8, 11)}K, outpacing its rolling 30-day average by ${randomInt(2, 8)}%. Combined ticket count reached ${randomInt(175, 260)}, with average order value climbing to $${randomInt(58, 78)}. Flower continues to dominate the mix at ${randomInt(28, 35)}% of net sales, but vape cartridges are showing the fastest growth trajectory, up ${randomInt(5, 18)}% month-over-month. Customer acquisition remains healthy with ${randomInt(22, 45)} new registrations across both stores, though retention among the 90-180 day cohort deserves attention as repeat visit rates have softened ${randomInt(2, 5)}% since the start of ${month}.`,

    `A solid day for Demo Retail Group with combined net sales of $${randomInt(18, 26)}K, representing a ${randomInt(4, 12)}% increase over the same day last year. Greenleaf Market continues to be the stronger performer, driven by its downtown foot traffic advantage and higher average basket size ($${randomInt(62, 82)} vs. Emerald's $${randomInt(52, 68)}). Pre-roll and edible categories showed notable strength, with pre-rolls up ${randomInt(8, 22)}% week-over-week — likely reflecting the seasonal shift and recent product drops from Pacific Bloom and Coastal Harvest. Discount utilization is running at ${d1(random(5.5, 8.5))}% of gross, within target range but worth monitoring as we approach ${month === 'April' ? '4/20 promotions' : month === 'December' ? 'holiday promotions' : 'the end of the quarter'}. Staff performance metrics highlight Jordan Rivera and Casey Chen as top performers with AOVs exceeding $${randomInt(70, 95)}.`,

    `Mixed signals in yesterday's data paint an interesting picture for ${month} ${year}. While top-line revenue met expectations at $${randomInt(19, 25)}K combined, the composition shifted: concentrate sales surged ${randomInt(12, 28)}% while flower pulled back ${randomInt(3, 8)}% — a trend worth tracking as it may signal evolving consumer preferences or competitive pricing pressure. Greenleaf's customer count of ${randomInt(95, 140)} outpaced Emerald's ${randomInt(70, 105)}, but Emerald's margin performance (${d1(random(52, 60))}% gross) edged out Greenleaf (${d1(random(48, 56))}%) thanks to a stronger tincture and topical mix. New brand Humboldt Heritage is performing well in its second week on shelves, already capturing ${d1(random(1.5, 4.2))}% of net sales. The at-risk customer segment grew by ${randomInt(5, 15)} accounts — consider triggering the re-engagement campaign for customers past 120 days without a visit.`,
  ];

  const allPriorityActions = [
    [
      { action: 'Review flower pricing strategy at Emerald Collective — margin compression detected for 3 consecutive weeks, down from 52% to 47%', timeframe: '48 hours', impact: 'Could recover $2K-4K monthly margin', category: 'pricing' },
      { action: 'Schedule vendor meeting with Pacific Coast Distribution to negotiate Q2 terms — current contract expires in 30 days', timeframe: '1 week', impact: 'Potential 3-5% cost reduction on top SKUs', category: 'purchasing' },
      { action: 'Launch win-back email campaign targeting 342 customers in the 90-180 day lapsed segment', timeframe: '72 hours', impact: 'Historical recovery rate of 18% = ~62 reactivated customers', category: 'customers' },
      { action: 'Restock Pacific Bloom flower SKUs at Greenleaf — inventory below 5-day supply on 3 top sellers', timeframe: '24 hours', impact: 'Prevent estimated $1.2K/day in lost sales', category: 'inventory' },
    ],
    [
      { action: 'Implement tiered discount strategy for slow-moving concentrate inventory — 47 SKUs have 30+ days on shelf', timeframe: '1 week', impact: 'Clear $18K in aged inventory while recovering 60%+ of cost', category: 'inventory' },
      { action: 'Cross-train 3 budtenders on premium upsell techniques — top performers average 22% higher AOV', timeframe: '2 weeks', impact: 'Potential $3-5K additional monthly revenue if AOV lifts $5 average', category: 'staff' },
      { action: 'Review and update loyalty program tier thresholds — current VIP threshold too low, diluting perceived exclusivity', timeframe: '1 week', impact: 'Better segmentation drives more targeted promotions', category: 'customers' },
      { action: 'Negotiate exclusive product drop with Golden State Greens for Greenleaf Market — competitor just lost their exclusivity', timeframe: '72 hours', impact: 'Exclusive products drive 35% higher margins and foot traffic', category: 'purchasing' },
    ],
    [
      { action: 'Audit discount authorization workflow — Emerald showing 11.2% discount rate vs 6.8% target, possible unauthorized discounting', timeframe: '48 hours', impact: 'Closing the gap saves ~$2.8K monthly in unnecessary discounts', category: 'operations' },
      { action: 'Optimize budtender scheduling based on hourly traffic patterns — current schedule misaligns peak hours at Greenleaf', timeframe: '1 week', impact: 'Better coverage during 4-7pm peak could capture $800/week in additional sales', category: 'staff' },
      { action: 'Set up automated reorder alerts for top 20 SKUs by velocity — manual tracking missed 2 stockouts this month', timeframe: '72 hours', impact: 'Preventing stockouts on top SKUs worth estimated $500/day each', category: 'inventory' },
      { action: 'Submit updated product menu to Weedmaps and Leafly — last update was 23 days ago, listings showing unavailable items', timeframe: '24 hours', impact: 'Stale menus reduce online-to-store conversion by estimated 15-20%', category: 'marketing' },
    ],
  ];

  const allQuickWins = [
    [
      { action: 'Move pre-roll display to checkout counter at Emerald — Greenleaf saw 14% uplift when they did this last quarter', effort: '1 hour', impact: 'Estimated $200-400/week in impulse purchases' },
      { action: 'Text blast to VIP customers about new Pacific Bloom drop — 89% open rate on last similar campaign', effort: '30 minutes', impact: '15-25 additional transactions within 48 hours' },
      { action: 'Adjust Greenleaf closing inventory count schedule from daily to twice daily — catching discrepancies faster', effort: '15 minutes process change', impact: 'Reduce shrinkage by estimated 0.3%' },
    ],
    [
      { action: 'Bundle slow-moving Outer Lands Labs tinctures with fast-moving flower — creates perceived value', effort: '30 minutes to create bundle', impact: 'Move 40+ units this week at better combined margin' },
      { action: 'Update digital menu board at Emerald with seasonal recommendations — currently showing summer messaging', effort: '1 hour', impact: 'Seasonal relevance drives 8-12% category lift historically' },
      { action: 'Share top-performer Jordan Rivera sales approach with team via 15-minute standup', effort: '15 minutes', impact: 'Team learning from $95 AOV performer vs $62 average' },
    ],
    [
      { action: 'Enable SMS opt-in at point of sale — currently only collecting email, missing 40% of customers', effort: '20 minutes POS config', impact: 'SMS campaigns see 3x engagement vs email in our data' },
      { action: 'Rotate featured shelf display at Greenleaf — current display unchanged for 18 days', effort: '45 minutes', impact: 'Fresh displays historically drive 10-15% category sales lift' },
      { action: 'Run a flash 10% discount on accessories at Emerald to clear seasonal inventory before month end', effort: '10 minutes POS setup', impact: 'Clear $1.2K in slow inventory, make room for new products' },
    ],
  ];

  const allWatchItems = [
    [
      { item: 'Emerald Collective weekday traffic down 7% month-over-month', reason: 'New competitor opened 3 blocks away — need to monitor if this is temporary or a sustained shift', monitorUntil: formatDate(new Date(digestDate.getTime() + 30 * 86400000)) },
      { item: 'Vape cartridge return rate spiked to 4.2% from 1.8% baseline', reason: 'Concentrated in Fog City Flower brand — possible product quality issue or batch problem', monitorUntil: formatDate(new Date(digestDate.getTime() + 14 * 86400000)) },
      { item: 'Average basket size declining at Greenleaf for 3rd consecutive week', reason: 'May be correlated with new customer mix — newer customers typically have smaller baskets', monitorUntil: formatDate(new Date(digestDate.getTime() + 21 * 86400000)) },
    ],
    [
      { item: 'Concentrate category margin compression — down 3.2 points over 6 weeks', reason: 'Wholesale cost increases from Sierra Cannabis Partners not yet passed through to retail pricing', monitorUntil: formatDate(new Date(digestDate.getTime() + 14 * 86400000)) },
      { item: 'Sunday traffic at both locations trending below Friday/Saturday more than usual', reason: 'Possible new Sunday hours at nearby competitors or shifting consumer habits', monitorUntil: formatDate(new Date(digestDate.getTime() + 28 * 86400000)) },
      { item: 'Greenleaf new customer acquisition rate slowing — 18% below 90-day average', reason: 'Marketing spend unchanged, may indicate market saturation in downtown corridor', monitorUntil: formatDate(new Date(digestDate.getTime() + 21 * 86400000)) },
    ],
    [
      { item: 'Staff overtime hours up 22% at Emerald Collective this month', reason: 'Two employees out sick last week — need to ensure this normalizes and is not a scheduling inefficiency', monitorUntil: formatDate(new Date(digestDate.getTime() + 14 * 86400000)) },
      { item: 'Edible category showing 15% sales increase but margin flat', reason: 'Promotional pricing driving volume without profit — evaluate if volume creates customer lifetime value', monitorUntil: formatDate(new Date(digestDate.getTime() + 30 * 86400000)) },
      { item: 'Top brand Pacific Bloom share declined from 8.3% to 6.1% over 2 months', reason: 'New competitor brands taking share — Pacific Bloom may need shelf placement refresh or promotional support', monitorUntil: formatDate(new Date(digestDate.getTime() + 21 * 86400000)) },
    ],
  ];

  const allIndustryHighlights = [
    [
      { headline: 'California cannabis tax revenue hits record quarterly high', source: 'California Department of Tax and Fee Administration', relevance: 'Market growth validates expansion strategy; rising tide lifting all boats in SF', actionItem: 'Review whether tax rate changes affect our pricing competitiveness' },
      { headline: 'Major MSO announces SF market entry with 3 planned dispensary locations', source: 'Cannabis Business Times', relevance: 'Increased competition expected in downtown and SOMA corridors within 6-9 months', actionItem: 'Accelerate customer loyalty program enhancements before new competition arrives' },
      { headline: 'Consumer preference shifting toward premium flower and solventless concentrates', source: 'Headset Cannabis Market Report', relevance: 'Aligns with our observed concentrate category growth and margin potential' },
    ],
    [
      { headline: 'San Francisco Board of Supervisors considering cannabis delivery licensing reform', source: 'SF Chronicle', relevance: 'Expanded delivery licenses could increase competition but also open new revenue channel', actionItem: 'Begin evaluating delivery infrastructure costs and potential ROI' },
      { headline: 'National study shows cannabis consumers increasingly purchasing based on terpene profiles', source: 'Journal of Cannabis Research', relevance: 'Opportunity to differentiate through budtender education and terpene-focused merchandising', actionItem: 'Update product information cards with terpene profiles for top 20 flower SKUs' },
      { headline: 'Wholesale cannabis prices stabilizing after 18-month decline', source: 'Cannabis Benchmarks', relevance: 'Cost pressures easing — margins should improve if retail pricing holds steady' },
    ],
    [
      { headline: 'New study links dispensary experience quality to customer retention rates', source: 'MJBizDaily', relevance: 'Reinforces our investment in budtender training and store experience — data shows 40% higher retention at stores with trained staff', actionItem: 'Quantify our training ROI using budtender performance data' },
      { headline: 'California regulators announce simplified compliance reporting for small retailers', source: 'Bureau of Cannabis Control', relevance: 'Administrative burden reduction could save 5-10 hours/week in compliance tasks', actionItem: 'Review new guidelines and update compliance workflows' },
      { headline: 'Cannabis beverage category growing 45% year-over-year nationally', source: 'BDSA Market Intelligence', relevance: 'Emerging category we currently understock — potential whitespace opportunity' },
    ],
  ];

  const allRegulatoryUpdates = [
    [
      { update: 'San Francisco DPH releasing updated ventilation requirements for cannabis retail by Q2', source: 'SF Department of Public Health', impactLevel: 'medium' as const, deadline: formatDate(new Date(digestDate.getTime() + 90 * 86400000)) },
      { update: 'California excise tax collection method changing from distributor to point-of-sale', source: 'CDTFA Advisory', impactLevel: 'high' as const, deadline: formatDate(new Date(digestDate.getTime() + 180 * 86400000)) },
    ],
    [
      { update: 'New packaging and labeling requirements for cannabis edibles effective next quarter', source: 'California DCC', impactLevel: 'medium' as const, deadline: formatDate(new Date(digestDate.getTime() + 60 * 86400000)) },
      { update: 'Updated employee training certification requirements for dispensary staff', source: 'Bureau of Cannabis Control', impactLevel: 'low' as const },
    ],
    [
      { update: 'City of SF considering additional cannabis business tax on gross receipts above $5M', source: 'SF Office of the Treasurer', impactLevel: 'high' as const, deadline: formatDate(new Date(digestDate.getTime() + 120 * 86400000)) },
      { update: 'New track-and-trace integration requirements with METRC system updates', source: 'California DCC', impactLevel: 'medium' as const, deadline: formatDate(new Date(digestDate.getTime() + 45 * 86400000)) },
    ],
  ];

  const allMarketTrends = [
    [
      { trend: 'Consumers shifting from value to premium tier products', evidence: 'Average price per gram up 8% YoY while unit volume flat — customers buying less but paying more', implication: 'Prioritize premium brand partnerships and shelf space allocation for higher-margin products' },
      { trend: 'Weekend shopping patterns intensifying', evidence: 'Friday-Saturday sales now represent 38% of weekly revenue, up from 33% last year', implication: 'Optimize staffing and inventory replenishment around weekend peaks' },
      { trend: 'First-time customer average age dropping', evidence: 'New customer median age now 27, down from 31 two years ago — Gen Z entering market', implication: 'Consider social media marketing, product assortment, and store experience adjustments for younger demographic' },
    ],
    [
      { trend: 'Loyalty program members spending 2.4x non-members', evidence: 'VIP segment AOV of $84 vs general customer AOV of $35 — gap widening each quarter', implication: 'Double down on loyalty enrollment and tiered rewards to move more customers into higher-value segments' },
      { trend: 'Edibles growing faster than any other category at both locations', evidence: 'Edible share of sales up from 8% to 13% over past 12 months with consistent month-over-month growth', implication: 'Expand edible shelf space and negotiate better terms with edible brands given volume leverage' },
      { trend: 'Online menu browsing before in-store purchase increasing', evidence: 'Weedmaps referral traffic up 25% while walk-in without digital touchpoint down 10%', implication: 'Ensure online menus are always current — stale menus create friction and lost sales' },
    ],
    [
      { trend: 'Micro-dose and low-THC products gaining mainstream traction', evidence: 'Products under 10mg THC now represent 18% of edible sales, up from 9% a year ago', implication: 'Expand low-dose inventory and create a curated "wellness" section targeting health-conscious consumers' },
      { trend: 'Customer visits becoming more planned and less impulsive', evidence: 'Average dwell time down 12% but AOV up 6% — customers know what they want', implication: 'Optimize store layout for efficient shopping while maintaining discovery opportunities at checkout' },
      { trend: 'Cross-category purchasing correlations strengthening', evidence: 'Customers buying flower + pre-roll together up 22%; edible + tincture bundles up 31%', implication: 'Create strategic product bundles and train budtenders on cross-selling complementary categories' },
    ],
  ];

  const allQuestionsForTomorrow = [
    [
      { question: 'What is driving the vape category surge at Greenleaf — new products, pricing, or customer demographics?', priority: 8, category: 'sales_analysis' },
      { question: 'How are recently acquired customers (last 30 days) performing vs historical cohorts on second-visit rate?', priority: 7, category: 'customer_retention' },
      { question: 'What is the optimal discount depth for driving trial of new brands without cannibalizing existing brand sales?', priority: 6, category: 'pricing' },
      { question: 'Are there time-of-day patterns in product mix that could inform dynamic menu board recommendations?', priority: 5, category: 'operations' },
    ],
    [
      { question: 'Which brands have the strongest customer loyalty (repeat purchase rate) and are we stocking enough of them?', priority: 8, category: 'brand_analysis' },
      { question: 'What is the correlation between budtender product knowledge scores and their average transaction values?', priority: 7, category: 'staff_performance' },
      { question: 'How does weather impact foot traffic and can we preemptively adjust staffing based on forecasts?', priority: 5, category: 'operations' },
      { question: 'Are we losing high-value customers to delivery services and if so, which customer segments are most at risk?', priority: 8, category: 'customer_retention' },
    ],
    [
      { question: 'What would be the revenue impact of extending Sunday hours at Emerald Collective based on traffic modeling?', priority: 7, category: 'operations' },
      { question: 'Which competitor pricing moves in the last 30 days have most impacted our category performance?', priority: 8, category: 'competitive_intel' },
      { question: 'Can we identify a leading indicator for customer churn from transaction pattern changes before they lapse?', priority: 9, category: 'customer_retention' },
      { question: 'What is the margin impact of our current vendor payment terms vs. potential early-pay discounts?', priority: 6, category: 'purchasing' },
    ],
  ];

  const allCorrelatedInsights = [
    [
      { internalObservation: 'Pre-roll sales up 18% in the last 2 weeks at both locations', externalEvidence: 'Industry data shows pre-roll category growing 25% YoY nationally, driven by convenience factor', correlation: 'Our growth aligns with national trends but slightly lags — opportunity to capture more of this growing category', confidence: 0.82, actionItem: 'Expand pre-roll selection and consider a dedicated pre-roll display', category: 'product_trends' },
      { internalObservation: 'VIP customers making 3.2 visits/month vs 1.1 for regular segment', externalEvidence: 'Research shows top 20% of dispensary customers generate 65% of revenue industry-wide', correlation: 'Our VIP concentration at 58% of revenue is slightly below industry average — room to grow loyalty program engagement', confidence: 0.75, category: 'customer_value' },
    ],
    [
      { internalObservation: 'Greenleaf downtown traffic patterns show strong lunch-hour spike (11am-1pm)', externalEvidence: 'Urban dispensary foot traffic studies show 30% of weekday sales occur during lunch hours in downtown locations', correlation: 'Our lunch spike at 28% of weekday sales is in line with benchmarks — validates our staffing model for midday', confidence: 0.78, actionItem: 'Ensure budtender coverage is maximum during 11am-1pm weekdays', category: 'operations' },
      { internalObservation: 'Emerald Collective seeing faster growth in edibles than Greenleaf', externalEvidence: 'Neighborhood demographics data shows Mission District has higher concentration of health-conscious consumers', correlation: 'Location-specific product preferences align with neighborhood demographics — customize product mix by store', confidence: 0.71, actionItem: 'Increase edible allocation at Emerald by 15% and reduce at Greenleaf proportionally', category: 'merchandising' },
    ],
    [
      { internalObservation: 'Weekend AOV is $12 higher than weekday AOV on average', externalEvidence: 'Cannabis consumer surveys show weekend shoppers are more likely to be recreational vs medical, with larger basket intent', correlation: 'Recreational weekend shoppers are our highest-value transaction segment — optimize weekend experience for this persona', confidence: 0.85, actionItem: 'Create weekend-exclusive bundle deals targeting recreational consumers', category: 'customer_behavior' },
      { internalObservation: 'New customer return rate within 30 days is 42% at Greenleaf vs 38% at Emerald', externalEvidence: 'Industry benchmark for first-visit-to-second is 35-40% — both stores performing at or above average', correlation: 'Strong first-impression conversion suggests good in-store experience, but Emerald has room for improvement', confidence: 0.73, actionItem: 'Study what Greenleaf does differently in the first-visit experience and replicate at Emerald', category: 'customer_retention' },
    ],
  ];

  return {
    executiveSummary: executiveSummaries[template],
    priorityActions: allPriorityActions[template],
    quickWins: allQuickWins[template],
    watchItems: allWatchItems[template],
    industryHighlights: allIndustryHighlights[template],
    regulatoryUpdates: allRegulatoryUpdates[template],
    marketTrends: allMarketTrends[template],
    questionsForTomorrow: allQuestionsForTomorrow[template],
    correlatedInsights: allCorrelatedInsights[template],
    dataHealthScore: d2(clamp(random(0.82, 0.97), 0.8, 1.0)),
    confidenceScore: d2(clamp(random(0.75, 0.92), 0.7, 0.95)),
  };
}

function d1(n: number): string {
  return n.toFixed(1);
}

async function seedDailyDigests() {
  console.log('\n--- Seeding Daily Digests ---');

  // Generate 30 digests: one per day for the last 30 days
  const digestEnd = END_DATE;
  let count = 0;

  for (let i = 29; i >= 0; i--) {
    const digestDate = new Date(digestEnd.getTime() - i * 86400000);
    const content = generateDigestContent(digestDate, i);

    // Create the DailyDigest first
    const digest = await prisma.dailyDigest.upsert({
      where: { digestDate },
      update: {
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
      create: {
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

    // Create the linked DailyLearningJob (completed)
    const startedAt = new Date(digestDate.getTime() - randomInt(300, 600) * 1000); // Started 5-10 min before digest
    const completedAt = new Date(startedAt.getTime() + randomInt(120, 300) * 1000); // Took 2-5 min

    // Check if a job already exists for this digest
    const existingJob = await prisma.dailyLearningJob.findUnique({
      where: { digestId: digest.id },
    });

    if (!existingJob) {
      await prisma.dailyLearningJob.create({
        data: {
          startedAt,
          completedAt,
          status: 'completed',
          currentPhase: 'completed',
          lastHeartbeat: completedAt,
          dataReviewDone: true,
          questionGenDone: true,
          webResearchDone: true,
          correlationDone: true,
          digestGenDone: true,
          inputTokens: randomInt(45000, 85000),
          outputTokens: randomInt(8000, 18000),
          searchesUsed: randomInt(3, 8),
          estimatedCost: d4(random(0.15, 0.45)),
          questionsGenerated: randomInt(5, 10),
          insightsDiscovered: randomInt(3, 8),
          articlesAnalyzed: randomInt(4, 12),
          digestId: digest.id,
        },
      });
    }

    count++;
    process.stdout.write(`  ${count}/30 digests created...\r`);
  }

  console.log(`  Created ${count} daily digests with linked learning jobs`);
}

// ─── Monthly Strategic Reports ───────────────────────────────────────────────

async function seedMonthlyReports() {
  console.log('\n--- Seeding Monthly Strategic Reports ---');

  // 6 months: Oct 2025 - Mar 2026
  const reportMonths = [
    { year: 2025, month: 9, label: '2025-10' },
    { year: 2025, month: 10, label: '2025-11' },
    { year: 2025, month: 11, label: '2025-12' },
    { year: 2026, month: 0, label: '2026-01' },
    { year: 2026, month: 1, label: '2026-02' },
    { year: 2026, month: 2, label: '2026-03' },
  ];

  const grades = ['A-', 'B+', 'A', 'B+', 'A-', 'B+'];

  for (let i = 0; i < reportMonths.length; i++) {
    const { year, month, label } = reportMonths[i];
    const grade = grades[i];
    const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const report = await prisma.monthlyStrategicReport.upsert({
      where: { monthYear: label },
      update: {},
      create: {
        monthYear: label,
        executiveSummary: `${monthName} delivered ${grade.startsWith('A') ? 'strong' : 'solid'} performance for Demo Retail Group with combined net sales of $${randomInt(380, 520)}K across both locations, representing ${randomInt(5, 15)}% year-over-year growth. Greenleaf Market contributed $${randomInt(220, 300)}K while Emerald Collective added $${randomInt(160, 220)}K. Gross margins held steady at ${d1(random(50, 58))}% despite competitive pricing pressure. Customer acquisition delivered ${randomInt(300, 500)} new registrations while retention metrics showed improvement in the VIP segment. Key wins this month included successful product launches from Pacific Bloom and Golden State Greens, improved budtender performance metrics across the board, and a successful holiday promotion that drove ${randomInt(8, 18)}% lift over the promotional period. Challenges included increased competition from new market entrants, margin pressure in the concentrate category, and continued softness in weekday foot traffic at Emerald Collective.`,
        performanceGrade: grade,
        monthOverMonthChange: {
          netSales: d2(random(-3, 12)),
          grossMargin: d2(random(-2, 3)),
          tickets: d2(random(-5, 10)),
          customers: d2(random(-2, 8)),
          aov: d2(random(-3, 6)),
        },
        strengthsAnalysis: [
          { strength: 'Consistent revenue growth trajectory across both locations', evidence: `${randomInt(6, 14)}% YoY growth maintained for 8+ consecutive months`, impact: 'Revenue compounding provides reinvestment capacity for growth initiatives' },
          { strength: 'Strong brand portfolio with diversified supplier relationships', evidence: `30 active brands with no single brand exceeding ${randomInt(8, 12)}% of total sales`, impact: 'Reduces vendor dependency risk and provides negotiation leverage' },
          { strength: 'Above-average customer retention in VIP segment', evidence: `VIP 90-day retention at ${randomInt(78, 88)}% vs industry average of 65-70%`, impact: 'High-value customer base provides stable revenue foundation' },
          { strength: 'Effective budtender team with strong AOV performance', evidence: `Average team AOV of $${randomInt(62, 78)} vs industry benchmark of $55-60`, impact: 'Well-trained staff driving higher transaction values and customer satisfaction' },
        ],
        weaknessesAnalysis: [
          { weakness: 'Emerald Collective weekday traffic below potential', evidence: `Weekday average of ${randomInt(65, 85)} customers vs Greenleaf's ${randomInt(95, 120)}`, impact: 'Underutilized capacity during Monday-Thursday represents $${randomInt(15, 30)}K monthly opportunity' },
          { weakness: 'Concentrate category margin compression', evidence: `Category margins down ${d1(random(2, 5))} points over last 3 months`, impact: 'Third-largest category by volume affecting overall profitability' },
          { weakness: 'New customer second-visit conversion needs improvement', evidence: `${randomInt(35, 42)}% return within 30 days vs ${randomInt(45, 55)}% target`, impact: 'Customer acquisition cost not fully recovered if first-visit customers do not return' },
        ],
        opportunitiesAnalysis: [
          { opportunity: 'Cannabis beverage category expansion', evidence: 'Category growing 45% nationally, currently only 2% of our sales mix', potential: 'Estimated $${randomInt(8, 15)}K monthly revenue with proper shelf allocation and marketing' },
          { opportunity: 'Delivery service launch to complement retail locations', evidence: 'SF delivery market growing 30% while retail flat at 8%', potential: 'Could add $${randomInt(25, 50)}K monthly revenue within 6 months of launch' },
          { opportunity: 'Corporate wellness and bulk order program', evidence: 'Growing trend of cannabis-friendly corporate events and wellness programs', potential: 'B2B channel could generate $${randomInt(5, 15)}K monthly with minimal overhead' },
        ],
        threatsAnalysis: [
          { threat: 'New MSO competition entering SF market', likelihood: 'High — 2 major operators announced SF expansion plans', impact: 'Could pressure margins and market share, especially at Greenleaf downtown', mitigation: 'Accelerate loyalty program and community engagement to build switching cost moat' },
          { threat: 'Potential tax increases on cannabis businesses', likelihood: 'Medium — SF Board of Supervisors considering additional gross receipts tax', impact: 'Could add 2-4% to effective tax rate, compressing margins', mitigation: 'Engage industry association for advocacy; model financial impact of various scenarios' },
          { threat: 'Rising real estate costs threatening lease renewals', likelihood: 'Medium — both leases up for renewal within 18 months', impact: 'Rent increases could add $${randomInt(3, 8)}K/month to operating costs', mitigation: 'Begin early lease negotiations; evaluate alternative locations as backup' },
        ],
        salesTrends: [
          { metric: 'Net Sales', trend: 'Upward', change: `+${d1(random(5, 14))}% YoY`, detail: 'Consistent growth driven by customer acquisition and AOV expansion' },
          { metric: 'Gross Margin', trend: 'Stable', change: `${d1(random(-1, 2))}% vs prior month`, detail: 'Holding steady despite category mix shift toward lower-margin concentrates' },
          { metric: 'Tickets per Day', trend: 'Upward', change: `+${d1(random(3, 8))}% MoM`, detail: 'Increased foot traffic from marketing campaigns and seasonal demand' },
        ],
        customerTrends: [
          { metric: 'New Registrations', trend: 'Stable', change: `${randomInt(300, 500)} this month`, detail: 'Acquisition holding steady with organic and referral channels' },
          { metric: 'VIP Segment Growth', trend: 'Upward', change: `+${randomInt(12, 28)} VIP customers`, detail: 'Loyalty program driving upgrades from Regular to VIP tier' },
          { metric: 'Churn Rate', trend: 'Improving', change: `${d1(random(2, 5))}% vs ${d1(random(4, 7))}% prior month`, detail: 'Win-back campaigns showing results for 90-180 day lapsed segment' },
        ],
        brandTrends: [
          { brand: 'Pacific Bloom', trend: 'Growing', shareChange: `+${d1(random(0.5, 2.0))}%`, detail: 'New product drops driving trial and repeat purchases' },
          { brand: 'Golden State Greens', trend: 'Stable', shareChange: `${d1(random(-0.5, 0.5))}%`, detail: 'Consistent performer maintaining market position' },
          { brand: 'Fog City Flower', trend: 'Declining', shareChange: `-${d1(random(0.5, 1.5))}%`, detail: 'Quality concerns and increased competition from newer brands' },
        ],
        marketTrends: [
          { trend: 'Premium product demand increasing', evidence: 'Average price point up 8% while volume flat', implication: 'Consumer willingness to pay for quality supports margin expansion strategy' },
          { trend: 'Digital-first shopping journey becoming standard', evidence: '65% of customers check online menu before visiting', implication: 'Investment in digital presence and online ordering critical for growth' },
        ],
        strategicPriorities: [
          { priority: 'Strengthen customer retention and loyalty program', timeline: 'Q1-Q2 2026', owner: 'Operations', kpis: ['Increase VIP segment by 15%', 'Improve 30-day return rate to 50%', 'Reduce churn rate to 3%'] },
          { priority: 'Optimize product mix for margin improvement', timeline: 'Q1 2026', owner: 'Purchasing', kpis: ['Increase gross margin to 55%', 'Reduce aged inventory by 30%', 'Launch 5 exclusive product partnerships'] },
          { priority: 'Evaluate delivery service launch feasibility', timeline: 'Q2 2026', owner: 'Strategy', kpis: ['Complete market analysis', 'Finalize vendor partnerships', 'Submit license application'] },
        ],
        quarterlyGoals: [
          { goal: `Achieve $${randomInt(1200, 1600)}K combined quarterly net sales`, status: 'On Track', progress: randomInt(60, 95) },
          { goal: 'Maintain 52%+ gross margin across both locations', status: randomInt(0, 1) ? 'On Track' : 'At Risk', progress: randomInt(45, 85) },
          { goal: 'Onboard 1,200+ new customers this quarter', status: 'On Track', progress: randomInt(50, 90) },
        ],
        resourceAllocations: [
          { resource: 'Marketing Budget', allocation: `$${randomInt(8, 15)}K/month`, recommendation: 'Shift 20% from print to digital — social media ROI is 3x print campaigns' },
          { resource: 'Staff Training', allocation: '8 hours/employee/quarter', recommendation: 'Add product knowledge certification to boost AOV across the team' },
        ],
        riskMitigations: [
          { risk: 'Supply chain disruption from regulatory changes', probability: 'Low', impact: 'High', mitigation: 'Maintain 30-day safety stock on top 50 SKUs and diversify vendor base' },
          { risk: 'Key employee departure', probability: 'Medium', impact: 'Medium', mitigation: 'Implement retention bonuses for top 5 performers and cross-train backup personnel' },
        ],
        competitiveLandscape: {
          summary: 'SF cannabis market increasingly competitive with 3 new licenses issued this quarter',
          keyCompetitors: ['Green Cross SF', 'SPARC', 'The Apothecarium', 'Berner\'s on Haight'],
          competitiveAdvantage: 'Strong community relationships, superior budtender training, and data-driven operations',
          marketPosition: 'Top-tier independent operator in SF market',
        },
        marketPositioning: {
          currentPosition: 'Premium independent cannabis retailer with community focus',
          targetPosition: 'The smartest dispensary in San Francisco — data-driven, customer-obsessed, community-first',
          differentiators: ['AI-powered business intelligence', 'Best-trained budtenders in the city', 'Curated local brand partnerships', 'Loyalty program with real value'],
        },
        regulatoryOutlook: {
          summary: 'Regulatory environment stable with incremental compliance updates expected',
          upcomingChanges: ['Packaging requirements update Q2 2026', 'Track-and-trace system upgrade', 'Potential tax rate adjustment'],
          complianceStatus: 'Fully compliant across all current requirements',
        },
        revenueProjections: [
          { period: 'Q2 2026', projected: randomInt(420, 520), basis: 'Seasonal uplift from 4/20 and summer months', confidence: 'High' },
          { period: 'Q3 2026', projected: randomInt(440, 540), basis: 'Continued growth trajectory plus delivery service launch', confidence: 'Medium' },
          { period: 'Q4 2026', projected: randomInt(480, 580), basis: 'Holiday boost and delivery maturation', confidence: 'Medium' },
        ],
        growthOpportunities: [
          { opportunity: 'Delivery service', estimatedRevenue: `$${randomInt(25, 50)}K/month by month 6`, investmentRequired: `$${randomInt(30, 60)}K setup`, timeline: 'Launch Q2 2026' },
          { opportunity: 'Online pre-ordering and curbside pickup', estimatedRevenue: `$${randomInt(15, 30)}K/month`, investmentRequired: `$${randomInt(10, 20)}K platform cost`, timeline: 'Launch Q1 2026' },
        ],
        riskFactors: [
          { factor: 'Market competition intensifying', severity: 'Medium', trend: 'Increasing', mitigation: 'Strengthen brand loyalty and unique value proposition' },
          { factor: 'Cannabis tax burden', severity: 'High', trend: 'Stable', mitigation: 'Operational efficiency to absorb tax load' },
        ],
        keyQuestionsNext: [
          { question: 'Should we accelerate delivery service launch given competitive pressure?', priority: 'High', context: 'Two competitors launched delivery in the last 90 days' },
          { question: 'What is the optimal store count for the SF market given current demand?', priority: 'Medium', context: 'Third location feasibility study underway' },
          { question: 'How can we better monetize our customer data and insights for vendor partnerships?', priority: 'Medium', context: 'Vendors willing to pay for anonymized market intelligence' },
        ],
        dataHealthScore: d2(clamp(random(0.82, 0.95), 0.8, 1.0)),
        confidenceScore: d2(clamp(random(0.78, 0.92), 0.75, 0.95)),
        dailyDigestsIncluded: randomInt(22, 30),
      },
    });

    console.log(`  ${label} (${monthName}): ${grade}`);
  }

  console.log(`  Created ${reportMonths.length} monthly strategic reports`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('==============================================');
  console.log('  Chapters Demo Data Seeder');
  console.log('  Generating 10 years of cannabis retail data');
  console.log('==============================================');
  console.log(`  Date range: ${formatDate(START_DATE)} to ${formatDate(END_DATE)}`);
  console.log(`  Stores: ${STORES.length}`);
  console.log(`  Brands: ${BRAND_NAMES.length}`);
  console.log(`  Vendors: ${VENDOR_NAMES.length}`);
  console.log('');

  const startTime = Date.now();

  // 1. Organization
  const org = await seedOrganization();

  // 2. Storefronts
  const storefronts = await seedStorefronts(org.id);

  // 3. Brands
  const brandMap = await seedBrands();

  // 4. Vendors
  await seedVendors();

  // 5. Sales Records (~7500 rows)
  await seedSalesRecords(storefronts);

  // 6. Brand Records (monthly, 30 brands x 2 stores x ~123 months)
  await seedBrandRecords(storefronts, brandMap);

  // 7. Product Records (monthly, 8 types x 2 stores x ~123 months)
  await seedProductRecords(storefronts);

  // 8. Budtender Records (last 2 years, 15 employees)
  await seedBudtenderRecords(storefronts);

  // 9. Customers (5000 per store)
  await seedCustomers(storefronts);

  // 10. Daily Digests (30 days)
  await seedDailyDigests();

  // 11. Monthly Strategic Reports (6 months)
  await seedMonthlyReports();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n==============================================');
  console.log(`  Seeding complete in ${elapsed}s`);
  console.log('==============================================');
}

main()
  .catch((e) => {
    console.error('\nFatal error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
