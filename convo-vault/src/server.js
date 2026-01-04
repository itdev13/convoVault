require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const logger = require('./utils/logger');
const database = require('./config/database');

/**
 * Simple Conversations Manager App
 * Features: Download Conversations, Get Messages, Import from CSV
 */
class ConversationsManagerApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Trust proxy - Required for ALB/Load Balancer
    // This allows Express to read X-Forwarded-* headers correctly
    this.app.set('trust proxy', 1);
    
    // Configure Helmet to allow GHL iframe embedding and inline scripts for docs
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "script-src-attr": ["'unsafe-inline'"],
          "frame-ancestors": [
            "'self'",
            "https://*.gohighlevel.com",
            "https://*.leadconnectorhq.com",
            "https://app.gohighlevel.com",
            "https://app.leadconnectorhq.com"
          ]
        }
      }
    }));
    
    // CORS - Strict whitelist of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://convo.vaultsuite.store',
      'https://convoapi.vaultsuite.store'
    ];
    
    this.app.use(cors({
      origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        // Check if origin is in whitelist
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        // Allow trusted domains
        const isTrustedDomain = origin.includes('gohighlevel.com') ||
                               origin.includes('leadconnectorhq.com') ||
                               origin.endsWith('vaultsuite.store') ||
                               origin.endsWith('vercel.app');
        
        // In development, also allow localhost and cloudflare
        const isDevOrigin = process.env.NODE_ENV !== 'production' && (
          origin.includes('localhost') ||
          origin.includes('127.0.0.1') ||
          origin.includes('trycloudflare.com')
        );
        
        if (isTrustedDomain || isDevOrigin) {
          return callback(null, true);
        }
        
        // Log rejected origins
        logger.warn('❌ CORS blocked origin:', origin);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Disposition']
    }));
    
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Request logging with response status
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      // Capture response when it's finished
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusEmoji = statusCode >= 500 ? '🔴' : 
                           statusCode >= 400 ? '🟡' : 
                           statusCode >= 300 ? '🔵' : '🟢';
        
        logger.info(`${statusEmoji} ${req.method} ${req.path} → ${statusCode} (${duration}ms)`);
      });
      
      next();
    });
  }

  setupRoutes() {
    // Import rate limiters
    const { apiLimiter, authLimiter, uploadLimiter, exportLimiter, webhookLimiter } = require('./middleware/rateLimiter');
    
    // Health check (no rate limit)
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        app: 'ConvoVault',
        timestamp: new Date().toISOString()
      });
    });

    // OAuth routes (no rate limit - GHL handles this)
    const oauthRoutes = require('./routes/oauth');
    this.app.use('/oauth', oauthRoutes);

    // Auth routes (strict rate limiting)
    const authRoutes = require('./routes/auth');
    this.app.use('/api/auth', authLimiter, authRoutes);

    // Webhook routes (lenient rate limiting)
    const webhookRoutes = require('./routes/webhooks');
    this.app.use('/api/webhooks', webhookLimiter, webhookRoutes);

    // Protected API documentation route (general rate limit)
    const docsRoutes = require('./routes/docs');
    this.app.use('/api/docs', apiLimiter, docsRoutes);

    // Feature routes with rate limiting
    const conversationsRoutes = require('./routes/conversations');
    const messagesRoutes = require('./routes/messages');
    const importRoutes = require('./routes/import');
    const exportRoutes = require('./routes/export');
    const supportRoutes = require('./routes/support');

    this.app.use('/api/conversations', apiLimiter, conversationsRoutes);
    this.app.use('/api/messages', apiLimiter, messagesRoutes);
    this.app.use('/api/import', importRoutes);
    this.app.use('/api/export', exportRoutes);
    this.app.use('/api/support', apiLimiter, supportRoutes);

    // Root
    this.app.get('/', (req, res) => {
      res.json({
        app: 'ConvoVault',
        version: '1.0.0',
        features: [
          '1. Download Conversations',
          '2. Get Conversation Messages',
          '3. Import from CSV/Excel',
          'Bonus: Advanced Message Export with conversationId'
        ]
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Not Found'
      });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      logger.error('Error:', err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
      });
    });
  }

  async start() {
    try {
      await database.connect();
      
      this.app.listen(this.port, () => {
        logger.info('='.repeat(50));
        logger.info('🚀 ConvoVault Started');
        logger.info('='.repeat(50));
        logger.info(`📡 Port: ${this.port}`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔗 URL: ${process.env.BASE_URL}`);
        logger.info('='.repeat(50));
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

const app = new ConversationsManagerApp();
app.start();

module.exports = app;

