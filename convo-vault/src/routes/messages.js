const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');
const { sanitizeLimit } = require('../utils/sanitize');

/**
 * FEATURE 2: Get Conversation Messages
 * Retrieve and export messages with conversation context
 */

/**
 * @route GET /api/messages/:conversationId
 * @desc Get all messages for a conversation
 */
router.get('/:conversationId', authenticateSession, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { locationId, limit, lastMessageId, sortOrder = 'desc' } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    // Sanitize limit (max 500 for messages)
    const sanitizedLimit = sanitizeLimit(limit, 100, 500);

    logger.info('Getting messages for sub-account', { conversationId, locationId, lastMessageId, limit: sanitizedLimit });

    // Fetch messages from GHL with pagination support
    const result = await ghlService.getMessages(locationId, conversationId, {
      limit: sanitizedLimit,
      lastMessageId,
      sortOrder
    });

    // GHL API structure: { messages: { messages: [...] } }
    let messages = [];
    let nextCursor = null;
    let hasMore = false;
    if (result.messages?.messages) {
      // Structure: { messages: { messages: [...], nextId: "..." } }
      messages = Array.isArray(result.messages.messages) ? result.messages.messages : [];
      nextCursor = result.messages.lastMessageId || null;
      hasMore = !!result.messages.nextPage;
    }

    logger.info(`Found ${messages.length} messages, nextCursor: ${nextCursor}`);

    console.log('messages', messages);

    res.json({
      success: true,
      message: 'Messages retrieved successfully',
      data: {
        conversationId,
        total: messages.length,
        messages: messages.map(msg => ({
          id: msg.id,
          type: msg.type,
          body: msg.body,
          direction: msg.direction || msg?.meta?.email?.direction || "outbound",
          status: msg.status,
          dateAdded: msg.dateAdded,
          attachments: msg.attachments || [],
          contactId: msg.contactId,
          conversationId: msg.conversationId,
          meta: msg.meta
        })),
        pagination: {
          hasMore: hasMore,
          nextCursor: nextCursor,
        }
      },
      meta: {
        locationId,
        conversationId,
        retrievedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('Get messages error', error, { 
      locationId: req.query?.locationId,
      conversationId: req.params?.conversationId 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to get messages',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/messages/:conversationId/download
 * @desc Download ALL messages as CSV (with all fields from GHL API)
 */
router.get('/:conversationId/download', authenticateSession, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    logger.info('Downloading ALL messages as CSV for conversation', { conversationId, locationId });

    // Fetch ALL messages with pagination (GHL max limit is 100 per request)
    let allMessages = [];
    let lastMessageId = null;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 100) { // Safety limit: max 100 pages
      pageCount++;
      
      const result = await ghlService.getMessages(locationId, conversationId, { 
        limit: 100, // GHL API maximum is 100
        lastMessageId: lastMessageId
      });
      
      let messages = [];
      if (result.messages?.messages) {
        messages = result.messages.messages;
        hasMore = !!result.messages.nextPage;
        lastMessageId = result.messages.lastMessageId;
      } else if (result.messages && Array.isArray(result.messages)) {
        messages = result.messages;
        hasMore = false;
      }

      if (messages.length === 0) {
        hasMore = false;
        logger.info(`Page ${pageCount}: No messages returned, stopping pagination`);
      } else {
        allMessages = [...allMessages, ...messages];
        logger.info(`Page ${pageCount}: Fetched ${messages.length} messages, total: ${allMessages.length}, hasMore: ${hasMore}, nextId: ${lastMessageId}`);
      }

      // Small delay to respect rate limits
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(`✅ Pagination complete! Exporting ${allMessages.length} total messages to CSV`);

    // Convert to CSV with ALL fields from GHL API
    const csvRows = [];
    
    // Header row - All fields from GHL Messages API
    csvRows.push([
      'ID',
      'Conversation ID',
      'Contact ID',
      'Location ID',
      'Type',
      'Direction',
      'Status',
      'Body',
      'Subject',
      'Date Added',
      'Date Updated',
      'User ID',
      'From',
      'To',
      'Source',
      'Message Type',
      'Content Type',
      'Attachments Count',
      'Email Message ID',
      'Thread ID',
      'Provider',
      'Alt ID'
    ].join(','));
    
    // Data rows
    allMessages.forEach(msg => {
      const row = [
        msg.id || '',
        msg.conversationId || conversationId,
        msg.contactId || '',
        msg.locationId || locationId,
        msg.type || '',
        msg.direction || '',
        msg.status || '',
        `"${(msg.body || '').replace(/"/g, '""')}"`, // Escape quotes
        `"${(msg.subject || '').replace(/"/g, '""')}"`,
        msg.dateAdded || '',
        msg.dateUpdated || '',
        msg.userId || '',
        msg.from || '',
        msg.to || '',
        msg.source || '',
        msg.messageType || '',
        msg.contentType || '',
        (msg.attachments || []).length,
        msg.emailMessageId || '',
        msg.threadId || '',
        msg.provider || '',
        msg.altId || ''
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conversation_${conversationId}_${Date.now()}.csv"`);

    res.send(csvContent);

  } catch (error) {
    logError('Download CSV error', error, { 
      locationId: req.query?.locationId,
      conversationId: req.params?.conversationId 
    });
    res.status(500).send('Error downloading messages');
  }
});

module.exports = router;

