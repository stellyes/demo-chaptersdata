#!/bin/bash
# Migration Monitor Script
# Run with: ./scripts/migration/monitor-migration.sh

cd "$(dirname "$0")/../.."

echo "=========================================="
echo "  Aurora PostgreSQL Migration Monitor"
echo "=========================================="
echo ""

while true; do
  clear
  echo "=========================================="
  echo "  Aurora PostgreSQL Migration Monitor"
  echo "  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "=========================================="
  echo ""

  # Query counts using Prisma
  npx tsx -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const [sales, brands, products, canonical, aliases, invoices, lineItems] = await Promise.all([
    prisma.salesRecord.count(),
    prisma.brandRecord.count(),
    prisma.productRecord.count(),
    prisma.canonicalBrand.count(),
    prisma.brandAlias.count(),
    prisma.invoice.count(),
    prisma.invoiceLineItem.count()
  ]);
  console.log('┌─────────────────────────┬──────────┐');
  console.log('│ Table                   │ Count    │');
  console.log('├─────────────────────────┼──────────┤');
  console.log('│ Sales Records           │ ' + String(sales).padStart(8) + ' │');
  console.log('│ Brand Records           │ ' + String(brands).padStart(8) + ' │');
  console.log('│ Product Records         │ ' + String(products).padStart(8) + ' │');
  console.log('│ Canonical Brands        │ ' + String(canonical).padStart(8) + ' │');
  console.log('│ Brand Aliases           │ ' + String(aliases).padStart(8) + ' │');
  console.log('│ Invoices                │ ' + String(invoices).padStart(8) + ' │');
  console.log('│ Invoice Line Items      │ ' + String(lineItems).padStart(8) + ' │');
  console.log('└─────────────────────────┴──────────┘');
  await prisma.\$disconnect();
}
main();
" 2>/dev/null

  echo ""
  echo "Press Ctrl+C to exit. Refreshing in 5 seconds..."
  sleep 5
done
