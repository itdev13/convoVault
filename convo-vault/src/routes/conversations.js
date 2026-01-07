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
      query,  // Universal search across multiple fields
      startDate, 
      endDate,
      conversationId,
      contactId,  // Filter by specific contact
      lastMessageType,
      lastMessageDirection,
      status,
      lastMessageAction,
      sortBy,
      startAfterId  // Cursor-based pagination (GHL API standard)
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

    // Sanitize numeric parameters
    const sanitizedLimit = sanitizeLimit(limit, 20, 100);

    logger.info('Downloading conversations', { 
      locationId, 
      limit: sanitizedLimit,
      query,
      startDate,
      endDate,
      startAfterId,
      lastMessageType,
      lastMessageDirection,
      status
    });

    // Build filters with all parameters (GHL API uses cursor-based pagination)
    const filters = { limit: sanitizedLimit };
    if (query) filters.query = query;  // Universal search parameter (searches across contact_name, email, tags, etc.)
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (startAfterId) filters.startAfterDate = startAfterId;  // Cursor for pagination
    if (contactId) filters.contactId = contactId;  // Filter by specific contact
    if (lastMessageType) filters.lastMessageType = lastMessageType;
    if (lastMessageDirection) filters.lastMessageDirection = lastMessageDirection;
    if (status) filters.status = status;
    if (lastMessageAction) filters.lastMessageAction = lastMessageAction;
    if (sortBy) {
      filters.sortBy = sortBy;
      // GHL API requires sortScoreProfile when sortBy is 'score_profile'
      if (sortBy === 'score_profile') {
        filters.sortScoreProfile = 'desc'; // or 'asc'
      }
    }

    if(conversationId){
      filters.id = conversationId;
    }

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
          lastMessageType: conv.lastMessageType,
          lastMessageDirection: conv.lastMessageDirection,
          lastOutboundMessageAction: conv.lastOutboundMessageAction,
          unreadCount: conv.unreadCount,
          type: conv.type,
          status: conv.status,
          locationId: conv.locationId,
          dateAdded: conv.dateAdded,
          dateUpdated: conv.dateUpdated,
          userId: conv.userId,
          email: conv.email,
          phone: conv.phone,
          sort: conv.sort
        }))
      },
      meta: {
        locationId,
        downloadedAt: new Date().toISOString(),
        filters
      }
    });

  } catch (error) {
    logError('Download conversations error', error, { 
      locationId: req.query?.locationId,
      filters: req.query 
    });
    
    // Use error.status if it's a client error, otherwise use response status or 500
    const statusCode = error.status || error.response?.status || 500;
    const errorMessage = getUserFriendlyMessage(error);
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to download conversations',
      message: errorMessage,
      details: error.response?.data?.message || error.message
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

    // Add sortScoreProfile if sortBy is 'score_profile'
    if (filters.sortBy === 'score_profile') {
      filters.sortScoreProfile = 'desc';
    }

    const result = await ghlService.searchConversations(locationId, filters);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logError('Search conversations error', error, { 
      locationId: req.query?.locationId,
      filters: req.query 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    const errorMessage = getUserFriendlyMessage(error);
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: errorMessage,
      details: error.response?.data?.message || error.message
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
    logError('Get conversation error', error, { 
      locationId: req.query?.locationId,
      conversationId: req.params?.conversationId 
    });
    
    const statusCode = error.status || error.response?.status || 500;
    
    res.status(statusCode).json({
      success: false,
      error: getUserFriendlyMessage(error)
    });
  }
});

module.exports = router;

