import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function review() {
  const unlinked = await prisma.invoiceLineItem.findMany({
    where: { brandId: null },
    select: {
      originalBrandName: true,
      productName: true,
      totalCost: true,
    }
  });

  const byBrand: Record<string, { count: number; totalCost: number; sample: string | null }> = {};
  for (const item of unlinked) {
    const brand = item.originalBrandName || "(empty)";
    if (byBrand[brand] === undefined) {
      byBrand[brand] = { count: 0, totalCost: 0, sample: null };
    }
    byBrand[brand].count++;
    byBrand[brand].totalCost += Number(item.totalCost);
    if (byBrand[brand].sample === null) {
      byBrand[brand].sample = item.productName;
    }
  }

  console.log("UNLINKED LINE ITEMS BY BRAND:");
  console.log("=".repeat(60));

  const sorted = Object.entries(byBrand).sort((a, b) => b[1].count - a[1].count);
  for (const [brand, info] of sorted) {
    console.log(`${brand} (${info.count} items, $${info.totalCost.toFixed(2)})`);
    console.log(`  Sample: ${info.sample || "(none)"}`);
  }

  await prisma.$disconnect();
}

review().catch(console.error);
