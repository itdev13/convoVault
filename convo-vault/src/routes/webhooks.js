const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const DeletedOAuthToken = require('../models/DeletedOAuthToken');
const logger = require('../utils/logger');
const { authenticateSession } = require('../middleware/auth');
const GHLService = require('../services/ghlService');

/**
 * Webhook Endpoints for GHL Events
 * Handles app install/uninstall webhooks
 */

/**
 * @route POST /api/webhooks/convo-vault
 * @desc Handle ConvoVault webhook events (AppInstall, AppUninstall)
 * @access Public (GHL sends webhooks)
 */
router.post('/convo-vault', async (req, res) => {
  try {
    const webhookData = req.body;
    const { type, appId, companyId, locationId } = webhookData;
    
    logger.info('📥 GHL Webhook received', { type, appId, companyId, locationId });
    
    // Validate required fields
    if (!type || !appId) {
      logger.error('❌ Invalid webhook data', { webhookData });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, appId'
      });
    }
    
    // Handle based on webhook type
    if (type === 'INSTALL') {
      await handleInstall(webhookData);
    } else if (type === 'UNINSTALL') {
      await handleUninstall(webhookData);
    } else {
      logger.warn('⚠️ Unknown webhook type', { type });
      return res.status(400).json({
        success: false,
        error: `Unknown webhook type: ${type}`
      });
    }
    
    // Acknowledge webhook receipt
    res.status(200).json({
      success: true,
      message: `${type} webhook processed successfully`
    });
    
  } catch (error) {
    logger.error('❌ Webhook processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
});

/**
 * Handle App Install Webhook
 */
async function handleInstall(data) {
  const {
    appId,
    companyId,
    locationId,
    userId,
    planId,
    trial,
    isWhitelabelCompany,
    whitelabelDetails,
    companyName
  } = data;
  
  try {
    // Check if installation already exists
    const query = locationId 
      ? { appId, locationId, status: 'active' }
      : { appId, companyId, status: 'active' };
    
    let installation = await Installation.findOne(query);
    
    if (installation) {
      logger.info('✅ Existing installation found - updating', { 
        installationId: installation._id 
      });
      
      // Update existing installation
      installation.userId = userId || installation.userId;
      installation.planId = planId || installation.planId;
      installation.trial = trial || installation.trial;
      installation.isWhitelabelCompany = isWhitelabelCompany;
      installation.whitelabelDetails = whitelabelDetails || {};
      installation.companyName = companyName || installation.companyName;
      installation.rawWebhookData = data;
      installation.installedAt = new Date();
      
      await installation.save();
      
      logger.info('✅ Installation updated', { installationId: installation._id });
      
    } else {
      // Create new installation
      installation = new Installation({
        type: 'INSTALL',
        appId,
        companyId,
        locationId,
        userId,
        planId,
        trial: trial || {},
        isWhitelabelCompany: isWhitelabelCompany || false,
        whitelabelDetails: whitelabelDetails || {},
        companyName,
        status: 'active',
        installedAt: new Date(),
        rawWebhookData: data
      });
      
      await installation.save();
      
      logger.info('✅ New installation created', { 
        installationId: installation._id,
        companyId,
        locationId
      });
    }
    
    // PROACTIVE TOKEN GENERATION: If we have a locationId and company token,
    // generate location token immediately (avoids first-call delay)
    if (locationId && companyId) {
      try {
        // Check if location token already exists
        const existingLocationToken = await OAuthToken.findOne({
          locationId,
          tokenType: 'location',
          isActive: true
        });

        if (!existingLocationToken) {
          logger.info('🔄 Proactively generating location token for new installation');

          // Check if company token exists
          const companyToken = await OAuthToken.findOne({
            companyId,
            tokenType: 'company',
            isActive: true
          });

          if (companyToken) {
            const ghlService = new GHLService();
            
            // Generate location token from company token
            const locationToken = await ghlService.getLocationTokenFromCompany(
              companyId,
              locationId
            );

            // Store location token in database
            await OAuthToken.findOneAndUpdate(
              { locationId, tokenType: 'location' },
              {
                locationId,
                companyId,
                tokenType: 'location',
                accessToken: locationToken.accessToken,
                refreshToken: locationToken.refreshToken,
                expiresAt: new Date(Date.now() + locationToken.expiresIn * 1000),
                isActive: true
              },
              { upsert: true, new: true }
            );

            logger.info('✅ Location token generated and stored proactively');
          } else {
            logger.info('ℹ️ No company token found - skipping proactive location token generation');
          }
        } else {
          logger.info('ℹ️ Location token already exists - skipping generation');
        }
      } catch (tokenError) {
        console.log('tokenError', JSON.stringify(tokenError, null, 2));
        // Don't fail the installation if token generation fails
        logger.error('⚠️ Failed to generate location token proactively (non-critical):', tokenError.message);
      }
    }
    
    return installation;
    
  } catch (error) {
    logger.error('❌ Install handler error:', error);
    throw error;
  }
}

/**
 * Handle App Uninstall Webhook
 */
async function handleUninstall(data) {
  const { appId, companyId, locationId } = data;
  
  try {
    // Find active installation
    const query = locationId 
      ? { appId, locationId, status: 'active' }
      : { appId, companyId, status: 'active' };
    
    const installation = await Installation.findOne(query);
    
    if (!installation) {
      logger.warn('⚠️ No active installation found for uninstall', { 
        appId, 
        companyId, 
        locationId 
      });
      
      // SECURITY: Still archive and delete OAuth tokens even if no installation record
      await archiveAndDeleteTokens(locationId, companyId, null, data);
      
      // Create uninstall record anyway for tracking
      const uninstallRecord = new Installation({
        type: 'UNINSTALL',
        appId,
        companyId,
        locationId,
        status: 'uninstalled',
        uninstalledAt: new Date(),
        rawWebhookData: data
      });
      
      await uninstallRecord.save();
      
      return uninstallRecord;
    }
    
    // Update installation status
    installation.status = 'uninstalled';
    installation.uninstalledAt = new Date();
    installation.rawWebhookData = {
      ...installation.rawWebhookData,
      uninstallData: data
    };
    
    await installation.save();
    
    logger.info('✅ Installation marked as uninstalled', { 
      installationId: installation._id,
      companyId,
      locationId
    });
    
    // SECURITY: Archive OAuth tokens before deletion
    // Keeps audit trail while preventing access
    await archiveAndDeleteTokens(locationId, companyId, installation._id, data);
    
    return installation;
    
  } catch (error) {
    logger.error('❌ Uninstall handler error:', error);
    throw error;
  }
}

/**
 * Archive OAuth tokens before deletion
 * Keeps audit trail for 90 days then auto-deletes
 */
async function archiveAndDeleteTokens(locationId, companyId, installationId, webhookData) {
  try {
    const findQuery = locationId 
      ? { locationId }
      : { companyId };
    
    // Find all active tokens for this location/company
    const tokensToArchive = await OAuthToken.find(findQuery);
    
    if (tokensToArchive.length === 0) {
      logger.info('ℹ️ No OAuth tokens found to archive', { locationId, companyId });
      return;
    }
    
    logger.info(`📦 Archiving ${tokensToArchive.length} OAuth tokens before deletion`, {
      locationId,
      companyId
    });
    
    // Archive each token to DeletedOAuthToken collection
    const archivePromises = tokensToArchive.map(token => {
      return DeletedOAuthToken.create({
        companyId: token.companyId,
        locationId: token.locationId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        originalCreatedAt: token.createdAt,
        originalExpiresAt: token.expiresAt,
        deletedAt: new Date(),
        deletionReason: 'app_uninstall',
        installationId: installationId,
        uninstallWebhookData: webhookData
      });
    });
    
    await Promise.all(archivePromises);
    
    logger.info('✅ OAuth tokens archived successfully', {
      count: tokensToArchive.length
    });
    
    // Now delete the original tokens
    const deleteResult = await OAuthToken.deleteMany(findQuery);
    
    logger.info('🔒 OAuth tokens deleted from active collection', { 
      deletedCount: deleteResult.deletedCount,
      locationId,
      companyId
    });
    
    logger.info('📊 Token cleanup complete', {
      archived: tokensToArchive.length,
      deleted: deleteResult.deletedCount,
      autoDeleteAfter: '90 days'
    });
    
  } catch (error) {
    logger.error('❌ Failed to archive/delete OAuth tokens:', error);
    // Don't throw - uninstall should succeed even if token archiving fails
  }
}

module.exports = router;

