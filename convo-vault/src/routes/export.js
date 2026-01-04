const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');
const { sanitizeLimit, isValidDate } = require('../utils/sanitize');

/**
 * BONUS FEATURE: Advanced Message Export
 * Export messages with conversation context and advanced filters
 */

/**
 * @route GET /api/export/messages
 * @desc Export messages with advanced filtering and pagination
 * Includes conversationId in response for better context
 */
router.get('/messages', authenticateSession, async (req, res) => {
  try {
    const { 
      locationId, 
      channel,         // SMS, Email, WhatsApp, Call, etc. (optional)
      startDate,       // ISO date string
      endDate,         // ISO date string
      contactId,       // Specific contact
      conversationId,  // Specific conversation
      cursor,          // For pagination
      limit      // Messages per page
    } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    // Validate date formats
    if (startDate && !isValidDate(startDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid startDate format. Use ISO 8601 format.'
      });
    }

    if (endDate && !isValidDate(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid endDate format. Use ISO 8601 format.'
      });
    }

    // Sanitize limit (max 500 for export)
    const sanitizedLimit = sanitizeLimit(limit, 100, 500);

    logger.info('Advanced message export', { 
      locationId, 
      channel, 
      conversationId,
      hasDateFilter: !!(startDate && endDate),
      limit: sanitizedLimit
    });

    // Build export options
    const options = { limit: sanitizedLimit };
    if (channel) options.channel = channel;
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (contactId) options.contactId = contactId;
    if (conversationId) options.conversationId = conversationId; // Add conversationId filter
    if (cursor) options.cursor = cursor;
    // Export messages using advanced endpoint
    const result = await ghlService.exportMessages(locationId, options);

    const messages = result.messages || [];

    res.json({
      success: true,
      message: 'Messages exported successfully',
      data: {
        total: messages.length,
        messages: messages.map(msg => ({
          id: msg.id,
          conversationId: msg.conversationId,  // ← Important for context!
          contactId: msg.contactId,
          type: msg.type,
          body: msg.body,
          direction: msg.direction || msg?.meta?.email?.direction || "outbound",
          status: msg.status,
          dateAdded: msg.dateAdded,
          attachments: msg.attachments || [],
          meta: msg.meta
        })),
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: !!result.nextCursor
        }
      },
      meta: {
        locationId,
        filters: options,
        exportedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('Export messages error', error, { 
      locationId: req.query?.locationId,
      filters: req.query 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to export messages',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/export/messages/all
 * @desc Export ALL messages with automatic pagination
 * Handles cursor-based pagination automatically
 */
router.get('/messages/all', authenticateSession, async (req, res) => {
  try {
    const { locationId, channel, startDate, endDate, contactId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    logger.info('Bulk export started for sub-account', { locationId });

    const filters = {};
    if (channel) filters.channel = channel;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (contactId) filters.contactId = contactId;

    // Export all messages (handles pagination automatically)
    const allMessages = await ghlService.exportAllMessages(
      locationId, 
      filters,
      (fetched, total) => {
        logger.info(`Progress: ${fetched}/${total || '?'} messages`);
      }
    );

    // Group by conversation for better context
    const byConversation = {};
    allMessages.forEach(msg => {
      const convId = msg.conversationId || 'unknown';
      if (!byConversation[convId]) {
        byConversation[convId] = [];
      }
      byConversation[convId].push(msg);
    });

    res.json({
      success: true,
      message: 'Bulk export completed',
      data: {
        totalMessages: allMessages.length,
        totalConversations: Object.keys(byConversation).length,
        messages: allMessages,
        byConversation: byConversation
      },
      meta: {
        locationId,
        filters,
        exportedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('Bulk export error', error, { 
      locationId: req.query?.locationId 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to bulk export',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/export/csv
 * @desc Export messages as CSV format
 */
router.get('/csv', authenticateSession, async (req, res) => {
  try {
    const { locationId, channel, startDate, endDate } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const filters = {};
    if (channel) filters.channel = channel;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    // Export all messages for sub-account
    const messages = await ghlService.exportAllMessages(locationId, filters);

    // Convert to CSV format
    const csvHeaders = 'Date,ConversationID,ContactID,Type,Direction,Status,Message\n';
    const csvRows = messages.map(msg => {
      const date = new Date(msg.dateAdded).toISOString();
      const message = (msg.body || '').replace(/"/g, '""').replace(/\n/g, ' ');
      return `"${date}","${msg.conversationId}","${msg.contactId}","${msg.type}","${msg.direction}","${msg.status}","${message}"`;
    }).join('\n');

    const csv = csvHeaders + csvRows;

    // Send as downloadable file
    const filename = `messages_${locationId}_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    logError('CSV export error', error, { 
      locationId: req.query?.locationId,
      filters: req.query 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    
    res.status(statusCode).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

module.exports = router;

