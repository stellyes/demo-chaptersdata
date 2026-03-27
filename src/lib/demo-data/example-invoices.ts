import { InvoiceLineItem } from '@/types';

/**
 * Demo invoice line items that reference brands/products from the demo seed data.
 * These create a realistic purchasing dataset for the Invoice Analysis tab.
 */

const DEMO_BRANDS_BY_TYPE: Record<string, string[]> = {
  Flower: ['Pacific Bloom', 'Golden State Greens', 'Redwood Reserve', 'Humboldt Heritage', 'Fog City Flower'],
  'Pre-Roll': ['Bay Area Botanicals', 'NorCal Naturals', 'Cali Craft Cannabis', 'Fillmore Flower Co'],
  Vape: ['Sunset Valley Farms', 'Sierra Gold', 'Presidio Premium', 'Twin Peaks Terps'],
  Edible: ['Marina Mints', 'Ocean Beach Organics', 'Parkside Provisions', 'Outer Lands Labs'],
  Concentrate: ['SoMa Solventless', 'Dogpatch Dabs', 'Excelsior Extracts'],
  Tincture: ['Coastal Harvest', 'Mission District Meds'],
  Topical: ['Haight Street Herbals', 'Richmond Roots'],
  Accessory: ['Castro Cultivars', 'Bayview Buds'],
  Beverage: ['Potrero Puffs', 'Tenderloin Terpenes'],
};

const VENDORS = [
  'Pacific Coast Distribution',
  'Golden Gate Supply Co',
  'NorCal Cannabis Wholesale',
  'Bay Bridge Distribution',
  'Emerald Valley Trading',
];

function generateDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function generateInvoiceId(index: number): string {
  return `INV-${String(2026000 + index).padStart(7, '0')}`;
}

export const DEMO_INVOICE_DATA: InvoiceLineItem[] = (() => {
  const items: InvoiceLineItem[] = [];

  const productTypes = Object.keys(DEMO_BRANDS_BY_TYPE);

  for (let i = 0; i < 40; i++) {
    const vendor = VENDORS[i % VENDORS.length];
    const invoiceId = generateInvoiceId(i);
    const invoiceDate = generateDate(Math.floor(i * 2.5));
    const itemCount = 3 + (i % 5);

    for (let j = 0; j < itemCount; j++) {
      const productType = productTypes[(i + j) % productTypes.length];
      const brands = DEMO_BRANDS_BY_TYPE[productType];
      const brand = brands[j % brands.length];
      const unitCost = 5 + Math.round(((i * 7 + j * 13) % 30) * 100) / 100;
      const quantity = 6 + ((i * 3 + j * 7) % 48);
      const totalCost = Math.round(unitCost * quantity * 100) / 100;
      const excise = Math.round(totalCost * 0.15 * 100) / 100;

      items.push({
        invoice_id: invoiceId,
        line_item_id: `${invoiceId}-${j + 1}`,
        vendor,
        brand,
        product_name: `${brand} - ${productType}`,
        product_type: productType,
        sku_units: quantity,
        unit_cost: unitCost,
        total_cost: totalCost,
        total_with_excise: totalCost + excise,
        is_promo: i % 8 === 0,
        invoice_date: invoiceDate,
      } as InvoiceLineItem);
    }
  }

  return items;
})();
