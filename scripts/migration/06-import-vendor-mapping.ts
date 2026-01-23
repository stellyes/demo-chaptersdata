/**
 * Import Vendor Mapping from Template
 *
 * Imports edited vendor_mapping_template.json into Aurora PostgreSQL.
 * Run with: npx tsx scripts/migration/06-import-vendor-mapping.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface VendorEntry {
  canonicalName: string;
  aliases: string[];
  invoiceCount?: number;
}

interface VendorMapping {
  _instructions?: string;
  _generated?: string;
  vendors: VendorEntry[];
}

async function main() {
  console.log('========================================');
  console.log('Import Vendor Mapping');
  console.log('========================================\n');

  // Use consolidated mapping if available, otherwise fall back to template
  const consolidatedPath = path.join(process.cwd(), 'config', 'vendor_mapping_consolidated.json');
  const templatePath = path.join(process.cwd(), 'config', 'vendor_mapping_template.json');

  const mappingPath = fs.existsSync(consolidatedPath) ? consolidatedPath : templatePath;

  if (!fs.existsSync(mappingPath)) {
    console.error('Error: No vendor mapping file found');
    console.error('Run 05-generate-vendor-template.ts or 07-consolidate-vendors.ts first');
    process.exit(1);
  }

  console.log(`Using: ${path.basename(mappingPath)}\n`);

  const data: VendorMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));

  if (!data.vendors || !Array.isArray(data.vendors)) {
    console.error('Error: Invalid template format - missing vendors array');
    process.exit(1);
  }

  console.log(`Found ${data.vendors.length} vendors to import\n`);

  let vendorCount = 0;
  let aliasCount = 0;
  let linkedInvoices = 0;
  const errors: string[] = [];

  for (const entry of data.vendors) {
    if (!entry.canonicalName) continue;

    try {
      // Create or update the canonical vendor
      const vendor = await prisma.vendor.upsert({
        where: { canonicalName: entry.canonicalName },
        create: { canonicalName: entry.canonicalName },
        update: {},
      });
      vendorCount++;

      // Collect all names (canonical + aliases) for this vendor
      const allNames = [entry.canonicalName, ...entry.aliases];

      // Create aliases for each name
      for (const aliasName of allNames) {
        try {
          await prisma.vendorAlias.upsert({
            where: { aliasName },
            create: {
              aliasName,
              vendorId: vendor.id,
            },
            update: {
              vendorId: vendor.id,
            },
          });
          aliasCount++;
        } catch (err) {
          // Alias might already exist for different vendor - skip
        }
      }

      // Link invoices with matching vendor names
      const result = await prisma.invoice.updateMany({
        where: {
          originalVendorName: { in: allNames },
          vendorId: null,
        },
        data: {
          vendorId: vendor.id,
        },
      });
      linkedInvoices += result.count;

      process.stdout.write(`\r  Processed ${vendorCount} vendors...`);
    } catch (err) {
      errors.push(`${entry.canonicalName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  console.log('\n\n========================================');
  console.log('Import Complete!');
  console.log('========================================');
  console.log(`\n📈 Summary:`);
  console.log(`   Vendors created:     ${vendorCount}`);
  console.log(`   Aliases created:     ${aliasCount}`);
  console.log(`   Invoices linked:     ${linkedInvoices}`);

  // Check unlinked invoices
  const unlinked = await prisma.invoice.count({
    where: { vendorId: null },
  });
  if (unlinked > 0) {
    console.log(`   Unlinked invoices:   ${unlinked} (vendor name not in mapping)`);
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`);
    errors.slice(0, 10).forEach((err) => console.log(`   - ${err}`));
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more`);
    }
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
