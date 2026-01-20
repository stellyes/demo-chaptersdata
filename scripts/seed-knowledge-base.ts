// Seed default business rules for the knowledge base

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultRules = [
  {
    category: 'margins',
    name: 'minimum_acceptable_margin',
    description: 'Minimum gross margin threshold for products',
    rule: 'Products with gross margins below 30% should be flagged for review. Target margin for flower is 40%+, concentrates 45%+, edibles 50%+.',
    priority: 8,
    createdBy: 'system',
  },
  {
    category: 'brands',
    name: 'brand_performance_threshold',
    description: 'When to consider discontinuing a brand',
    rule: 'Brands representing less than 0.5% of sales for 3+ months with margins under 35% are candidates for discontinuation.',
    priority: 7,
    createdBy: 'system',
  },
  {
    category: 'inventory',
    name: 'reorder_timing',
    description: 'When to reorder products',
    rule: 'Reorder when inventory reaches 2 weeks of supply. Fast-moving items (top 20% by velocity) should maintain 3 weeks supply.',
    priority: 8,
    createdBy: 'system',
  },
  {
    category: 'customers',
    name: 'churn_definition',
    description: 'When a customer is considered churned',
    rule: 'Customers with no visit in 90 days are at-risk. Customers with no visit in 180 days are considered churned.',
    priority: 7,
    createdBy: 'system',
  },
  {
    category: 'pricing',
    name: 'discount_limits',
    description: 'Guardrails on discounting',
    rule: 'Total discount percentage should not exceed 15% of gross sales. Daily deals should target 10-20% off, not more.',
    priority: 8,
    createdBy: 'system',
  },
  {
    category: 'sales',
    name: 'store_comparison',
    description: 'How to compare store performance',
    rule: 'Barbary Coast typically has 60% higher foot traffic than Grass Roots. Compare per-customer metrics, not totals.',
    priority: 6,
    createdBy: 'system',
  },
];

async function main() {
  console.log('Seeding default business rules...');

  for (const rule of defaultRules) {
    const result = await prisma.businessRule.upsert({
      where: {
        category_name: {
          category: rule.category,
          name: rule.name,
        },
      },
      update: {
        description: rule.description,
        rule: rule.rule,
        priority: rule.priority,
      },
      create: rule,
    });
    console.log(`  ✓ ${rule.category}/${rule.name}`);
  }

  console.log('\nDone! Seeded', defaultRules.length, 'business rules.');
}

main()
  .catch((e) => {
    console.error('Error seeding rules:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
