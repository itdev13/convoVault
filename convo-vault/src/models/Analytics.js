const mongoose = require('mongoose');

/**
 * Lightweight Analytics Model
 * Tracks basic usage metrics without storing heavy data
 */
const analyticsSchema = new mongoose.Schema({
  locationId: {
    type: String,
    required: true,
    index: true
  },
  
  userId: {
    type: String,
    required: true,
    index: true
  },

  // Event type
  eventType: {
    type: String,
    enum: [
      // Page views
      'app_opened',
      
      // Feature usage
      'conversation_downloaded',
      'conversation_viewed',
      'messages_exported',
      'csv_imported',
      
      // API usage
      'api_docs_opened',
      
      // Tab switches
      'tab_switched',
      
      // Support
      'support_ticket_submitted'
    ],
    required: true,
    index: true
  },

  // Minimal metadata (keep it light!)
  metadata: {
    tabName: String,        // For tab_switched
    exportFormat: String,   // For messages_exported (CSV, JSON, etc.)
    recordCount: Number,    // For imports/exports
    conversationId: String  // For conversation_viewed
  },

  // Session info
  sessionId: String, // Simple session tracking

  // Auto-expire after 90 days
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 7776000 // 90 days TTL
  }
}, {
  timestamps: false // Save space - only createdAt needed
});

// Indexes for analytics queries
analyticsSchema.index({ locationId: 1, eventType: 1, createdAt: -1 });
// Note: createdAt already has a TTL index via `expires` in the schema field definition

// Static methods for analytics

/**
 * Track an event (simple insert)
 */
analyticsSchema.statics.track = async function(locationId, userId, eventType, metadata = {}) {
  try {
    await this.create({
      locationId,
      userId,
      eventType,
      metadata,
      sessionId: metadata.sessionId || null
    });
  } catch (error) {
    // Don't fail the main operation if analytics fails
    console.error('Analytics tracking failed:', error.message);
  }
};

/**
 * Get daily active users for location
 */
analyticsSchema.statics.getDailyActiveUsers = async function(locationId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const result = await this.aggregate([
    {
      $match: {
        locationId,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          userId: '$userId'
        }
      }
    },
    {
      $group: {
        _id: '$_id.date',
        uniqueUsers: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  return result;
};

/**
 * Get feature usage stats
 */
analyticsSchema.statics.getFeatureUsage = async function(locationId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return await this.aggregate([
    {
      $match: {
        locationId,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' }
      }
    },
    {
      $project: {
        eventType: '$_id',
        count: 1,
        uniqueUsers: { $size: '$uniqueUsers' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

/**
 * Get total unique users (all time)
 */
analyticsSchema.statics.getTotalUsers = async function(locationId) {
  const result = await this.distinct('userId', { locationId });
  return result.length;
};

module.exports = mongoose.model('Analytics', analyticsSchema);

