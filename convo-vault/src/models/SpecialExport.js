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
    required: false,
    index: true
  },
  locationId: {
    type: String,
    required: true,
    index: true
  },
  // For chunked exports: all chunk docs share the same groupId (= _id of chunk 0)
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  chunkIndex: {
    type: Number,
    default: 0
  },
  totalChunks: {
    type: Number,
    default: 1
  },
  messages: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  // Dedicated field for the callTranscriptions export type — keeps these distinct from the
  // specialTabMessages records that live under `messages` and removes any naming ambiguity.
  callTranscriptionsMessages: {
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
  // Opportunity Stage History pricing inputs. We bill (opps + messages), not stage-rows,
  // so the confirm-step needs both counts persisted from /estimate to re-derive the charge
  // without re-walking GHL.
  totalOpportunities: {
    type: Number,
    default: 0
  },
  totalChannelMessages: {
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
