const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const { authenticateSession } = require('../middleware/auth');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');

const ALLOWED_MODELS = new Set(['contact', 'opportunity', 'all']);
const ALLOWED_DOCUMENT_TYPES = new Set(['document', 'folder', 'all']);

/**
 * GET /api/locations/custom-fields?locationId=X&model=Y
 * Lists custom fields from GHL for the given location.
 * model accepts: contact | opportunity | all | custom_objects.<key>
 */
router.get('/custom-fields', authenticateSession, async (req, res) => {
  try {
    const { locationId, model } = req.query;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const requestedModel = model || 'all';
    if (!ALLOWED_MODELS.has(requestedModel) && !String(requestedModel).startsWith('custom_objects.')) {
      return res.status(400).json({
        success: false,
        error: 'model must be one of: contact, opportunity, all, or start with custom_objects.'
      });
    }

    const result = await ghlService.getCustomFields(locationId, requestedModel);
    res.json({ success: true, data: result });
  } catch (error) {
    logError('Get custom fields failed', error, { locationId: req.query?.locationId, model: req.query?.model });
    const status = error.response?.status || 500;
    res.status(status).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

/**
 * GET /api/locations/custom-values?locationId=X&documentType=Y
 * Lists custom values from GHL for the given location.
 * documentType accepts: document (default by GHL) | folder | all
 */
router.get('/custom-values', authenticateSession, async (req, res) => {
  try {
    const { locationId, documentType } = req.query;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const requestedType = documentType || 'all';
    if (!ALLOWED_DOCUMENT_TYPES.has(requestedType)) {
      return res.status(400).json({
        success: false,
        error: 'documentType must be one of: document, folder, all'
      });
    }

    const result = await ghlService.getCustomValues(locationId, requestedType);
    res.json({ success: true, data: result });
  } catch (error) {
    logError('Get custom values failed', error, { locationId: req.query?.locationId, documentType: req.query?.documentType });
    const status = error.response?.status || 500;
    res.status(status).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

/**
 * GET /api/locations/tags?locationId=X
 * Lists all (non-deleted) tags from GHL for the given location.
 */
router.get('/tags', authenticateSession, async (req, res) => {
  try {
    const { locationId } = req.query;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.getLocationTags(locationId);
    res.json({ success: true, data: result });
  } catch (error) {
    logError('Get location tags failed', error, { locationId: req.query?.locationId });
    const status = error.response?.status || 500;
    res.status(status).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

module.exports = router;
