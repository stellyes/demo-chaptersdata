const fs = require('fs');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Helper to parse date string "YYYY-MM-DD HH:MM:SS" -> Date
function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const date = new Date(dateStr.split(' ')[0]);
  return isNaN(date.getTime()) ? null : date;
}

// Determine customer segment based on lifetime value
function getCustomerSegment(netSales, transactions) {
  if (transactions === 0) return 'New/Low';
  if (netSales >= 5000) return 'Whale';
  if (netSales >= 2000) return 'VIP';
  if (netSales >= 500) return 'Regular';
  if (netSales >= 100) return 'Occasional';
  return 'New/Low';
}

// Determine recency segment based on last visit
function getRecencySegment(lastVisitDate) {
  if (!lastVisitDate) return 'Never';
  const daysSince = Math.floor((new Date() - lastVisitDate) / (1000 * 60 * 60 * 24));
  if (daysSince <= 7) return 'This Week';
  if (daysSince <= 30) return 'This Month';
  if (daysSince <= 90) return 'This Quarter';
  if (daysSince <= 365) return 'This Year';
  return 'Lapsed';
}

async function importCustomers() {
  console.log('Starting customer import with merge logic...\n');

  const fileStream = fs.createReadStream('/Users/slimreaper/Documents/Customer_List_1770014403037.csv');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;

  // Track customers by email (primary dedup key)
  // email -> merged record
  const customersByEmail = new Map();
  // For customers without email, use phone
  const customersByPhone = new Map();
  // For customers with neither, use store+ID
  const customersNoContact = new Map();

  let totalProcessed = 0;
  let invalidRows = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // Skip header

    // Parse CSV line
    const values = [];
    let inQuote = false;
    let field = '';
    for (const char of line) {
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        values.push(field.trim());
        field = '';
      } else {
        field += char;
      }
    }
    values.push(field.trim());

    const storeName = values[0];
    const customerId = values[1];
    const firstName = values[2] || '';
    const lastName = values[3] || '';
    const email = (values[4] || '').toLowerCase().trim();
    const phone = (values[5] || '').replace(/\D/g, '');
    const dob = values[8];
    const signupDate = values[17];
    const lastVisit = values[18];
    const visits = parseInt(values[23]) || 0;
    const transactions = parseInt(values[24]) || 0;
    const netSales = parseFloat(values[25]) || 0;
    const aov = parseFloat(values[28]) || 0;

    // Skip invalid rows
    if (!storeName || (!storeName.includes('Barbary') && !storeName.includes('Grass'))) {
      invalidRows++;
      continue;
    }

    // Skip "Canceled Signup" entries with no real data
    if (firstName === 'Canceled' && lastName === 'Signup') {
      invalidRows++;
      continue;
    }

    totalProcessed++;

    const record = {
      customerId,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      storeName,
      email,
      phone,
      dateOfBirth: parseDate(dob),
      signupDate: parseDate(signupDate),
      lastVisitDate: parseDate(lastVisit),
      lifetimeVisits: visits,
      lifetimeTransactions: transactions,
      lifetimeNetSales: netSales,
      lifetimeAov: aov,
      stores: [storeName]
    };

    // Deduplication logic
    // Priority: email > phone > store+ID
    const isValidEmail = email && email.includes('@') && !email.includes('barbarycoastsf');
    const isValidPhone = phone && phone.length >= 10;

    if (isValidEmail) {
      if (customersByEmail.has(email)) {
        // Merge with existing record
        const existing = customersByEmail.get(email);
        mergeRecords(existing, record);
      } else {
        customersByEmail.set(email, record);
      }
    } else if (isValidPhone) {
      if (customersByPhone.has(phone)) {
        const existing = customersByPhone.get(phone);
        mergeRecords(existing, record);
      } else {
        customersByPhone.set(phone, record);
      }
    } else {
      // No email or phone - use store+ID as unique key
      const key = `${storeName}|${customerId}`;
      if (!customersNoContact.has(key)) {
        customersNoContact.set(key, record);
      }
    }

    if (lineNum % 100000 === 0) {
      console.log(`Processed ${lineNum} lines...`);
    }
  }

  console.log(`\nProcessed ${totalProcessed} valid rows, skipped ${invalidRows} invalid rows`);
  console.log(`Unique customers by email: ${customersByEmail.size}`);
  console.log(`Unique customers by phone (no email): ${customersByPhone.size}`);
  console.log(`Unique customers with no contact: ${customersNoContact.size}`);

  // Combine all customers
  const allCustomers = [
    ...customersByEmail.values(),
    ...customersByPhone.values(),
    ...customersNoContact.values()
  ];

  console.log(`\nTotal unique customers after merge: ${allCustomers.length}`);

  // Count cross-store customers
  const crossStore = allCustomers.filter(c => c.stores.length > 1).length;
  console.log(`Cross-store customers (merged): ${crossStore}`);

  // Prepare for database insert
  console.log('\nPreparing database records...');

  const dbRecords = allCustomers.map((c, idx) => {
    // For cross-store customers, use "Combined" or pick primary store
    let finalStoreName = c.storeName;
    if (c.stores.length > 1) {
      // Use store with more transactions, or keep original if equal
      finalStoreName = c.storeName; // Keep the first one encountered
    }

    // Calculate segments
    const customerSegment = getCustomerSegment(c.lifetimeNetSales, c.lifetimeTransactions);
    const recencySegment = getRecencySegment(c.lastVisitDate);

    // Recalculate AOV if we merged
    const calculatedAov = c.lifetimeTransactions > 0
      ? c.lifetimeNetSales / c.lifetimeTransactions
      : 0;

    return {
      customerId: c.email || c.phone || `${c.storeName.substring(0, 1)}_${c.customerId}`,
      storeName: finalStoreName,
      name: c.name || null,
      dateOfBirth: c.dateOfBirth,
      age: c.dateOfBirth ? Math.floor((new Date() - c.dateOfBirth) / (1000 * 60 * 60 * 24 * 365.25)) : null,
      lifetimeVisits: c.lifetimeVisits,
      lifetimeTransactions: c.lifetimeTransactions,
      lifetimeNetSales: c.lifetimeNetSales,
      lifetimeAov: calculatedAov,
      signupDate: c.signupDate,
      lastVisitDate: c.lastVisitDate,
      customerSegment,
      recencySegment
    };
  });

  console.log(`Prepared ${dbRecords.length} records for insert\n`);

  // Insert in batches
  const BATCH_SIZE = 5000;
  let inserted = 0;

  for (let i = 0; i < dbRecords.length; i += BATCH_SIZE) {
    const batch = dbRecords.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.customer.createMany({
        data: batch,
        skipDuplicates: true
      });
      inserted += result.count;
      console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.count} records (total: ${inserted})`);
    } catch (error) {
      console.error(`Error inserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Total records inserted: ${inserted}`);

  // Verify
  const count = await prisma.customer.count();
  console.log(`Database customer count: ${count}`);

  // Check date ranges
  const stats = await prisma.customer.aggregate({
    _min: { signupDate: true, lastVisitDate: true },
    _max: { signupDate: true, lastVisitDate: true }
  });
  console.log(`Signup date range: ${stats._min.signupDate?.toISOString().split('T')[0]} to ${stats._max.signupDate?.toISOString().split('T')[0]}`);
  console.log(`Last visit range: ${stats._min.lastVisitDate?.toISOString().split('T')[0]} to ${stats._max.lastVisitDate?.toISOString().split('T')[0]}`);

  // Check Jan 2026 customers
  const jan2026 = await prisma.customer.count({
    where: {
      lastVisitDate: {
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31')
      }
    }
  });
  console.log(`Customers with last visit in Jan 2026: ${jan2026}`);

  await prisma.$disconnect();
}

// Merge two records representing the same person
function mergeRecords(existing, newRecord) {
  // Combine stores
  if (!existing.stores.includes(newRecord.storeName)) {
    existing.stores.push(newRecord.storeName);
  }

  // Sum lifetime stats
  existing.lifetimeVisits += newRecord.lifetimeVisits;
  existing.lifetimeTransactions += newRecord.lifetimeTransactions;
  existing.lifetimeNetSales += newRecord.lifetimeNetSales;

  // Take earliest signup date
  if (newRecord.signupDate && (!existing.signupDate || newRecord.signupDate < existing.signupDate)) {
    existing.signupDate = newRecord.signupDate;
  }

  // Take most recent last visit date
  if (newRecord.lastVisitDate && (!existing.lastVisitDate || newRecord.lastVisitDate > existing.lastVisitDate)) {
    existing.lastVisitDate = newRecord.lastVisitDate;
  }

  // Take DOB if missing
  if (!existing.dateOfBirth && newRecord.dateOfBirth) {
    existing.dateOfBirth = newRecord.dateOfBirth;
  }

  // Update name if current is empty
  if (!existing.name && newRecord.name) {
    existing.name = newRecord.name;
  }
}

importCustomers().catch(console.error);
