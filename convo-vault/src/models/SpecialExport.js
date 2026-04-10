const mongoose = require('mongoose');

/**
 * SpecialExport — stores pre-fetched messages for specialTabMessages exports.
 *
 * Flow:
 *   1. Backend fetches all conversations + messages via GHL API
 *   2. Saves them here grouped by exportJobId + locationId
 *   3. Lambda reads from this collection instead of calling GHL API again
 */
const specialExportSchema = new mongoose.Schema({
  exportJobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExportJob',
    required: true,
    index: true
  },
  locationId: {
    type: String,
    required: true,
    index: true
  },
  messages: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  totalMessages: {
    type: Number,
    default: 0
  },
  totalConversations: {
    type: Number,
    default: 0
  },
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['fetching', 'ready', 'exported', 'failed'],
    default: 'fetching'
  },
  errorMessage: {
    type: String,
    default: null
  }
}, { timestamps: true });

// TTL: auto-delete after 7 days
specialExportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('SpecialExport', specialExportSchema);
