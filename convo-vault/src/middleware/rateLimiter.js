const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Rate limiting configurations for different endpoint types
 */

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 1000, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    retryAfter: '1 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later.',
      retryAfter: '1 minutes'
    });
  }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Limit each IP to 5 auth attempts per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '5 minutes'
  },
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Rate limiter for file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2, // Limit each user to 15 upload per 15 minutes
  message: {
    success: false,
    error: 'Upload limit exceeded. Maximum 15 files per 15 minutes.',
    retryAfter: '15 minutes'
  },
  handler: (req, res) => {
    logger.warn('Upload rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.userId
    });
    res.status(429).json({
      success: false,
      error: 'Upload limit exceeded. Maximum 15 files per 15 minutes.',
      retryAfter: '15 minutes'
    });
  }
});

// Rate limiter for export/download endpoints
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each user to 50 exports per 15 minutes
  message: {
    success: false,
    error: 'Export limit exceeded. Maximum 50 exports per 15 minutes.',
    retryAfter: '15 minutes'
  }
});

// Webhook rate limiter (lenient for GHL webhooks)
const webhookLimiter = rateLimit({
  windowMs: 15 * 1000, // 15 seconds
  max: 1000, // Allow 1000 webhooks per minute
  message: {
    success: false,
    error: 'Webhook rate limit exceeded'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  uploadLimiter,
  exportLimiter,
  webhookLimiter
};

