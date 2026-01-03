const express = require('express');
const router = express.Router();
const path = require('path');
const { authenticateSession } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Protected API Documentation Route
 * Serves API docs only to authenticated users
 */

/**
 * @route POST /api/docs/access
 * @desc Generate temporary access token for API docs (secure)
 * @access Protected
 */
router.post('/access', authenticateSession, (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    
    // Create a short-lived docs access token (5 minutes)
    const docsToken = jwt.sign(
      { 
        userId: req.user.userId,
        locationId: req.user.locationId,
        purpose: 'api-docs'
      },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    
    logger.info('📚 Docs access token generated', {
      userId: req.user.userId
    });
    
    res.json({
      success: true,
      docsToken,
      userToken: req.headers.authorization.substring(7) // Return user's session token
    });
    
  } catch (error) {
    logger.error('Error generating docs token:', error?.message || error?.response?.data?.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate docs access'
    });
  }
});

/**
 * @route GET /api/docs
 * @desc Serve API documentation (requires docs token)
 * @access Protected
 */
router.get('/', (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const docsToken = req.query.t; // Short param name
    
    if (!docsToken) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unauthorized - ConvoVault</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .container { text-align: center; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
            h1 { color: #f56565; }
            p { color: #4a5568; margin: 20px 0; }
            a { color: #667eea; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔒 Unauthorized Access</h1>
            <p>API documentation is only accessible from within the ConvoVault app.</p>
            <a href="https://convo.vaultsuite.store">← Back to App</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Verify docs token
    try {
      const decoded = jwt.verify(docsToken, process.env.JWT_SECRET);
      
      if (decoded.purpose !== 'api-docs') {
        throw new Error('Invalid token purpose');
      }
      
      logger.info('📚 API docs accessed with valid token', {
        userId: decoded.userId
      });
      
    } catch (error) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Access Expired - ConvoVault</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .container { text-align: center; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
            h1 { color: #f56565; }
            p { color: #4a5568; margin: 20px 0; }
            a { color: #667eea; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⏰ Access Expired</h1>
            <p>Your API documentation access has expired. Please access it again from the app.</p>
            <a href="https://convo.vaultsuite.store">← Back to App</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Serve the HTML file from protected views folder
    res.sendFile(path.join(__dirname, '../views/api-docs.html'));
  } catch (error) {
    logger.error('Error serving API docs:', error.message);
    res.status(500).send('Error loading API documentation');
  }
});

module.exports = router;

