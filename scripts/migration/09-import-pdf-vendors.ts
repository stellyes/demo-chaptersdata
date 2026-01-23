/**
 * Import PDF-Extracted Vendors
 *
 * Imports vendor data extracted from PDFs for unlinked invoices.
 *
 * Run with: npx tsx scripts/migration/09-import-pdf-vendors.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Vendor name normalizations
const NORMALIZATIONS: Record<string, string | null> = {
  // Skip generic/partial names
  HIGH: null,
  PRIVATE: null,
  LOST: null,
  THE: null,
  SOUR: null,
  FUN: null,
  SWEET: null,
  PEACH: null,
  GREEN: null,
  CHILL: null,
  PURE: null,
  DIME: null,
  BLUE: null,
  SILVER: null,
  BIG: null,
  OLD: null,

  // Normalize known brands
  'PURE XTRACTS': 'PUREXTRACTS',
  PUREXTRACTS: 'PUREXTRACTS',
  MEDICONE: 'MEDICONE',
  'GOLD SEAL': 'GOLD SEAL',
  BREEZ: 'BREEZ',
  HAGALICIOUS: 'HAGALICIOUS',
  MENDOCINOBLUE: 'MENDOCINO BLUE',
  NECTAR: 'NECTAR',
  HIGHRIZE: 'HIGHRIZE',
  'FIG FARMS': 'FIG FARMS',
  NUG: 'NUG',
  BEBOE: 'BEBOE',
  UPNORTH: 'UPNORTH DISTRIBUTION',
  TARHILL: 'TARHILL CANNABIS',
  SAUCE: 'SAUCE ESSENTIALS',
  PROOF: 'PROOF',
  KINGPEN: 'KINGPEN',
  YERBA: 'YERBA BUENA LOGISTICS',
  CRUMBZ: 'CRUMBZ',
  "TED'S": "TED'S BUDZ",
  HESHIES: 'HESHIES',
  ABSOLUTE: 'ABSOLUTE XTRACTS',
  SUMMIT: 'SUMMIT',
  CANNAPUNCH: 'CANNAPUNCH',
  DEFONCE: 'DEFONCE',
  VENOM: 'VENOM EXTRACTS',
  EMBER: 'EMBER VALLEY',
  GLOWING: 'GLOWING BUDDHA',
  'STONE ROAD': 'STONE ROAD',
  'LOST FARM': 'LOST FARM',
  'HIGH NOON': 'HIGH NOON',
  'HIGH GARDEN': 'HIGH GARDEN',
  'PRIVATE STOCK': 'PRIVATE STOCK',
  'GREEN DOT': 'GREEN DOT LABS',
};

interface ExtractedVendors {
  vendor_map: Record<string, string>;
  vendor_counts: Record<string, number>;
  no_pdf: string[];
  no_vendor: string[];
}

async function getOrCreateVendor(vendorName: string): Promise<string | null> {
  // Check normalization
  const normalized = NORMALIZATIONS[vendorName.toUpperCase()];
  if (normalized === null) return null; // Skip this vendor
  const finalName = normalized || vendorName.toUpperCase();

  // Check if vendor exists
  let vendor = await prisma.vendor.findFirst({
    where: { canonicalName: finalName },
  });

  if (vendor) return vendor.id;

  // Check aliases
  const alias = await prisma.vendorAlias.findFirst({
    where: { aliasName: finalName },
    include: { vendor: true },
  });

  if (alias) return alias.vendor.id;

  // Create new vendor
  vendor = await prisma.vendor.create({
    data: { canonicalName: finalName },
  });

  // Create alias
  await prisma.vendorAlias
    .create({
      data: {
        aliasName: finalName,
        vendorId: vendor.id,
      },
    })
    .catch(() => {}); // Ignore if alias already exists

  return vendor.id;
}

async function main() {
  console.log('========================================');
  console.log('Import PDF-Extracted Vendors');
  console.log('========================================\n');

  const inputPath = path.join(process.cwd(), '..', 'invoice-crawler', 'extracted_vendors_simple.json');

  if (!fs.existsSync(inputPath)) {
    console.error('Error: extracted_vendors_simple.json not found');
    console.error('Run extract_vendors_simple.py first');
    process.exit(1);
  }

  const data: ExtractedVendors = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const vendorMap = data.vendor_map;

  console.log(`Found ${Object.keys(vendorMap).length} invoice-vendor mappings\n`);

  // Process mappings
  console.log('Importing vendors and linking invoices...');
  let linked = 0;
  let skipped = 0;
  let notFound = 0;
  const vendorCounts: Record<string, number> = {};
  const newVendors: string[] = [];

  const invoiceIds = Object.keys(vendorMap);
  for (let i = 0; i < invoiceIds.length; i++) {
    const invoiceId = invoiceIds[i];
    const vendorName = vendorMap[invoiceId];

    if (i % 100 === 0) {
      process.stdout.write(`\r  Processing ${i}/${invoiceIds.length}...`);
    }

    // Find invoice in database
    const invoice = await prisma.invoice.findFirst({
      where: {
        invoiceId: invoiceId,
        vendorId: null, // Only unlinked invoices
      },
    });

    if (!invoice) {
      notFound++;
      continue;
    }

    // Get or create vendor
    const vendorId = await getOrCreateVendor(vendorName);
    if (!vendorId) {
      skipped++;
      continue;
    }

    // Get vendor name for logging
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    // Link invoice
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        vendorId,
        originalVendorName: vendor?.canonicalName || vendorName,
      },
    });

    linked++;
    const vName = vendor?.canonicalName || vendorName;
    vendorCounts[vName] = (vendorCounts[vName] || 0) + 1;
  }

  console.log('\n');

  // Results
  console.log('Results:');
  console.log('-'.repeat(50));
  console.log(`Total mappings:      ${invoiceIds.length}`);
  console.log(`Invoices linked:     ${linked}`);
  console.log(`Skipped (generic):   ${skipped}`);
  console.log(`Not found/linked:    ${notFound}`);

  // Top vendors
  const sortedVendors = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]);
  console.log('\nTop vendors linked:');
  for (const [vendor, count] of sortedVendors.slice(0, 20)) {
    console.log(`  ${vendor}: ${count}`);
  }

  // Final count
  const remainingUnlinked = await prisma.invoice.count({
    where: { vendorId: null },
  });
  const totalInvoices = await prisma.invoice.count();
  const linkedTotal = totalInvoices - remainingUnlinked;

  console.log(`\n========================================`);
  console.log('Final Summary:');
  console.log(`  Total invoices:      ${totalInvoices}`);
  console.log(`  Linked to vendors:   ${linkedTotal} (${((linkedTotal / totalInvoices) * 100).toFixed(1)}%)`);
  console.log(`  Remaining unlinked:  ${remainingUnlinked}`);
  console.log('========================================');

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
