const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * PricingRequest — captures a customer's request for a custom per-credit price for their location.
 *
 * Flow:
 *   1. Customer submits from the estimate modal (when finalAmount > $30)
 *   2. If `expectedVolume >= 10000`, auto-approve at the proposed rate (no floor) — applies immediately
 *   3. If `expectedVolume < 10000`, save as `pending`, email internal team for manual approval
 *   4. Manual approval via one-click email link (token-protected)
 */
const pricingRequestSchema = new mongoose.Schema({
  locationId: { type: String, required: true, index: true },
  companyId:  { type: String, default: null },
  email:      { type: String, required: true },
  proposedCreditPrice: { type: Number, required: true },
  expectedVolume: { type: Number, required: true },
  reason:     { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'auto-approved', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  approvalToken: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(24).toString('hex'),
    index: true
  },
  decidedAt:  { type: Date, default: null },
  decidedBy:  { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PricingRequest', pricingRequestSchema);
