const mongoose = require('mongoose');

const featureNotificationSchema = new mongoose.Schema({
  feature: {
    type: String,
    required: true,
    enum: ['socialPosts'],
    index: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  locationId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Prevent duplicate subscriptions
featureNotificationSchema.index({ feature: 1, email: 1, locationId: 1 }, { unique: true });

module.exports = mongoose.model('FeatureNotification', featureNotificationSchema);
