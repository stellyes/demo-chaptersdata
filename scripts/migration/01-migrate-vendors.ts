/**
 * Vendor Normalization Migration Script
 *
 * Migrates vendor names to canonical forms in PostgreSQL.
 * These mappings were previously hardcoded in the application.
 *
 * Run with: npm run migrate:vendors
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Vendor normalization mappings
// Maps various vendor name variations to their canonical form
// Based on ~130 canonical vendors with ~800 aliases from invoice data
const VENDOR_MAPPINGS: Record<string, string[]> = {
  'Nabis': [
    'NABITWO, LLC A&B',
    'NABITWO, LLC',
    'NABIS 2.0 LLC',
    'NABIS TWO LLC',
    'NABIS 2.0',
    'NABIS',
    'Nabis 2.0',
    'NABITWO LLC',
    'NABITWO',
  ],
  'Kiva': [
    'KIVA SALES & SERVICE',
    'KIVA SALES AND SERVICE',
    'KIVA CONFECTIONS',
    'KIVA',
    'Kiva Sales & Service',
    'Kiva Confections',
  ],
  'Herbl': [
    'HERBL INC',
    'HERBL, INC.',
    'HERBL, INC',
    'HERBL',
    'Herbl Inc',
    'Herbl',
  ],
  'Integral Innovations': [
    'INTEGRAL INNOVATIONS',
    'INTEGRAL INNOVATIONS LLC',
    'INTEGRAL INNOVATIONS, LLC',
  ],
  'Big Pete\'s': [
    'BIG PETE\'S',
    'BIG PETES',
    'BIG PETE\'S TREATS',
    "Big Pete's",
    "Big Pete's Treats",
  ],
  'Kind House': [
    'KIND HOUSE',
    'KIND HOUSE LLC',
    'Kind House',
  ],
  'River Distributing': [
    'RIVER DISTRIBUTING',
    'RIVER DISTRIBUTING LLC',
    'River Distributing',
  ],
  'Greenfield Organix': [
    'GREENFIELD ORGANIX',
    'GREENFIELD ORGANIX LLC',
    'Greenfield Organix',
  ],
  'Coastal': [
    'COASTAL',
    'COASTAL DISTRIBUTION',
    'COASTAL DIST',
    'Coastal',
  ],
  'Flow Kana': [
    'FLOW KANA',
    'FLOW KANA INC',
    'Flow Kana',
  ],
  'Connected': [
    'CONNECTED',
    'CONNECTED CANNABIS CO',
    'Connected Cannabis',
  ],
  'PAX': [
    'PAX LABS',
    'PAX LABS INC',
    'PAX',
    'Pax Labs',
  ],
  'STIIIZY': [
    'STIIIZY',
    'STIIIZY INC',
    'SHRYNE GROUP',
    'Stiiizy',
  ],
  'Raw Garden': [
    'RAW GARDEN',
    'RAW GARDEN INC',
    'Raw Garden',
  ],
  'Caliva': [
    'CALIVA',
    'CALIVA INC',
    'Caliva',
  ],
  'Cookies': [
    'COOKIES',
    'COOKIES SF',
    'COOKIES CALIFORNIA',
    'Cookies',
  ],
  'Bloom Farms': [
    'BLOOM FARMS',
    'BLOOM FARMS INC',
    'Bloom Farms',
  ],
  'Papa & Barkley': [
    'PAPA & BARKLEY',
    'PAPA AND BARKLEY',
    'Papa & Barkley',
  ],
  'Absolute Xtracts': [
    'ABSOLUTE XTRACTS',
    'ABX',
    'Absolute Xtracts',
  ],
  'Almora': [
    'ALMORA',
    'ALMORA FARMS',
    'Almora',
  ],
  'Jetty Extracts': [
    'JETTY EXTRACTS',
    'JETTY',
    'Jetty Extracts',
  ],
  'Select': [
    'SELECT',
    'SELECT OIL',
    'CURALEAF SELECT',
    'Select',
  ],
  'Dosist': [
    'DOSIST',
    'DOSE',
    'Dosist',
  ],
  'Wyld': [
    'WYLD',
    'WYLD CBD',
    'Wyld',
  ],
  'Plus Products': [
    'PLUS PRODUCTS',
    'PLUS',
    '+',
    'Plus',
  ],
  'Canndescent': [
    'CANNDESCENT',
    'Canndescent',
  ],
  'Glass House Farms': [
    'GLASS HOUSE FARMS',
    'GLASS HOUSE',
    'Glass House',
  ],
  'Heavy Hitters': [
    'HEAVY HITTERS',
    'Heavy Hitters',
  ],
  'Legion of Bloom': [
    'LEGION OF BLOOM',
    'LOB',
    'Legion of Bloom',
  ],
  'Mary\'s Medicinals': [
    'MARY\'S MEDICINALS',
    'MARYS MEDICINALS',
    "Mary's Medicinals",
  ],
  'Platinum Vape': [
    'PLATINUM VAPE',
    'PLATINUM',
    'Platinum Vape',
  ],
  'Lowell Farms': [
    'LOWELL FARMS',
    'LOWELL',
    'Lowell Farms',
  ],
  'Proof': [
    'PROOF',
    'PROOF CANNABIS',
    'Proof',
  ],
  'Stone Road': [
    'STONE ROAD',
    'Stone Road',
  ],
  'Old Pal': [
    'OLD PAL',
    'Old Pal',
  ],
  'Sublime': [
    'SUBLIME',
    'SUBLIME CANNA',
    'Sublime',
  ],
  'Humboldt Farms': [
    'HUMBOLDT FARMS',
    'HUMBOLDT',
    'Humboldt Farms',
  ],
  'Care By Design': [
    'CARE BY DESIGN',
    'CBD',
    'Care By Design',
  ],
  'Alien Labs': [
    'ALIEN LABS',
    'Alien Labs',
  ],
  'Fig Farms': [
    'FIG FARMS',
    'Fig Farms',
  ],
  'Garden Society': [
    'GARDEN SOCIETY',
    'Garden Society',
  ],
  'Levo': [
    'LEVO',
    'LEVO OIL',
    'Levo',
  ],
  'Monogram': [
    'MONOGRAM',
    'Monogram',
  ],
  'CRU': [
    'CRU',
    'CRU CANNABIS',
    'Cru',
  ],
};

async function migrateVendors() {
  console.log('Starting vendor normalization migration...\n');

  let vendorCount = 0;
  let aliasCount = 0;

  try {
    for (const [canonicalName, aliases] of Object.entries(VENDOR_MAPPINGS)) {
      // Create or update the canonical vendor
      const vendor = await prisma.vendor.upsert({
        where: { canonicalName },
        update: {},
        create: { canonicalName },
      });

      vendorCount++;
      console.log(`Created vendor: ${canonicalName}`);

      // Create aliases
      for (const aliasName of aliases) {
        try {
          await prisma.vendorAlias.upsert({
            where: { aliasName },
            update: { vendorId: vendor.id },
            create: {
              vendorId: vendor.id,
              aliasName,
            },
          });
          aliasCount++;
        } catch (error) {
          // Skip if alias already exists for another vendor
          console.log(`  - Skipped alias (may exist): ${aliasName}`);
        }
      }
    }

    console.log('\n========================================');
    console.log(`Migration complete!`);
    console.log(`  Vendors created: ${vendorCount}`);
    console.log(`  Aliases created: ${aliasCount}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateVendors()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
