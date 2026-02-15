const fs = require('fs');
const readline = require('readline');

async function auditCrossStore() {
  const fileStream = fs.createReadStream('/Users/slimreaper/Documents/Customer_List_1770014403037.csv');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;

  // Track by email -> { BC: [...], GR: [...] }
  const byEmail = {};
  // Track by phone -> { BC: [...], GR: [...] }
  const byPhone = {};

  for await (const line of rl) {
    lineNum++;

    if (lineNum === 1) continue; // Skip header

    // Simple CSV parse
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
    const firstName = values[2];
    const lastName = values[3];
    const email = (values[4] || '').toLowerCase().trim();
    const phone = (values[5] || '').replace(/\D/g, '');
    const signupDate = values[17];
    const lastVisit = values[18];
    const transactions = parseInt(values[24]) || 0;
    const netSales = parseFloat(values[25]) || 0;

    // Skip invalid rows
    if (!storeName) continue;

    const storeKey = storeName.includes('Barbary') ? 'BC' :
                     storeName.includes('Grass') ? 'GR' : null;
    if (!storeKey) continue;

    const record = {
      customerId,
      firstName,
      lastName,
      storeName,
      storeKey,
      signupDate,
      lastVisit,
      transactions,
      netSales
    };

    // Track by email
    if (email && email.includes('@') && !email.includes('barbarycoastsf')) {
      if (!byEmail[email]) byEmail[email] = { BC: [], GR: [] };
      byEmail[email][storeKey].push(record);
    }

    // Track by phone
    if (phone && phone.length >= 10) {
      if (!byPhone[phone]) byPhone[phone] = { BC: [], GR: [] };
      byPhone[phone][storeKey].push(record);
    }

    if (lineNum % 100000 === 0) {
      console.log('Processed', lineNum, 'lines...');
    }
  }

  console.log('\n=== Cross-Store Duplicate Analysis ===\n');

  // Find email duplicates that span BOTH stores
  let crossStoreEmailCount = 0;
  const crossStoreEmailExamples = [];

  for (const [email, stores] of Object.entries(byEmail)) {
    if (stores.BC.length > 0 && stores.GR.length > 0) {
      crossStoreEmailCount++;
      if (crossStoreEmailExamples.length < 5) {
        crossStoreEmailExamples.push({ email, bc: stores.BC[0], gr: stores.GR[0] });
      }
    }
  }

  console.log('Customers with SAME EMAIL at BOTH stores:', crossStoreEmailCount);
  console.log('\nExamples:');
  for (const ex of crossStoreEmailExamples) {
    console.log(`\n  Email: ${ex.email}`);
    console.log(`    BC: ${ex.bc.firstName} ${ex.bc.lastName}, ID: ${ex.bc.customerId}, Transactions: ${ex.bc.transactions}, Sales: $${ex.bc.netSales.toFixed(2)}`);
    console.log(`    GR: ${ex.gr.firstName} ${ex.gr.lastName}, ID: ${ex.gr.customerId}, Transactions: ${ex.gr.transactions}, Sales: $${ex.gr.netSales.toFixed(2)}`);
  }

  // Find phone duplicates that span BOTH stores
  let crossStorePhoneCount = 0;
  const crossStorePhoneExamples = [];

  for (const [phone, stores] of Object.entries(byPhone)) {
    if (stores.BC.length > 0 && stores.GR.length > 0) {
      crossStorePhoneCount++;
      if (crossStorePhoneExamples.length < 5) {
        crossStorePhoneExamples.push({ phone, bc: stores.BC[0], gr: stores.GR[0] });
      }
    }
  }

  console.log('\n\nCustomers with SAME PHONE at BOTH stores:', crossStorePhoneCount);
  console.log('\nExamples:');
  for (const ex of crossStorePhoneExamples) {
    console.log(`\n  Phone: ${ex.phone}`);
    console.log(`    BC: ${ex.bc.firstName} ${ex.bc.lastName}, ID: ${ex.bc.customerId}, Transactions: ${ex.bc.transactions}`);
    console.log(`    GR: ${ex.gr.firstName} ${ex.gr.lastName}, ID: ${ex.gr.customerId}, Transactions: ${ex.gr.transactions}`);
  }

  // Find same-store duplicates by email (excluding store emails)
  let sameStoreEmailDups = 0;
  for (const [email, stores] of Object.entries(byEmail)) {
    if (stores.BC.length > 1 || stores.GR.length > 1) {
      sameStoreEmailDups++;
    }
  }
  console.log('\n\nSame-store email duplicates (same email, same store):', sameStoreEmailDups);

  // Summary
  console.log('\n=== MERGE RECOMMENDATION ===');
  console.log(`Cross-store customers (same email at both stores): ${crossStoreEmailCount}`);
  console.log(`Cross-store customers (same phone at both stores): ${crossStorePhoneCount}`);
  console.log('\nThese customers shop at BOTH stores and their records could be merged');
  console.log('to show combined lifetime value across stores.');
}

auditCrossStore().catch(console.error);
