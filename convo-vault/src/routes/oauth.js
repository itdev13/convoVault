const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const OAuthToken = require('../models/OAuthToken');
const logger = require('../utils/logger');
const { logError } = require('../utils/errorLogger');

/**
 * OAuth Routes - Simple Implementation
 */

/**
 * Start OAuth flow
 */
router.get('/authorize', (req, res) => {
  const scopes = [
    'conversations.readonly',
    'conversations.write',
    'conversations/message.readonly',
    'conversations/message.write',
    'contacts.readonly',
    'contacts.write'
  ].join(' ');

  const authUrl = `${process.env.GHL_OAUTH_URL}/authorize?` + 
    `response_type=code&` +
    `client_id=${process.env.GHL_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(process.env.GHL_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(scopes)}`;

  res.redirect(authUrl);
});

/**
 * OAuth callback
 */
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }

  try {
    logger.info('Exchanging code for token...');
    
    const tokenData = await ghlService.getAccessToken(code);

    // Check if this is Sub-Account-level or Company-level installation
    const isLocationLevel = !!tokenData.locationId;
    
    if (isLocationLevel) {
      // ===== SUB-ACCOUNT-LEVEL INSTALLATION =====
      logger.info('📍 Sub-Account-level installation for:', tokenData.locationId);
      
      // Save sub-account token
      let savedToken = await OAuthToken.findOneAndUpdate(
        { locationId: tokenData.locationId },
        {
          locationId: tokenData.locationId,
          companyId: tokenData.companyId,
          tokenType: 'location',
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      // Fetch sub-account details
      logger.info('Fetching sub-account details...');
      const locationDetails = await ghlService.getLocationDetails(tokenData.locationId);

      // Update with sub-account details
      savedToken = await OAuthToken.findOneAndUpdate(
        { locationId: tokenData.locationId },
        { ...locationDetails },
        { new: true }
      );

      logger.info('✅ OAuth successful for sub-account:', savedToken.locationName || tokenData.locationId);
      
      var displayName = savedToken.locationName 
        ? `${savedToken.locationName} (${savedToken.locationId})` 
        : `Sub-Account ID: ${savedToken.locationId}`;
      var successMessage = `Sub-Account: ${displayName}`;
      
    } else {
      // ===== COMPANY-LEVEL INSTALLATION =====
      logger.info('🏢 Company-level installation for:', tokenData.companyId);
      
      // Save company-level token
      await OAuthToken.findOneAndUpdate(
        { companyId: tokenData.companyId, tokenType: 'company' },
        {
          companyId: tokenData.companyId,
          tokenType: 'company',
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      // Fetch all sub-accounts for this company
      logger.info('Fetching all sub-accounts for company...');
      const locations = await ghlService.getCompanyLocations(tokenData.companyId, tokenData.accessToken);

      // Create placeholder tokens for each sub-account
      // These will be converted to proper location tokens on first use
      logger.info(`Creating placeholder tokens for ${locations.length} sub-accounts...`);
      for (const location of locations) {
        await OAuthToken.findOneAndUpdate(
          { locationId: location.locationId },
          {
            locationId: location.locationId,
            companyId: tokenData.companyId,
            tokenType: 'company', // Mark as company so it gets converted on first use
            accessToken: tokenData.accessToken, // Temporary - will be replaced
            refreshToken: tokenData.refreshToken,
            expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000),
            locationName: location.locationName,
            locationEmail: location.locationEmail,
            locationPhone: location.locationPhone,
            locationAddress: location.locationAddress,
            locationWebsite: location.locationWebsite,
            locationTimezone: location.locationTimezone,
            isActive: true
          },
          { upsert: true, new: true }
        );
      }

      logger.info('✅ OAuth successful for company:', tokenData.companyId);
      var displayName = `${locations.length} sub-account(s)`;
      var successMessage = `Company installed with ${displayName}`;
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Success - ConvoVault</title>
        <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            max-width: 500px;
          }
          .success-icon {
            font-size: 64px;
            color: #4CAF50;
            margin-bottom: 20px;
          }
          h1 { color: #333; margin: 0 0 10px 0; }
          p { color: #666; margin: 10px 0; }
          .sub-account-id {
            background: #f5f5f5;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            margin: 20px 0;
          }
          .features {
            text-align: left;
            margin: 20px 0;
            padding: 20px;
            background: #f9f9f9;
            border-radius: 5px;
          }
          .features li {
            margin: 8px 0;
          }
          .access-box {
            background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            border: 2px solid #2563EB;
          }
          .access-box h3 {
            color: #1E40AF;
            font-size: 16px;
            margin-bottom: 12px;
          }
          .step-instruction {
            color: #374151;
            font-size: 14px;
            margin: 8px 0;
            padding-left: 20px;
            position: relative;
          }
          .step-instruction:before {
            content: "→";
            position: absolute;
            left: 0;
            color: #2563EB;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <img src="/assets/logo-icon.svg" alt="ConvoVault" width="80" height="80" style="margin-bottom: 20px;">
          <h1>Connected Successfully!</h1>
          <p>${successMessage}</p>
          <div class="sub-account-id">
            ${displayName}
          </div>
          <div class="features">
            <div class="access-box">
              <h3>🎯 How to Access ConvoVault:</h3>
              <div class="step-instruction">Open your sub-account dashboard</div>
              <div class="step-instruction">Look for <strong style="color: #2563EB;">"ConvoVault"</strong> in the left navigation menu</div>
              <div class="step-instruction">Click to launch the app</div>
              <p style="color: #6B7280; font-size: 12px; margin-top: 12px; font-style: italic;">
                💡 ConvoVault will appear as a new menu item in your sidebar
              </p>
            </div>
            
            <strong style="display: block; margin-top: 20px;">Available Features:</strong>
            <ul>
              <li>📥 Download Conversations with Filters</li>
              <li>💬 Get Messages with Conversation Context</li>
              <li>📤 Import from CSV/Excel Files</li>
              <li>🚀 Advanced Export with conversationId</li>
            </ul>
          </div>
          <div style="background: #FEF3C7; padding: 15px; border-radius: 8px; margin-top: 25px; border-left: 4px solid #F59E0B;">
            <p style="color: #92400E; font-size: 13px; font-weight: 600; margin: 0;">
              ✓ Installation Complete! Close this window and find ConvoVault in your sub-account's left menu.
            </p>
          </div>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
            <a href="https://convo.vaultsuite.store/about.html" target="_blank" style="color: #667eea; text-decoration: none; font-size: 14px; font-weight: 600;">
              🌐 Visit ConvoVault Website
            </a>
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    logError('OAuth callback error', error, { code: req.query?.code });
    
    // Check if it's a reused authorization code (already completed)
    const isCodeReused = error.response?.data?.error === 'invalid_grant' && 
                         error.response?.data?.error_description?.includes('authorization code');
    
    if (isCodeReused) {
      // Authorization already completed - show success message
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Complete - ConvoVault</title>
          <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              text-align: center;
              background: white;
              padding: 50px;
              border-radius: 16px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 550px;
            }
            .icon {
              font-size: 80px;
              margin-bottom: 20px;
            }
            h1 {
              color: #10B981;
              margin: 0 0 15px 0;
              font-size: 32px;
            }
            p {
              color: #6B7280;
              margin: 12px 0;
              font-size: 16px;
              line-height: 1.6;
            }
            .highlight-box {
              background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
              padding: 25px;
              border-radius: 12px;
              margin: 25px 0;
              border: 2px solid #2563EB;
            }
            .highlight-box h3 {
              color: #1E40AF;
              font-size: 18px;
              margin: 0 0 15px 0;
            }
            .step {
              color: #374151;
              font-size: 15px;
              margin: 10px 0;
              padding-left: 25px;
              text-align: left;
              position: relative;
            }
            .step:before {
              content: "→";
              position: absolute;
              left: 0;
              color: #2563EB;
              font-weight: bold;
              font-size: 18px;
            }
            .tip {
              background: #FEF3C7;
              padding: 15px;
              border-radius: 8px;
              margin-top: 20px;
              border-left: 4px solid #F59E0B;
            }
            .tip p {
              color: #92400E;
              font-size: 14px;
              font-weight: 600;
              margin: 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✅</div>
            <h1>Authorization Already Completed!</h1>
            <p>Your ConvoVault has been successfully connected</p>
            
            <div class="highlight-box">
              <h3>🎯 How to Access ConvoVault:</h3>
              <div class="step">Open your sub-account dashboard</div>
              <div class="step">Find <strong style="color: #2563EB;">"ConvoVault"</strong> in the left sidebar menu</div>
              <div class="step">Click to launch and start managing conversations</div>
            </div>
            
            <div class="tip">
              <p>💡 ConvoVault appears as a new menu item in your sub-account navigation</p>
            </div>
            
            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
              <a href="https://convo.vaultsuite.store/about.html" target="_blank" style="color: #667eea; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block; margin-bottom: 15px;">
                🌐 Visit ConvoVault Website
              </a>
            </div>
            
            <p style="font-size: 13px; color: #9CA3AF; margin-top: 15px;">
              You can safely close this window
            </p>
          </div>
        </body>
        </html>
      `);
    }
    
    // Other errors - show generic error page
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - ConvoVault</title>
        <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 500px;
          }
          .icon { font-size: 64px; margin-bottom: 20px; }
          h1 { color: #EF4444; margin: 0 0 15px 0; }
          p { color: #6B7280; margin: 10px 0; }
          .error-detail {
            background: #FEE2E2;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            color: #991B1B;
            font-size: 14px;
          }
          a {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 24px;
            background: #2563EB;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: background 0.3s;
          }
          a:hover { background: #1D4ED8; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠️</div>
          <h1>Connection Failed</h1>
          <p>We encountered an error while connecting ConvoVault</p>
          <div class="error-detail">
            ${error.message}
          </div>
      <a href="https://marketplace.gohighlevel.com/integration/694f93f8a6babf0c821b1356">Try Again</a>
          
          <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
            <a href="https://convo.vaultsuite.store/about.html" target="_blank" style="color: #fff; text-decoration: none; font-size: 14px; font-weight: 600;">
              🌐 Visit ConvoVault Website
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * Check OAuth status
 */
router.get('/status', async (req, res) => {
  const { locationId } = req.query;

  if (!locationId) {
    return res.status(400).json({
      success: false,
      error: 'locationId required'
    });
  }

  try {
    const token = await OAuthToken.findActiveToken(locationId);
    
    res.json({
      success: true,
      connected: !!token,
      locationId,
      locationName: token?.locationName || null,
      locationDisplay: token?.locationName ? `${token.locationName} (${locationId})` : locationId,
      expiresAt: token?.expiresAt
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all connected sub-accounts for a company
 */
router.get('/locations', async (req, res) => {
  const { companyId } = req.query;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      error: 'companyId required'
    });
  }

  try {
    const locations = await OAuthToken.findCompanyLocations(companyId);
    
    res.json({
      success: true,
      count: locations.length,
      locations: locations.map(loc => ({
        locationId: loc.locationId,
        locationName: loc.locationName,
        locationDisplay: loc.locationName ? `${loc.locationName} (${loc.locationId})` : loc.locationId,
        email: loc.locationEmail,
        phone: loc.locationPhone,
        address: loc.locationAddress,
        website: loc.locationWebsite,
        timezone: loc.locationTimezone,
        connectedAt: loc.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

