/**
 * Enable (or disable) the Opportunity Stage History tab for a specific location.
 *
 * Usage:
 *   node scripts/enable-opportunity-stage-export.js add <locationId>
 *   node scripts/enable-opportunity-stage-export.js remove <locationId>
 *   node scripts/enable-opportunity-stage-export.js list
 *
 * Backed by AppConfig key `opportunityStageExportLocations`.
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const database = require('../src/config/database');
const AppConfig = require('../src/models/AppConfig');

const KEY = 'opportunityStageExportLocations';

async function main() {
  const [action, locationId] = process.argv.slice(2);
  if (!action || !['add', 'remove', 'list'].includes(action)) {
    console.error('Usage: node scripts/enable-opportunity-stage-export.js <add|remove|list> [locationId]');
    process.exit(1);
  }
  if ((action === 'add' || action === 'remove') && !locationId) {
    console.error(`Missing locationId for "${action}"`);
    process.exit(1);
  }

  await database.connect();

  if (action === 'list') {
    const values = await AppConfig.getValues(KEY);
    console.log(`Allowed location(s) for opportunityStageHistory:`);
    if (values.length === 0) console.log('  (none)');
    else values.forEach(v => console.log(`  - ${v}`));
  } else if (action === 'add') {
    const doc = await AppConfig.findOneAndUpdate(
      { key: KEY },
      { $addToSet: { values: locationId }, $setOnInsert: { description: 'Locations gated for Opportunity Stage History export' } },
      { new: true, upsert: true }
    );
    AppConfig.clearCache(KEY);
    console.log(`✓ Added ${locationId}. Current list: ${doc.values.join(', ')}`);
  } else if (action === 'remove') {
    const doc = await AppConfig.findOneAndUpdate(
      { key: KEY },
      { $pull: { values: locationId } },
      { new: true }
    );
    AppConfig.clearCache(KEY);
    console.log(`✓ Removed ${locationId}. Current list: ${(doc?.values || []).join(', ') || '(none)'}`);
  }

  await database.disconnect();
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
