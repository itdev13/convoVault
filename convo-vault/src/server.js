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
    this.app.use(helmet());
    
    // CORS - Allow cloudflare tunnels and localhost
    this.app.use(cors({
      origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        // Allow localhost and cloudflare tunnels
        if (origin.includes('localhost') || 
            origin.includes('127.0.0.1') ||
            origin.includes('trycloudflare.com') ||
            origin.includes('gohighlevel.com') ||
            origin.includes('vaultsuite.store') ||
            origin.includes('vercel.app') ||
            origin.includes('leadconnectorhq.com')) {
          return callback(null, true);
        }
        
        callback(null, true); // Allow all for development
      },
      credentials: true
    }));
    
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        app: 'ConvoVault',
        timestamp: new Date().toISOString()
      });
    });

    // OAuth routes
    const oauthRoutes = require('./routes/oauth');
    this.app.use('/oauth', oauthRoutes);

    // Auth routes (for dashboard session management)
    const authRoutes = require('./routes/auth');
    this.app.use('/api/auth', authRoutes);

    // Feature routes
    const conversationsRoutes = require('./routes/conversations');
    const messagesRoutes = require('./routes/messages');
    const importRoutes = require('./routes/import');
    const exportRoutes = require('./routes/export');
    const supportRoutes = require('./routes/support');

    this.app.use('/api/conversations', conversationsRoutes);
    this.app.use('/api/messages', messagesRoutes);
    this.app.use('/api/import', importRoutes);
    this.app.use('/api/export', exportRoutes);
    this.app.use('/api/support', supportRoutes);

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

