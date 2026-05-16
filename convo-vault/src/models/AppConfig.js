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

// In-memory cache: { key: { values, expiresAt } }
const cache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get values for a config key (cached for 5 minutes)
 */
appConfigSchema.statics.getValues = async function (key, fallback = []) {
  const now = Date.now();
  if (cache[key] && cache[key].expiresAt > now) {
    return cache[key].values;
  }

  const doc = await this.findOne({ key }).lean();
  const values = doc?.values || fallback;

  cache[key] = { values, expiresAt: now + CACHE_TTL_MS };
  return values;
};

/**
 * Check if a value exists in a config key's list
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
 * Set (or update) the custom credit price for a location. Clears the cache so the next read sees it.
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
  delete cache[key];
};

/**
 * Clear cache for a key (or all keys)
 */
appConfigSchema.statics.clearCache = function (key) {
  if (key) {
    delete cache[key];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
  }
};

module.exports = mongoose.model('AppConfig', appConfigSchema);
