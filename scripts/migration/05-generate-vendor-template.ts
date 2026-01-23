/**
 * Generate Vendor Mapping Template
 *
 * Creates a JSON template from unique invoice vendor names for review/editing.
 * Run with: npx tsx scripts/migration/05-generate-vendor-template.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Normalize vendor name for grouping similar names
function normalize(name: string): string {
  return name
    .toUpperCase()
    .replace(/,?\s*(LLC|INC|CORP|CO|COMPANY|L\.L\.C\.?|INC\.?)\.?$/gi, '')
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface VendorGroup {
  canonical: string;
  aliases: string[];
  totalInvoices: number;
}

async function main() {
  console.log('Generating vendor mapping template...\n');

  // Get all unique vendor names with counts
  const vendors = await prisma.invoice.groupBy({
    by: ['originalVendorName'],
    _count: true,
    orderBy: { _count: { originalVendorName: 'desc' } },
  });

  console.log(`Found ${vendors.length} unique vendor names in invoices`);

  // Group by normalized name to find aliases
  const groups: Record<string, VendorGroup> = {};

  for (const v of vendors) {
    const name = v.originalVendorName || 'UNKNOWN';
    const normalized = normalize(name);

    if (!groups[normalized]) {
      groups[normalized] = {
        canonical: name, // Use first (most common) as canonical
        aliases: [],
        totalInvoices: 0,
      };
    } else {
      // Add as alias if not already the canonical or in aliases
      if (groups[normalized].canonical !== name && !groups[normalized].aliases.includes(name)) {
        groups[normalized].aliases.push(name);
      }
    }
    groups[normalized].totalInvoices += v._count;
  }

  // Convert to array and sort by invoice count
  const mapping = Object.values(groups)
    .sort((a, b) => b.totalInvoices - a.totalInvoices)
    .map((g) => ({
      canonicalName: g.canonical,
      aliases: g.aliases,
      invoiceCount: g.totalInvoices,
    }));

  // Ensure config directory exists
  const configDir = path.join(process.cwd(), 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Write to file
  const output = {
    _instructions:
      'Edit canonicalName to set the preferred vendor name. Add/remove aliases as needed. Delete entire vendor objects to exclude them from import.',
    _generated: new Date().toISOString(),
    vendors: mapping,
  };

  const outputPath = path.join(configDir, 'vendor_mapping_template.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\nCreated: ${outputPath}`);
  console.log(`Total canonical vendors: ${Object.keys(groups).length}`);
  console.log(`Total raw vendor names: ${vendors.length}`);

  // Show top 10
  console.log('\nTop 10 vendors by invoice count:');
  mapping.slice(0, 10).forEach((v, i) => {
    const aliasInfo = v.aliases.length > 0 ? ` (+${v.aliases.length} aliases)` : '';
    console.log(`  ${i + 1}. ${v.canonicalName} - ${v.invoiceCount} invoices${aliasInfo}`);
  });

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
