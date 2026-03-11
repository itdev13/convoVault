const mongoose = require('mongoose');

/**
 * Referral Schema
 * Tracks influencer referrals — which installs came from which influencer
 */
const referralSchema = new mongoose.Schema({
  // Referral code (unique per influencer, e.g. "john", "sarah_yt")
  referralCode: {
    type: String,
    required: true,
    index: true
  },

  // Influencer details
  influencer: {
    name: { type: String },
    email: { type: String },
    platform: { type: String },  // youtube, instagram, tiktok, etc.
    notes: { type: String }
  },

  // GHL install details
  companyId: {
    type: String,
    index: true
  },

  locationId: {
    type: String,
    index: true
  },

  // Campaign info (optional, encoded in state param)
  campaign: {
    type: String
  },

  // Status
  status: {
    type: String,
    enum: ['installed', 'uninstalled'],
    default: 'installed'
  },

  // Revenue tracking
  totalCharges: {
    type: Number,
    default: 0
  },

  totalExports: {
    type: Number,
    default: 0
  },

  installedAt: {
    type: Date,
    default: Date.now
  },

  uninstalledAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compound index for lookups
referralSchema.index({ referralCode: 1, status: 1 });
referralSchema.index({ companyId: 1, locationId: 1 });

/**
 * Get stats grouped by influencer
 */
referralSchema.statics.getInfluencerStats = async function() {
  return await this.aggregate([
    {
      $group: {
        _id: '$referralCode',
        influencer: { $first: '$influencer' },
        totalInstalls: { $sum: 1 },
        activeInstalls: {
          $sum: { $cond: [{ $eq: ['$status', 'installed'] }, 1, 0] }
        },
        uninstalls: {
          $sum: { $cond: [{ $eq: ['$status', 'uninstalled'] }, 1, 0] }
        },
        totalRevenue: { $sum: '$totalCharges' },
        totalExports: { $sum: '$totalExports' },
        firstInstall: { $min: '$installedAt' },
        lastInstall: { $max: '$installedAt' }
      }
    },
    { $sort: { totalInstalls: -1 } }
  ]);
};

/**
 * Find referral by location
 */
referralSchema.statics.findByLocation = async function(locationId) {
  return await this.findOne({ locationId, status: 'installed' });
};

/**
 * Find referral by company
 */
referralSchema.statics.findByCompany = async function(companyId) {
  return await this.findOne({ companyId, status: 'installed' });
};

/**
 * Increment revenue for a location's referral
 */
referralSchema.statics.addRevenue = async function(locationId, amount, exports = 1) {
  return await this.findOneAndUpdate(
    { locationId, status: 'installed' },
    {
      $inc: {
        totalCharges: amount,
        totalExports: exports
      }
    }
  );
};

module.exports = mongoose.model('Referral', referralSchema);
