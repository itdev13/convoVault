const mongoose = require('mongoose');

/**
 * Import Job Model - Track async import progress
 */
const importJobSchema = new mongoose.Schema({
  locationId: {
    type: String,
    required: true,
    index: true
  },
  
  fileName: {
    type: String,
    required: true
  },

  totalRows: {
    type: Number,
    default: 0
  },

  processed: {
    type: Number,
    default: 0
  },

  successful: {
    type: Number,
    default: 0
  },

  failed: {
    type: Number,
    default: 0
  },

  skipped: {
    type: Number,
    default: 0
  },

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },

  importErrors: [{
    row: Number,
    error: String,
    data: Object
  }],

  startedAt: Date,
  completedAt: Date

}, {
  timestamps: true,
  suppressReservedKeysWarning: true // Suppress warnings for compatibility
});

// Get recent jobs for a location
importJobSchema.statics.getRecentJobs = async function(locationId, limit = 10) {
  return await this.find({ locationId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

module.exports = mongoose.model('ImportJob', importJobSchema);

