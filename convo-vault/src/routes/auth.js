const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const AppConfig = require('../models/AppConfig');
const GHLService = require('../services/ghlService');
const logger = require('../utils/logger');
const { logError } = require('../utils/errorLogger');

/**
 * Decrypt user data from GHL (Official Method)
 * Reference: https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps
 */
router.post('/decrypt-user-data', async (req, res) => {
  try {
    const { encryptedData } = req.body;

    if (!encryptedData) {
      return res.status(400).json({
        success: false,
        error: 'No encrypted data provided'
      });
    }

    // Each GHL marketplace app has its OWN shared secret; the premium secret cannot decrypt a
    // lite-app SSO payload. The UI tells us which app it is via the `X-App` header ('lite' for
    // the "Export Messages" app), so we pick the matching secret.
    const isLite = String(req.get('X-App') || req.body?.app || '').toLowerCase() === 'lite';
    const sharedSecret = isLite
      ? process.env.GHL_LITE_APP_SHARED_SECRET
      : process.env.GHL_APP_SHARED_SECRET;

    if (!sharedSecret) {
      logger.error('Shared Secret not configured', { isLite });
      return res.status(500).json({
        success: false,
        error: 'Shared Secret not configured'
      });
    }

    // Decrypt using CryptoJS
    const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
    const userData = JSON.parse(decrypted);

    // Don't log sensitive user data in production
    if (process.env.NODE_ENV !== 'production') {
      logger.info('User data decrypted');
    }

    // Return decrypted user data
    // Note: GHL returns 'activeLocation' for location context
    res.json({
      success: true,
      userId: userData.userId,
      companyId: userData.companyId,
      activeLocation: userData.activeLocation || null,  // Original GHL field name
      locationId: userData.activeLocation || null,      // Alias for convenience
      email: userData.email,
      userName: userData.userName,
      role: userData.role,
      type: userData.type,
      isAgencyOwner: userData.isAgencyOwner
    });

  } catch (error) {
    logError('Failed to decrypt user data', error);
    res.status(400).json({
      success: false,
      error: 'Failed to decrypt user data',
      message: error.message
    });
  }
});

/**
 * Verify GHL user context and create session
 * Called when dashboard loads in GHL iframe
 */
router.post('/verify', async (req, res) => {
  const { locationId, companyId, userId } = req.body;

  // Validation
  if (!locationId || !userId) {
    return res.status(400).json({
      success: false,
      error: 'locationId and userId are required'
    });
  }

  try {
    logger.info('Verifying user context', { locationId, companyId, userId });

    // Check if this sub-account has an active OAuth token
    let token = await OAuthToken.findOne({
      locationId,
      tokenType: 'location',
      isActive: true
    });

    // If no location token, try to generate from company token
    if (!token) {
      logger.info('No location token found, looking up company for location:', locationId);

      const companyLoc = await CompanyLocation.findCompanyByLocation(locationId);
      if (!companyLoc) {
        logger.warn('Sub-account not connected', { locationId });
        return res.status(401).json({
          success: false,
          error: 'Sub-account not connected. Please install the app first.',
          code: 'NOT_CONNECTED'
        });
      }

      const companyToken = await OAuthToken.findOne({
        companyId: companyLoc.companyId,
        tokenType: 'company',
        isActive: true
      });

      if (!companyToken) {
        logger.warn('Company token not found or expired', { companyId: companyLoc.companyId });
        return res.status(401).json({
          success: false,
          error: 'Authentication expired. Please reconnect ExportKit.',
          code: 'NOT_CONNECTED'
        });
      }

      // Generate location token from company token
      logger.info('Generating location token from company token', { locationId });
      const locationToken = await GHLService.getLocationTokenFromCompany(
        companyLoc.companyId,
        locationId
      );

      token = await OAuthToken.findOneAndUpdate(
        { locationId, tokenType: 'location' },
        {
          locationId,
          companyId: companyLoc.companyId,
          tokenType: 'location',
          accessToken: locationToken.accessToken,
          refreshToken: locationToken.refreshToken,
          expiresAt: new Date(Date.now() + locationToken.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      logger.info('✅ Location token generated and saved', { locationId });
    }

    // Check if token is expired or needs refresh
    if (token.needsRefresh()) {
      logger.info('Token needs refresh', { locationId });
    }

    // Create session JWT (expires in 1 hour)
    const sessionToken = jwt.sign(
      {
        userId,
        locationId,
        companyId,
        locationName: token.locationName || 'Sub-Account'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    logger.info('✅ Session created for user', { userId, locationId });

    // Return session with sub-account info
    res.json({
      success: true,
      sessionToken,
      location: {
        id: token.locationId,
        name: token.locationName,
        email: token.locationEmail,
        phone: token.locationPhone,
        address: token.locationAddress,
        website: token.locationWebsite,
        timezone: token.locationTimezone
      },
      user: {
        id: userId,
        companyId
      }
    });

  } catch (error) {
    logError('Authentication error', error, { 
      locationId: req.body?.locationId,
      companyId: req.body?.companyId,
      userId: req.body?.userId 
    });
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

/**
 * Refresh session token
 * Called before token expires to extend session
 */
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  try {
    const oldToken = authHeader.substring(7);
    
    // Verify old token (allow expired tokens for refresh)
    const decoded = jwt.verify(oldToken, process.env.JWT_SECRET, {
      ignoreExpiration: true
    });

    // Check if token is too old (> 24 hours)
    const tokenAge = Date.now() / 1000 - decoded.iat;
    if (tokenAge > 86400) { // 24 hours
      return res.status(401).json({
        success: false,
        error: 'Token too old, please re-authenticate'
      });
    }

    // Verify sub-account still has OAuth token
    const token = await OAuthToken.findActiveToken(decoded.locationId);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Sub-account no longer connected'
      });
    }

    // Create new session token
    const sessionToken = jwt.sign(
      {
        userId: decoded.userId,
        locationId: decoded.locationId,
        companyId: decoded.companyId,
        locationName: token.locationName || 'Sub-Account'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    logger.info('Session refreshed', { userId: decoded.userId });

    res.json({
      success: true,
      sessionToken
    });

  } catch (error) {
    logError('Token refresh error', error, { 
      hasAuthHeader: !!req.headers?.authorization 
    });
    res.status(401).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

/**
 * Get current session info
 */
router.get('/session', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh sub-account data
    const oauthToken = await OAuthToken.findActiveToken(decoded.locationId);
    
    if (!oauthToken) {
      return res.status(401).json({
        success: false,
        error: 'Sub-account no longer connected'
      });
    }

    // Feature gates — location/company-scoped access to custom-built tabs.
    // Add new gates here by adding a new AppConfig key.
    const features = {
      opportunityStageHistory: await AppConfig.hasValue('opportunityStageExportLocations', decoded.locationId)
    };

    res.json({
      success: true,
      session: {
        userId: decoded.userId,
        locationId: decoded.locationId,
        companyId: decoded.companyId,
        locationName: oauthToken.locationName,
        expiresAt: new Date(decoded.exp * 1000)
      },
      location: {
        id: oauthToken.locationId,
        name: oauthToken.locationName,
        email: oauthToken.locationEmail,
        phone: oauthToken.locationPhone,
        address: oauthToken.locationAddress,
        website: oauthToken.locationWebsite,
        timezone: oauthToken.locationTimezone
      },
      features
    });

  } catch (error) {
    logError('Session info error', error, { 
      hasAuthHeader: !!req.headers?.authorization 
    });
    res.status(401).json({
      success: false,
      error: 'Invalid session'
    });
  }
});

/**
 * Get all sub-accounts for current company (for dropdown)
 */
router.get('/locations', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get all sub-accounts for this company
    const locations = await OAuthToken.findCompanyLocations(decoded.companyId);

    res.json({
      success: true,
      count: locations.length,
      current: decoded.locationId,
      locations: locations.map(loc => ({
        id: loc.locationId,
        name: loc.locationName || 'Sub-Account',
        email: loc.locationEmail,
        phone: loc.locationPhone,
        isActive: loc.isActive,
        connectedAt: loc.createdAt
      }))
    });

  } catch (error) {
    logError('Get locations error', error, { 
      hasAuthHeader: !!req.headers?.authorization 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get sub-accounts'
    });
  }
});

module.exports = router;

