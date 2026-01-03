const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');
const { sanitizeLimit, sanitizeOffset, isValidDate } = require('../utils/sanitize');

/**
 * FEATURE 1: Download Conversations
 * Search and export conversations with advanced filtering
 */

/**
 * @route GET /api/conversations/download
 * @desc Download conversations for a location
 */
router.get('/download', authenticateSession, async (req, res) => {
  try {
    const { 
      locationId, 
      limit, 
      startDate, 
      endDate,
      conversationId,
      lastMessageType,
      lastMessageDirection,
      status,
      lastMessageAction,
      sortBy,
      offset
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

    // If specific conversationId provided, fetch that conversation directly
    if (conversationId) {
      logger.info('Fetching specific conversation by ID', { locationId, conversationId });
      
      const result = await ghlService.getConversation(locationId, conversationId);
      
      // Log raw response for debugging different structures
      logger.info('📦 Single conversation API response', {
        topLevelKeys: Object.keys(result || {}),
        hasConversationKey: !!result.conversation,
        rawSample: JSON.stringify(result).substring(0, 300)
      });
      
      // Normalize single conversation to match search response format
      // GHL returns different structures: sometimes { conversation: {...} }, sometimes direct object
      const conversation = result.conversation || result;
      
      const normalized = {
        id: conversation.id,
        contactId: conversation.contactId,
        contactName: conversation.contactName || conversation.contact?.name || '',
        locationId: conversation.locationId,
        lastMessageBody: conversation.lastMessageBody || '',
        lastMessageType: conversation.lastMessageType || conversation.type || '',
        lastMessageDirection: conversation.lastMessageDirection || '',
        lastMessageDate: conversation.lastMessageDate || conversation.dateUpdated || '',
        dateAdded: conversation.dateAdded || conversation.dateCreated || '',
        unreadCount: conversation.unreadCount || 0,
        status: conversation.status || '',
        type: conversation.type || conversation.lastMessageType || ''
      };
      
      logger.info('✅ Normalized conversation for export', {
        hasType: !!normalized.type,
        hasDirection: !!normalized.lastMessageDirection,
        normalized
      });
      
      return res.json({
        success: true,
        message: 'Conversation retrieved successfully',
        data: {
          conversations: [normalized],
          total: 1
        }
      });
    }

    // Sanitize numeric parameters
    const sanitizedLimit = sanitizeLimit(limit, 20, 100);
    const sanitizedOffset = sanitizeOffset(offset, 0);

    logger.info('Downloading conversations', { 
      locationId, 
      limit: sanitizedLimit,
      startDate,
      endDate,
      lastMessageType,
      lastMessageDirection,
      status
    });

    // Build filters with all parameters
    const filters = { limit: sanitizedLimit };
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (sanitizedOffset > 0) filters.offset = sanitizedOffset;
    if (lastMessageType) filters.lastMessageType = lastMessageType;
    if (lastMessageDirection) filters.lastMessageDirection = lastMessageDirection;
    if (status) filters.status = status;
    if (lastMessageAction) filters.lastMessageAction = lastMessageAction;
    if (sortBy) filters.sortBy = sortBy;

    logger.info('📤 Filters being sent to GHL API', { filters });

    // Fetch conversations from API
    const result = await ghlService.searchConversations(locationId, filters);

    const conversations = result.conversations || [];

    res.json({
      success: true,
      message: 'Conversations downloaded successfully',
      data: {
        total: conversations.length,
        conversations: conversations.map(conv => ({
          id: conv.id,
          contactId: conv.contactId,
          contactName: conv.contactName,
          lastMessageDate: conv.lastMessageDate,
          lastMessageBody: conv.lastMessageBody,
          unreadCount: conv.unreadCount,
          type: conv.type
        }))
      },
      meta: {
        locationId,
        downloadedAt: new Date().toISOString(),
        filters
      }
    });

  } catch (error) {
    logError('Download conversations error', error, { locationId, filters });
    res.status(500).json({
      success: false,
      error: 'Failed to download conversations',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/conversations/search
 * @desc Search conversations with filters
 */
router.get('/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, conversationId, ...filters } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    // If specific conversationId provided, fetch that conversation directly
    if (conversationId) {
      logger.info('Fetching specific conversation by ID', { locationId, conversationId });
      
      const result = await ghlService.getConversation(locationId, conversationId);
      
      // Normalize single conversation to match search response format
      const conversation = result.conversation || result;
      const normalized = {
        id: conversation.id,
        contactId: conversation.contactId,
        contactName: conversation.contactName || conversation.contact?.name || '',
        locationId: conversation.locationId,
        lastMessageBody: conversation.lastMessageBody || '',
        lastMessageType: conversation.lastMessageType || conversation.type || '',
        lastMessageDirection: conversation.lastMessageDirection || '',
        lastMessageDate: conversation.lastMessageDate || conversation.dateUpdated || '',
        dateAdded: conversation.dateAdded || conversation.dateCreated || '',
        unreadCount: conversation.unreadCount || 0,
        status: conversation.status || '',
        type: conversation.type || conversation.lastMessageType || ''
      };
      
      return res.json({
        success: true,
        data: {
          conversations: [normalized],
          total: 1
        }
      });
    }

    const result = await ghlService.searchConversations(locationId, filters);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logError('Search conversations error', error, { locationId, filters });
    res.status(500).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/conversations/:conversationId
 * @desc Get specific conversation details
 */
router.get('/:conversationId', authenticateSession, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const conversation = await ghlService.getConversation(locationId, conversationId);

    res.json({
      success: true,
      data: conversation
    });

  } catch (error) {
    logError('Get conversation error', error, { locationId, conversationId });
    res.status(500).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

module.exports = router;

