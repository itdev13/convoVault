const express = require('express');
const router = express.Router();
const FeatureNotification = require('../models/FeatureNotification');
const { authenticateSession } = require('../middleware/auth');
const { isValidEmail } = require('../utils/sanitize');
const logger = require('../utils/logger');

const VALID_FEATURES = ['socialPosts'];

/**
 * @route POST /api/notifications/subscribe
 * @desc Subscribe to be notified when a feature launches
 */
router.post('/subscribe', authenticateSession, async (req, res) => {
  try {
    const { feature, email, locationId, userId } = req.body;

    if (!feature || !email || !locationId) {
      return res.status(400).json({ success: false, error: 'Feature, email, and locationId are required' });
    }

    if (!VALID_FEATURES.includes(feature)) {
      return res.status(400).json({ success: false, error: 'Invalid feature name' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    await FeatureNotification.findOneAndUpdate(
      { feature, email: email.toLowerCase().trim(), locationId },
      { feature, email: email.toLowerCase().trim(), locationId, userId: userId || null },
      { upsert: true, new: true }
    );

    logger.info('Feature notification subscription', { feature, email, locationId });

    res.json({ success: true, message: 'You will be notified when this feature launches!' });
  } catch (error) {
    logger.error('Feature notification error:', error);
    res.status(500).json({ success: false, error: 'Failed to subscribe' });
  }
});

module.exports = router;
