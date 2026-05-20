const mongoose = require('mongoose');

/**
 * AppConfig — key-value store for app-wide settings that can be updated without redeploying.
 *
 * Usage:
 *   // In MongoDB, one document per key:
 *   { key: "internalTestingCompanyIds", values: ["PG9VJ27Q...", "7IlT9P1b..."] }
 *
 *   // In code:
 *   const ids = await AppConfig.getValues('internalTestingCompanyIds');
 *
 * Note: there is no in-memory cache — every read goes straight to MongoDB. This gives instant
 * propagation when a value is changed (no 5-minute lag) at the cost of one query per read.
 * AppConfig reads are infrequent (a handful per export run) so the extra query cost is negligible.
 */
const appConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  values: {
    type: [String],
    default: []
  },
  description: {
    type: String,
    default: ''
  }
}, { timestamps: true });

/**
 * Get values for a config key. Falls back to `fallback` when the doc doesn't exist.
 */
appConfigSchema.statics.getValues = async function (key, fallback = []) {
  const doc = await this.findOne({ key }).lean();
  return doc?.values || fallback;
};

/**
 * Check if a value exists in a config key's list.
 */
appConfigSchema.statics.hasValue = async function (key, value) {
  const values = await this.getValues(key);
  return values.includes(value);
};

/**
 * Per-location custom credit price. Stored as `locationCreditPrice:<locationId>` → values:[priceAsString].
 * Returns a positive number when an override exists for this location, otherwise null.
 */
appConfigSchema.statics.getLocationCreditPrice = async function (locationId) {
  if (!locationId) return null;
  const values = await this.getValues(`locationCreditPrice:${locationId}`);
  if (!values || values.length === 0) return null;
  const price = parseFloat(values[0]);
  return Number.isFinite(price) && price > 0 ? price : null;
};

/**
 * Set (or update) the custom credit price for a location.
 */
appConfigSchema.statics.setLocationCreditPrice = async function (locationId, price) {
  if (!locationId) throw new Error('locationId required');
  const numeric = parseFloat(price);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('price must be a positive number');
  const key = `locationCreditPrice:${locationId}`;
  await this.findOneAndUpdate(
    { key },
    { key, values: [String(numeric)], description: `Custom credit price for location ${locationId}` },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('AppConfig', appConfigSchema);
