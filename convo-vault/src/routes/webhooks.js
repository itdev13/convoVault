const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const DeletedOAuthToken = require('../models/DeletedOAuthToken');
const Referral = require('../models/Referral');
const logger = require('../utils/logger');
const { authenticateSession } = require('../middleware/auth');
const GHLService = require('../services/ghlService');
const ThrottleQueue = require('../utils/throttleQueue');
const { sendUninstallWinBackEmail } = require('../services/winbackEmailer');
const AppConfig = require('../models/AppConfig');

/**
 * Send the uninstall win-back email UNLESS this company is on the suppression list
 * (AppConfig key `suppressWinbackEmailCompanyIds`). Lets us silence the win-back email for
 * specific companies (e.g. internal/partner accounts) without code changes.
 */
async function maybeSendWinBack(installerSnapshot, companyId) {
  try {
    if (companyId && await AppConfig.hasValue('suppressWinbackEmailCompanyIds', companyId)) {
      logger.info('⏭️  Win-back email suppressed for company', { companyId });
      return;
    }
  } catch (err) {
    logger.warn('Win-back suppression check failed (sending anyway):', { error: err.message });
  }
  sendUninstallWinBackEmail(installerSnapshot);
}

const tokenGenQueue = new ThrottleQueue({ name: 'proactive-token-gen', delayMs: 350 });

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

  // Which app is this install from? The webhook's appId identifies the marketplace app.
  // Lite ("Export Messages") installs carry GHL_LITE_APP_ID → stamp lite:true so the record
  // is attributed to the lite app (and its appId is preserved as-is from the payload).
  const isLite = !!process.env.GHL_LITE_APP_ID && appId === process.env.GHL_LITE_APP_ID;

  // Diagnostic: shows exactly what GHL sent vs the configured lite appId, so we can tell whether
  // an install is being attributed to the right app (lite vs premium).
  logger.info('📥 INSTALL webhook', {
    appId,
    liteAppIdConfigured: process.env.GHL_LITE_APP_ID || '(unset)',
    matchedLite: isLite,
    companyId,
    locationId: locationId || '(company-level)',
    level: locationId ? 'location' : 'company'
  });

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
      installation.lite = isLite;

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
        rawWebhookData: data,
        lite: isLite
      });

      await installation.save();
      
      logger.info('✅ New installation created', { 
        installationId: installation._id,
        companyId,
        locationId
      });
    }
    
    // PROACTIVE TOKEN GENERATION: queue this so bulk installs (e.g. agency
    // installing on 50+ locations at once) don't hammer GHL and trigger 429s.
    // Webhook returns immediately; token gen happens in background at ~3/sec.
    if (locationId && companyId) {
      tokenGenQueue.push(async () => {
        try {
          const existingLocationToken = await OAuthToken.findOne({
            locationId,
            tokenType: 'location',
            isActive: true
          });
          if (existingLocationToken) {
            logger.info('ℹ️ Location token already exists - skipping generation', { locationId });
            return;
          }

          const companyToken = await OAuthToken.findOne({
            companyId,
            tokenType: 'company',
            isActive: true
          });
          if (!companyToken) {
            logger.info('ℹ️ No company token found - skipping proactive location token generation', { locationId });
            return;
          }

          logger.info('🔄 Proactively generating location token for new installation', { locationId, queueSize: tokenGenQueue.size() });

          const locationToken = await GHLService.getLocationTokenFromCompany(companyId, locationId);

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

          logger.info('✅ Location token generated and stored proactively', { locationId });
        } catch (tokenError) {
          // Non-critical: token will be lazily generated on first API call
          logger.error('⚠️ Failed to generate location token proactively (non-critical):', {
            locationId,
            message: tokenError.message,
            status: tokenError.response?.status,
            data: tokenError.response?.data
          });
        }
      });
    }
    
    // REFERRAL PROPAGATION: If locationId install and company has an ACTIVE referral,
    // create a location-level referral record and stamp referralCode on installation.
    // We filter by status='installed' so soft-deleted (uninstalled) referrals don't
    // get re-attributed when a company reinstalls without a referral link.
    if (locationId && companyId) {
      try {
        const companyReferral = await Referral.findOne({
          companyId,
          locationId: { $exists: false },
          status: 'installed'
        });
        if (companyReferral) {
          await Referral.findOneAndUpdate(
            { locationId },
            {
              referralCode: companyReferral.referralCode,
              companyId,
              locationId,
              campaign: companyReferral.campaign,
              status: 'installed',
              testing: companyReferral.testing,
              installedAt: new Date()
            },
            { upsert: true, new: true }
          );
          // Stamp referralCode on the installation record
          installation.referralCode = companyReferral.referralCode;
          await installation.save();
          logger.info('✅ Referral propagated from company to location:', {
            referralCode: companyReferral.referralCode,
            companyId,
            locationId
          });
        } else {
          // Fallback: only stamp installation.referralCode if there's an ACTIVE location-level referral
          const locationReferral = await Referral.findOne({ locationId, status: 'installed' });
          if (locationReferral?.referralCode && !installation.referralCode) {
            installation.referralCode = locationReferral.referralCode;
            await installation.save();
          }
        }
      } catch (refErr) {
        logger.warn('Failed to propagate referral to location (non-blocking):', refErr.message);
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
    // Snapshot installer contact info BEFORE token archive/delete so we can send the win-back
    // email after cleanup. Done up front because the original OAuthToken doc is wiped by
    // archiveAndDeleteTokens(); after that we'd have to read from DeletedOAuthToken which
    // doesn't carry installer fields today.
    const installerSnapshot = await captureInstallerSnapshot(locationId, companyId);

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

      // Fire win-back email async (don't block webhook response)
      await maybeSendWinBack(installerSnapshot, companyId);
      
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

    // Fire one-shot pricing-first win-back email (async — never blocks webhook response).
    await maybeSendWinBack(installerSnapshot, companyId);

    // Hard-delete referral record on uninstall so reinstalls don't inherit stale attribution
    try {
      const referralQuery = locationId ? { locationId } : { companyId, locationId: { $exists: false } };
      const result = await Referral.deleteOne(referralQuery);
      logger.info('✅ Referral deleted on uninstall', { locationId, companyId, deletedCount: result.deletedCount });
    } catch (refErr) {
      logger.warn('Failed to delete referral on uninstall (non-blocking):', refErr.message);
    }

    return installation;
    
  } catch (error) {
    logger.error('❌ Uninstall handler error:', error);
    throw error;
  }
}

/**
 * Pull installer contact info so the uninstall handler can send a win-back email.
 * Must be called BEFORE archiveAndDeleteTokens() wipes the OAuthToken rows.
 *
 * Lookup order:
 *   1. Location token (by locationId)       — installerEmail may be null if it was a
 *                                              company-level OAuth (email stored on company token)
 *   2. Company token (by companyId from #1) — installerEmail stored here when OAuth was
 *                                              done at company level (common for new installs)
 *   3. Three-tier email fallback (locationEmail → usersApi) inside captureFromToken()
 *
 * Never throws.
 */
async function captureInstallerSnapshot(locationId, companyId) {
  const base = { to: null, name: null, locationName: null, locationId: locationId || null, source: 'none' };
  try {
    // Step 1: try location token first (has locationName we want for the email)
    let token = null;
    if (locationId) {
      token = await OAuthToken.findOne({ locationId }).select(
        'installerEmail installerName locationName locationId companyId locationEmail'
      );
    }

    // Step 2: if no location token OR location token has no installerEmail,
    // check the company token using companyId (from token or from webhook data)
    const resolvedCompanyId = token?.companyId || companyId;
    if (resolvedCompanyId && (!token || !token.installerEmail)) {
      const companyToken = await OAuthToken.findOne({
        companyId: resolvedCompanyId,
        tokenType: 'company'
      }).select('installerEmail installerName');

      if (companyToken?.installerEmail) {
        return {
          ...base,
          to: companyToken.installerEmail,
          name: companyToken.installerName || null,
          locationName: token?.locationName || null,
          locationId: token?.locationId || locationId || null,
          source: 'companyToken'
        };
      }
    }

    if (!token) return base;

    base.locationName = token.locationName || null;
    base.locationId = token.locationId || locationId || null;

    // Step 3: installerEmail on location token (sub-account-level OAuth)
    if (token.installerEmail) {
      return { ...base, to: token.installerEmail, name: token.installerName || null, source: 'installer' };
    }

    // Step 4: locationEmail fallback (already on every token from getLocationDetails)
    if (token.locationEmail) {
      return { ...base, to: token.locationEmail, name: token.locationName || null, source: 'locationEmail' };
    }

    // Step 5: live users search as last resort
    if (locationId) {
      try {
        const ghlService = new GHLService();
        const users = await ghlService.searchUsers(locationId, { companyId: resolvedCompanyId });
        const candidate =
          users.find(u => u?.email && /admin|owner/i.test(String(u.roles?.type || u.role || ''))) ||
          users.find(u => u?.email);
        if (candidate?.email) {
          const name = candidate.name || [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || null;
          return { ...base, to: candidate.email, name, source: 'usersApi' };
        }
      } catch (apiErr) {
        logger.warn('Win-back: users search fallback failed (non-blocking):', apiErr.message);
      }
    }

    return base;
  } catch (err) {
    logger.warn('Failed to capture installer snapshot (non-blocking):', err.message);
    return base;
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

