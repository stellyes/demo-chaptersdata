const fs = require('fs');
const readline = require('readline');

async function audit() {
  const fileStream = fs.createReadStream('/Users/slimreaper/Documents/Customer_List_1770014403037.csv');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = [];
  let lineNum = 0;

  // Track duplicates - use simple objects for memory efficiency
  const emailCounts = {};
  const phoneCounts = {};
  const customerIdCounts = {};

  let validRows = 0;
  let invalidRows = 0;

  for await (const line of rl) {
    lineNum++;

    if (lineNum === 1) {
      // Parse headers
      headers = line.replace(/^\uFEFF/, '').split(',').map(h => h.replace(/"/g, '').trim());
      continue;
    }

    // Simple CSV parse (handle quoted fields)
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
    const email = (values[4] || '').toLowerCase().trim();
    const phone = (values[5] || '').replace(/\D/g, '');

    // Skip invalid rows
    if (!storeName || (!storeName.includes('Barbary') && !storeName.includes('Grass'))) {
      invalidRows++;
      continue;
    }
    validRows++;

    // Track Customer ID per store
    const cidKey = storeName.substring(0, 1) + '_' + customerId;
    customerIdCounts[cidKey] = (customerIdCounts[cidKey] || 0) + 1;

    // Track email duplicates
    if (email && email.includes('@')) {
      emailCounts[email] = (emailCounts[email] || 0) + 1;
    }

    // Track phone duplicates
    if (phone && phone.length >= 10) {
      phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
    }

    if (lineNum % 100000 === 0) {
      console.log('Processed', lineNum, 'lines...');
    }
  }

  console.log('\n=== Audit Results ===');
  console.log('Total lines:', lineNum - 1);
  console.log('Valid rows:', validRows);
  console.log('Invalid/corrupted rows:', invalidRows);

  // Count duplicates
  let cidDups = 0, cidDupRecords = 0;
  let emailDups = 0, emailDupRecords = 0;
  let phoneDups = 0, phoneDupRecords = 0;

  for (const [key, count] of Object.entries(customerIdCounts)) {
    if (count > 1) {
      cidDups++;
      cidDupRecords += count;
    }
  }

  for (const [key, count] of Object.entries(emailCounts)) {
    if (count > 1) {
      emailDups++;
      emailDupRecords += count;
    }
  }

  for (const [key, count] of Object.entries(phoneCounts)) {
    if (count > 1) {
      phoneDups++;
      phoneDupRecords += count;
    }
  }

  console.log('\n--- Duplicate Summary ---');
  console.log('Same Customer ID (per store):', cidDups, 'groups,', cidDupRecords, 'total records');
  console.log('Same Email:', emailDups, 'groups,', emailDupRecords, 'total records');
  console.log('Same Phone:', phoneDups, 'groups,', phoneDupRecords, 'total records');

  // Show top duplicate emails
  console.log('\n--- Top Email Duplicates ---');
  const topEmails = Object.entries(emailCounts)
    .filter(([e, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [email, count] of topEmails) {
    console.log(`  ${email}: ${count} records`);
  }

  // Show top duplicate phones
  console.log('\n--- Top Phone Duplicates ---');
  const topPhones = Object.entries(phoneCounts)
    .filter(([p, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [phone, count] of topPhones) {
    console.log(`  ${phone}: ${count} records`);
  }
}

audit().catch(console.error);
