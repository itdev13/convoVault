const mongoose = require('mongoose');

/**
 * Simple OAuth Token Model
 */
const oauthTokenSchema = new mongoose.Schema({
  locationId: {
    type: String,
    required: false, // Not required for company-level tokens
    index: true
  },
  
  companyId: {
    type: String,
    required: true,
    index: true
  },

  // Token type: 'location' or 'company'
  tokenType: {
    type: String,
    enum: ['location', 'company'],
    required: true,
    default: 'location'
  },

  // Sub-Account metadata
  locationName: {
    type: String,
    default: null
  },

  locationEmail: {
    type: String,
    default: null
  },

  locationPhone: {
    type: String,
    default: null
  },

  locationAddress: {
    type: String,
    default: null
  },

  locationWebsite: {
    type: String,
    default: null
  },

  locationTimezone: {
    type: String,
    default: null
  },

  accessToken: {
    type: String,
    required: true
  },

  refreshToken: {
    type: String,
    required: true
  },

  expiresAt: {
    type: Date,
    required: true
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // Installer (the GHL user who authorized OAuth). Captured once at install time so we can
  // reach out on uninstall with a win-back email. Email is fetched via GET /users/{userId}
  // shortly after the OAuth callback finishes; if the call fails these stay null.
  installerUserId: { type: String, default: null },
  installerEmail: { type: String, default: null },
  installerName:  { type: String, default: null }
}, {
  timestamps: true
});

// Check if token needs refresh (expires in < 5 minutes)
oauthTokenSchema.methods.needsRefresh = function() {
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  return fiveMinutesFromNow >= this.expiresAt;
};

// Find active token for sub-account
oauthTokenSchema.statics.findActiveToken = async function(locationId) {
  return await this.findOne({ 
    locationId, 
    isActive: true 
  });
};

// Find active company token
oauthTokenSchema.statics.findActiveCompanyToken = async function(companyId) {
  return await this.findOne({ 
    companyId,
    tokenType: 'company',
    isActive: true 
  });
};

// Find all sub-account tokens for a company
oauthTokenSchema.statics.findCompanyLocations = async function(companyId) {
  return await this.find({ 
    companyId,
    tokenType: 'location',
    isActive: true 
  });
};

module.exports = mongoose.model('OAuthToken', oauthTokenSchema);

