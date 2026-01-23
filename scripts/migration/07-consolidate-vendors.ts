/**
 * Consolidate Vendor Duplicates
 *
 * Merges duplicate vendors and applies DBA relationships.
 * Run with: npx tsx scripts/migration/07-consolidate-vendors.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface VendorEntry {
  canonicalName: string;
  aliases: string[];
  invoiceCount: number;
}

interface VendorMapping {
  _instructions?: string;
  _generated?: string;
  vendors: VendorEntry[];
}

// Define consolidation rules: canonical name -> patterns to match
const consolidationRules: Record<string, RegExp[]> = {
  // Nabis family (Nabitwo, Nabione, Nabifive, etc.)
  'NABIS': [
    /^NABI(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)/i,
    /^NABIS/i,
  ],

  // Kiva
  'KIVA SALES & SERVICE': [/^KIVA\s*(SALES)?/i],

  // Barbary Coast
  'BARBARY COAST': [/^BARBARY\s*COAST/i],

  // Integral Innovations
  'INTEGRAL INNOVATIONS': [/^INTEGRAL\s*INNOVATIONS/i],

  // Northwest Confections
  'NORTHWEST CONFECTIONS': [/^NORTHWEST\s*CONFECTIONS/i],

  // Herbl
  'HERBL': [/^HERBL/i],

  // Greenfield Organix / Loudpack
  'GREENFIELD ORGANIX': [/^GREENFIELD\s*ORGANIX/i, /LOUDPACK/i],

  // Big Pete's
  "BIG PETE'S": [/^BIG\s*PETE'?S/i],

  // Calyx Brands
  'CALYX BRANDS': [/^CALYX\s*BRANDS/i],

  // Kind House
  'KIND HOUSE': [/^KIND\s*HOUSE/i],

  // Upnorth Distribution
  'UPNORTH DISTRIBUTION': [/^UP\s*NORTH/i],

  // River Distributing
  'RIVER DISTRIBUTING CO.': [/^RIVER\s*DISTRIBUTING/i],

  // Heshies
  'HESHIES': [/^HESHIES/i],

  // DT California
  'DT CALIFORNIA': [/^DT\s*CALIFORNIA/i],

  // Golden Gate Gen
  'GOLDEN GATE GEN': [/^GOLDEN\s*GATE\s*GEN/i],

  // Yerba Buena Logistics
  'YERBA BUENA LOGISTICS': [/^YERBA\s*BUENA/i],

  // Cypress Manufacturing
  'CYPRESS MANUFACTURING': [/^CYPRESS\s*MANUFACTURING/i],

  // Fluids Manufacturing
  'FLUIDS MANUFACTURING': [/^FLUIDS\s*MANUFACTURING/i],

  // Humboldt Growers Network
  'HUMBOLDT GROWERS NETWORK': [/^HUMBOLDT\s*GROWERS/i],

  // Strong Agronomy
  'STRONG AGRONOMY MANAGEMENT': [/^STRONG\s*AGRONOMY/i],

  // Highstar Distribution
  'HIGHSTAR DISTRIBUTION': [/^HIGHSTAR/i],

  // Creme de Canna
  'CREME DE CANNA': [/^CREME\s*DE\s*CANNA/i],

  // Jetty Extracts (including Ametrine Wellness DBA)
  'JETTY EXTRACTS': [/JETTY\s*EXTRACTS/i, /^AMETRINE\s*WELLNESS/i],

  // Grizzly Peak Farms
  'GRIZZLY PEAK FARMS': [/^GRIZZLY\s*PEAK/i],

  // Emerald Bay Wellness
  'EMERALD BAY WELLNESS': [/^EMERALD\s*BAY\s*WELLNESS/i],

  // Bloom Farms (including Loyal Distribution DBA)
  'BLOOM FARMS': [/BLOOM\s*FARMS/i, /^LOYAL\s*DISTRIBUTION/i, /^CALIFORNIA\s*LOYAL/i],

  // Industrial Court L11
  'INDUSTRIAL COURT L11': [/^INDUSTRIAL\s*COURT/i],

  // Adira Distribution
  'ADIRA DISTRIBUTION': [/^ADIRA/i],

  // Beezle
  'BEEZLE EXTRACTS': [/^BEEZLE/i],

  // Michael Toth
  'MICHAEL TOTH': [/^MICHAEL\s*TOTH/i],

  // Fields Performance
  'FIELDS PERFORMANCE': [/^FIELDS\s*PERFORMANCE/i],

  // Fordoak Operations
  'FORDOAK OPERATIONS': [/^FORDOAK/i],

  // CI Distribution
  'CI DISTRIBUTION': [/^CI\s*DISTRIBUTION/i],

  // Sunderstorm Bay
  'SUNDERSTORM BAY': [/^SUNDERSTORM/i],

  // Event Horizon Technologies
  'EVENT HORIZON TECHNOLOGIES': [/^EVENT\s*HORIZON/i],

  // New Age Compassion Care Center
  'NEW AGE COMPASSION CARE CENTER': [/^NEW\s*AGE\s*COMPASSION/i],

  // Elevation Wellness
  'ELEVATION WELLNESS CENTER': [/^ELEVATION\s*WELLNESS/i],

  // Connected Management
  'CONNECTED MANAGEMENT': [/^CONNECTED\s*MANAGEMENT/i],

  // Irrational Raccoon / Filigreen
  'FILIGREEN DISTRO': [/^FILIGREEN/i, /IRRATIONAL\s*RACCOON/i],

  // Sonoma Pacific
  'SONOMA PACIFIC DISTRIBUTION': [/^SONOMA\s*PACIFIC/i],

  // Bud Technology
  'BUD TECHNOLOGY': [/^BUD\s*TECHNOLOGY/i],

  // Highland Park Patient Collective
  'HIGHLAND PARK PATIENT COLLECTIVE': [/^HIGHLAND\s*PARK/i],

  // GCM Management Services
  'GCM MANAGEMENT SERVICES': [/^GCM\s*MANAGEMENT/i],

  // Clearview Management
  'CLEARVIEW MANAGEMENT SOLUTIONS': [/^CLEARVIEW/i],

  // E&J Distributors
  'E&J DISTRIBUTORS': [/^E\s*&\s*J\s*DISTRIBUTORS/i],

  // NMC Organization / Greenstone Distribution
  'NMC ORGANIZATION': [/^NMC\s*ORGANIZATION/i, /GREENSTONE\s*DISTRIBUTION/i],

  // Mother Humboldt
  'MOTHER HUMBOLDT': [/^MOTHER\s*HUMBOLDT/i],

  // Conscious Mindz
  'CONSCIOUS MINDZ CANNABIS COMPANY': [/^CONSCIOUS\s*MINDZ/i],

  // Vertical Bliss
  'VERTICAL BLISS': [/^VERTICAL\s*BLISS/i],

  // GF Distribution
  'GF DISTRIBUTION': [/^GF\s*DISTRIBUTION/i],

  // HMC Partners
  'HMC PARTNERS': [/^HMC\s*PARTNERS/i],

  // P&S Ventures
  'P&S VENTURES': [/^P\s*&?\s*S\s*VENTURES/i],

  // The Team Handed Corporation
  'THE TEAM HANDED CORPORATION': [/^THE\s*TEAM\s*HANDED/i],

  // Highrize
  'HIGHRIZE': [/^HIGH\s*RIZE?/i],

  // Cann Distributors
  'CANN DISTRIBUTORS': [/^CANN\s*DISTRIBUT/i],

  // Alkhemist DM
  'ALKHEMIST DM': [/^ALKHEMIST/i],

  // Liquid Shade
  'LIQUID SHADE': [/^LIQUID\s*SHADE/i],

  // Atwater Commerce
  'ATWATER COMMERCE': [/^ATWATER/i],

  // Sublime Machining
  'SUBLIME': [/^SUBLIME/i],

  // RC Global
  'RC GLOBAL': [/^RC\s*GLOBAL/i],

  // Promontory Holdings
  'PROMONTORY HOLDINGS': [/^PROMONTORY/i],

  // WCC Mgmt
  'WCC MGMT': [/^WCC\s*MGMT/i],

  // Boutique Unlimited Distribution
  'BOUTIQUE UNLIMITED DISTRIBUTION': [/^BOUTIQUE\s*UNLIMITED/i],

  // Echsen Industries
  'ECHSEN INDUSTRIES': [/^ECHSEN/i],

  // Synergy Cannabis
  'SYNERGY CANNABIS': [/^SYNERGY/i],

  // LVLUP Distribution
  'LVLUP DISTRIBUTION': [/^LVLUP/i],

  // Fountain of Wellbeing
  'FOUNTAIN OF WELLBEING': [/^FOUNTAIN\s*OF\s*WELLBEING/i],

  // Crafted Canopy
  'CRAFTED CANOPY CO.': [/^CRAFTED\s*CANOPY/i],

  // Tarhill
  'TARHILL CANNABIS': [/^TAR\s*HILL/i],

  // EFW Health / Echo Distribution
  'EFW HEALTH': [/^EFW\s*HEALTH/i, /ECHO\s*DISTRIBUTION/i],

  // Eel River
  'EEL RIVER ORGANICS': [/^EEL\s*RIVER/i],

  // Caliva
  'CALIVA': [/^CALIVA/i],

  // Marijuana Packaging
  'MARIJUANA PACKAGING': [/^MARIJUANA\s*PACKAGING/i],

  // ASV EQ1
  'ASV EQ1': [/^ASV\s*EQ\s*1?/i],

  // Dragonfish Farms
  'DRAGONFISH FARMS': [/^DRAGON\s*FISH/i],

  // Skygrades
  'SKYGRADES': [/^SKY\s*GRADES?/i],

  // Orange-U-Glad
  'ORANGE-U-GLAD': [/^ORANGE\s*U?\s*GLAD/i],
};

function matchesRule(name: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

async function main() {
  console.log('========================================');
  console.log('Vendor Consolidation');
  console.log('========================================\n');

  const templatePath = path.join(process.cwd(), 'config', 'vendor_mapping_template.json');
  const data: VendorMapping = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

  // Map to hold consolidated vendors
  const consolidated: Map<string, VendorEntry> = new Map();

  // Track which vendors get consolidated
  let consolidatedCount = 0;
  let skippedUnknown = 0;

  for (const vendor of data.vendors) {
    // Skip UNKNOWN
    if (vendor.canonicalName === 'UNKNOWN') {
      skippedUnknown++;
      continue;
    }

    // Check if this vendor matches any consolidation rule
    let matchedCanonical: string | null = null;
    for (const [canonical, patterns] of Object.entries(consolidationRules)) {
      if (matchesRule(vendor.canonicalName, patterns)) {
        matchedCanonical = canonical;
        break;
      }
      // Also check aliases
      for (const alias of vendor.aliases) {
        if (matchesRule(alias, patterns)) {
          matchedCanonical = canonical;
          break;
        }
      }
      if (matchedCanonical) break;
    }

    if (matchedCanonical) {
      // Consolidate into existing or create new entry
      if (consolidated.has(matchedCanonical)) {
        const existing = consolidated.get(matchedCanonical)!;
        // Add this vendor's name and aliases to the consolidated entry
        if (vendor.canonicalName !== matchedCanonical) {
          existing.aliases.push(vendor.canonicalName);
        }
        existing.aliases.push(...vendor.aliases.filter((a) => a !== matchedCanonical));
        existing.invoiceCount += vendor.invoiceCount;
        consolidatedCount++;
      } else {
        // Create new consolidated entry
        const allAliases = [vendor.canonicalName, ...vendor.aliases].filter(
          (a) => a !== matchedCanonical
        );
        consolidated.set(matchedCanonical, {
          canonicalName: matchedCanonical,
          aliases: allAliases,
          invoiceCount: vendor.invoiceCount,
        });
      }
    } else {
      // No consolidation rule matches, keep as-is
      consolidated.set(vendor.canonicalName, vendor);
    }
  }

  // Convert to array and sort by invoice count
  const vendors = Array.from(consolidated.values()).sort(
    (a, b) => b.invoiceCount - a.invoiceCount
  );

  // Deduplicate aliases within each vendor
  for (const v of vendors) {
    v.aliases = [...new Set(v.aliases)];
  }

  // Write consolidated mapping
  const output: VendorMapping = {
    _instructions:
      'Consolidated vendor mapping. Edit canonicalName to change display name. Add/remove aliases as needed.',
    _generated: new Date().toISOString(),
    vendors,
  };

  const outputPath = path.join(process.cwd(), 'config', 'vendor_mapping_consolidated.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`Original vendors: ${data.vendors.length}`);
  console.log(`Skipped UNKNOWN: ${skippedUnknown}`);
  console.log(`Consolidated into: ${vendors.length} canonical vendors`);
  console.log(`Merges performed: ${consolidatedCount}`);
  console.log(`\nOutput: ${outputPath}`);

  // Show top 15 consolidated vendors
  console.log('\nTop 15 vendors by invoice count:');
  vendors.slice(0, 15).forEach((v, i) => {
    const aliasCount = v.aliases.length > 0 ? ` (${v.aliases.length} aliases)` : '';
    console.log(`  ${i + 1}. ${v.canonicalName} - ${v.invoiceCount} invoices${aliasCount}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
