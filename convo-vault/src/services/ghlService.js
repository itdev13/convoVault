const axios = require('axios');
const logger = require('../utils/logger');
const { logError, logWarning } = require('../utils/errorLogger');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');

/**
 * Simple GHL API Service
 */
class GHLService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
    this.oauthURL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
  }

  /**
   * Exchange code for token
   */
  async getAccessToken(code) {
    try {
      const params = new URLSearchParams();
      params.append('client_id', process.env.GHL_CLIENT_ID);
      params.append('client_secret', process.env.GHL_CLIENT_SECRET);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);

      const response = await axios.post(`${this.oauthURL}/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      console.log(JSON.stringify(response.data, null, 2));

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        locationId: response.data.locationId,
        companyId: response.data.companyId
      };
    } catch (error) {
      logger.error('Token exchange failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append('client_id', process.env.GHL_CLIENT_ID);
      params.append('client_secret', process.env.GHL_CLIENT_SECRET);
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);

      const response = await axios.post(`${this.oauthURL}/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      logger.error('Token refresh failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Generate location-level token from company token
   * Required when company-level token can't access location APIs
   */
  async getLocationTokenFromCompany(companyId, locationId, retryCount = 0) {
    try {
      logger.info('Generating location token from company token');
      
      // Get company token
      let companyToken = await OAuthToken.findOne({ 
        companyId, 
        tokenType: 'company',
        isActive: true 
      });

      if (!companyToken) {
        throw new Error('No company token found');
      }

      console.log('companyToken', JSON.stringify(companyToken, null, 2));

      // IMPORTANT: Refresh company token if it's expired/expiring
      if (companyToken.needsRefresh()) {
        logger.info('Company token needs refresh before generating location token');
        try {
          const refreshedToken = await this.refreshAccessToken(companyToken.refreshToken);

          companyToken.accessToken = refreshedToken.accessToken;
          companyToken.refreshToken = refreshedToken.refreshToken;
          companyToken.expiresAt = new Date(Date.now() + refreshedToken.expiresIn * 1000);
          await companyToken.save();

          logger.info('✅ Company token refreshed successfully');
        } catch (refreshError) {
          // Handle "invalid_grant" - refresh token was already used by another process
          if (refreshError.response?.data?.error === 'invalid_grant') {
            logger.info('Company refresh token already used, fetching latest...');

            // Re-fetch latest company token from DB
            const latestCompanyToken = await OAuthToken.findOne({
              companyId,
              tokenType: 'company',
              isActive: true
            });

            if (latestCompanyToken && latestCompanyToken.accessToken !== companyToken.accessToken) {
              logger.info('Using company token refreshed by another process');
              companyToken.accessToken = latestCompanyToken.accessToken;
              companyToken.refreshToken = latestCompanyToken.refreshToken;
              companyToken.expiresAt = latestCompanyToken.expiresAt;
            } else {
              logger.error('Failed to refresh company token:', refreshError.message);
              throw new Error('Company token expired. Please reconnect your account.');
            }
          } else {
            logger.error('Failed to refresh company token:', refreshError.message);
            throw new Error('Company token expired. Please reconnect your account.');
          }
        }
      }

      // Call GHL API to get location token using the valid company token
      const response = await axios.post(
        `${this.oauthURL}/locationToken`,
        {
          companyId,
          locationId
        },
        {
          headers: {
            'Authorization': `Bearer ${companyToken.accessToken}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          }
        }
      );

      logger.info('✅ Location token generated successfully');

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      // If we get 401 and haven't retried yet, refresh company token and retry
      if (error.response?.status === 401 && retryCount === 0) {
        logger.info('🔄 Got 401 generating location token, refreshing company token and retrying...');

        try {
          // Force refresh the company token
          const companyToken = await OAuthToken.findOne({
            companyId,
            tokenType: 'company',
            isActive: true
          });

          if (!companyToken || !companyToken.refreshToken) {
            throw new Error('No company refresh token available');
          }

          // Check if token was recently refreshed by another process
          const expiresIn = companyToken.expiresAt - Date.now();
          if (expiresIn > 23 * 60 * 60 * 1000) {
            logger.info('Company token was recently refreshed, retrying with new token');
            return await this.getLocationTokenFromCompany(companyId, locationId, retryCount + 1);
          }

          try {
            const refreshedToken = await this.refreshAccessToken(companyToken.refreshToken);

            companyToken.accessToken = refreshedToken.accessToken;
            companyToken.refreshToken = refreshedToken.refreshToken;
            companyToken.expiresAt = new Date(Date.now() + refreshedToken.expiresIn * 1000);
            await companyToken.save();

            logger.info('✅ Company token refreshed after 401, retrying location token generation');
          } catch (refreshErr) {
            // Handle "invalid_grant" - refresh token was already used
            if (refreshErr.response?.data?.error === 'invalid_grant') {
              logger.info('Company refresh token already used, fetching latest...');

              const latestToken = await OAuthToken.findOne({
                companyId,
                tokenType: 'company',
                isActive: true
              });

              if (!latestToken || latestToken.accessToken === companyToken.accessToken) {
                throw refreshErr;
              }
              logger.info('Using company token refreshed by another process');
            } else {
              throw refreshErr;
            }
          }

          // Retry ONCE
          return await this.getLocationTokenFromCompany(companyId, locationId, retryCount + 1);

        } catch (refreshError) {
          logger.error('❌ Company token refresh failed:', refreshError.message);
          const authError = new Error('Your authentication has expired. Please reconnect the convo-vault app to your GHL account.');
          authError.status = 401;
          authError.isClientError = true;
          throw authError;
        }
      }

      // If we get 401 even after refresh, the company token is invalid
      if (error.response?.status === 401) {
        logger.error('Company token is invalid or expired after retry. User needs to reconnect.');
        const authError = new Error('Your authentication has expired. Please reconnect the convo-vault app to your GHL account.');
        authError.status = 401;
        authError.isClientError = true;
        throw authError;
      }
      
      logger.error('Failed to generate location token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get valid access token (auto-refresh if needed)
   * Handles both location and company tokens
   */
  async getValidToken(locationId) {
    // STEP 1: Try to find location-specific token first (preferred)
    let tokenDoc = await OAuthToken.findOne({ 
      locationId, 
      tokenType: 'location',
      isActive: true 
    });

    // STEP 2: If no location token exists, find company via CompanyLocation mapping
    if (!tokenDoc) {
      logger.info('No location token found, looking up company for location:', locationId);

      // Look up which company owns this locationId
      const companyLoc = await CompanyLocation.findCompanyByLocation(locationId);
      if (!companyLoc) {
        const error = new Error('Location not found. Please reconnect ExportKit application to your account.');
        error.status = 404;
        error.isClientError = true;
        throw error;
      }

      // Get the company's OAuth token
      const companyToken = await OAuthToken.findOne({
        companyId: companyLoc.companyId,
        tokenType: 'company',
        isActive: true
      });

      if (!companyToken) {
        const error = new Error('Company token expired. Please reconnect ExportKit application to your account.');
        error.status = 401;
        error.isClientError = true;
        throw error;
      }

      // Generate location token from company token
      logger.info('Generating location token from company token for:', locationId);
      const locationToken = await this.getLocationTokenFromCompany(
        companyLoc.companyId,
        locationId
      );

      // Store location-specific token
      tokenDoc = await OAuthToken.findOneAndUpdate(
        { locationId, tokenType: 'location' },
        {
          locationId,
          companyId: companyLoc.companyId,
          tokenType: 'location',
          accessToken: locationToken.accessToken,
          refreshToken: locationToken.refreshToken,
          expiresAt: new Date(Date.now() + locationToken.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      logger.info('✅ Location token created and saved to database');
    } else {
      logger.info('Using existing location token');
    }

    // STEP 3: Refresh if needed
    if (tokenDoc.needsRefresh()) {
      logger.info('Refreshing token for location:', locationId);

      try {
        const newToken = await this.refreshAccessToken(tokenDoc.refreshToken);

        tokenDoc.accessToken = newToken.accessToken;
        tokenDoc.refreshToken = newToken.refreshToken;
        tokenDoc.expiresAt = new Date(Date.now() + newToken.expiresIn * 1000);
        await tokenDoc.save();

        logger.info('✅ Token refreshed successfully');
      } catch (refreshErr) {
        // Handle "invalid_grant" - refresh token was already used by another process
        if (refreshErr.response?.data?.error === 'invalid_grant') {
          logger.info('Refresh token already used by another process, fetching latest...');

          // Re-fetch latest token from DB
          const latestToken = await OAuthToken.findActiveToken(locationId);
          if (latestToken && latestToken.accessToken !== tokenDoc.accessToken) {
            logger.info('Using token refreshed by another process');
            return latestToken.accessToken;
          }
        }
        throw refreshErr;
      }
    }

    return tokenDoc.accessToken;
  }

  /**
   * Get sub-account details
   */
  async getLocationDetails(locationId) {
    try {
      logger.info('Fetching sub-account details for:', locationId);
      
      const response = await this.apiRequest(
        'GET',
        `/locations/${locationId}`,
        locationId
      );

      // Extract relevant sub-account data
      const location = response.location || response;
      
      return {
        locationName: location.name || null,
        locationEmail: location.email || null,
        locationPhone: location.phone || null,
        locationAddress: location.address || null,
        locationWebsite: location.website || null,
        locationTimezone: location.timezone || null
      };
    } catch (error) {
      console.log(JSON.stringify(error, null, 2));
      logger.error('Failed to fetch sub-account details:', error.message);
      // Return null values if fetch fails (non-critical)
      return {
        locationName: null,
        locationEmail: null,
        locationPhone: null,
        locationAddress: null,
        locationWebsite: null,
        locationTimezone: null
      };
    }
  }

  /**
   * Get all sub-accounts for a company (using company-level token)
   */
  async getCompanyLocations(companyId, companyAccessToken) {
    try {
      logger.info('Fetching sub-accounts for company:', companyId);
      
      const response = await axios.get(`${this.baseURL}/locations/search`, {
        headers: {
          'Authorization': `Bearer ${companyAccessToken}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        },
        params: {
          companyId: companyId,
          limit: 100 // Adjust as needed
        }
      });

      const locations = response.data.locations || [];
      logger.info(`Found ${locations.length} sub-accounts for company`);
      
      return locations.map(loc => ({
        locationId: loc.id,
        locationName: loc.name,
        locationEmail: loc.email || null,
        locationPhone: loc.phone || null,
        locationAddress: loc.address || null,
        locationWebsite: loc.website || null,
        locationTimezone: loc.timezone || null
      }));
    } catch (error) {
      logger.error('Failed to fetch company sub-accounts:', error.message);
      console.log(JSON.stringify(error.response?.data || error, null, 2));
      return [];
    }
  }

  /**
   * Make authenticated API request with auto-retry on 401
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {string} locationId - Location ID
   * @param {*} data - Request body
   * @param {*} params - Query params
   * @param {number} retryCount - Internal retry counter
   */
  async apiRequest(method, endpoint, locationId, data = null, params = null, retryCount = 0) {
    try {
    const accessToken = await this.getValidToken(locationId);
    const config = {
      method,
      url: `${this.baseURL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    };

    if (data) config.data = data;
    if (params) config.params = params;
      
    const response = await axios(config);
    return response.data;

    } catch (error) {
      // If 401 Unauthorized and haven't retried yet
      if (error.response?.status === 401 && retryCount === 0) {
        logger.info('🔄 Got 401, attempting token refresh and retry...');

        try {
          // CRITICAL: Re-fetch latest token from DB to avoid race condition
          // Another request might have already refreshed the token
          const tokenDoc = await OAuthToken.findActiveToken(locationId);

          if (!tokenDoc || !tokenDoc.refreshToken) {
            throw new Error('No refresh token available');
          }

          // Check if token was recently refreshed by another process (within last 5 minutes)
          // If expiry is more than 23 hours away, token was just refreshed
          const expiresIn = tokenDoc.expiresAt - Date.now();
          if (expiresIn > 23 * 60 * 60 * 1000) {
            logger.info('Token was recently refreshed by another process, retrying with new token');
            return await this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
          }

          logger.info('Refreshing token after 401 error');

          try {
            const newToken = await this.refreshAccessToken(tokenDoc.refreshToken);

            // Update token in database
            tokenDoc.accessToken = newToken.accessToken;
            tokenDoc.refreshToken = newToken.refreshToken;
            tokenDoc.expiresAt = new Date(Date.now() + newToken.expiresIn * 1000);
            await tokenDoc.save();

            logger.info('✅ Token refreshed, retrying API call');
          } catch (refreshErr) {
            // Handle "invalid_grant" - refresh token was already used by another process
            if (refreshErr.response?.data?.error === 'invalid_grant') {
              logger.info('Refresh token already used by another process, fetching latest...');

              // Re-fetch - another process should have updated the token
              const latestToken = await OAuthToken.findActiveToken(locationId);
              if (latestToken && latestToken.accessToken !== tokenDoc.accessToken) {
                logger.info('Using token refreshed by another process');
                // Continue to retry with the new token
              } else {
                throw refreshErr;
              }
            } else {
              throw refreshErr;
            }
          }

          // Retry the request ONCE
          return await this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);

        } catch (refreshError) {
          logger.error('❌ Token refresh failed:', refreshError.message);

          // If refresh fails, throw proper error
          throw new Error('Authentication failed. Please reconnect your account.');
        }
      }

      // For other errors or after retry failed, throw original error
      logger.error(`API request failed: ${method} ${endpoint}`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message
      });
      
      throw error;
    }
  }

  /**
   * Search conversations with advanced filters
   * Reference: https://marketplace.gohighlevel.com/docs/ghl/conversations/search-conversation
   * 
   * Supported GHL API Parameters (verify in docs):
   * - locationId (required)
   * - limit, offset
   * - status (all, read, unread, starred)
   * - sortBy (last_message_date, dateUpdated)
   * - lastMessageType, lastMessageDirection
   * 
   * Note: startDate/endDate support varies by API version
   */
  async searchConversations(locationId, filters = {}) {
    // Build query params with all supported filters
    const params = {
      locationId,
      limit: filters.limit || 20
    };

    // Copy filters, converting dates to timestamps for GHL API
    Object.keys(filters).forEach(key => {
     if (key === 'startDate' || key === 'endDate') {
        const dateValue = filters[key];

        if (dateValue) {
          const dateStr = String(dateValue).trim();

          let date;

          // If already a millisecond timestamp
          if (!isNaN(Number(dateStr)) && !dateStr.includes('T') && !dateStr.includes('-')) {
            date = new Date(Number(dateStr));
          } else {
            date = new Date(dateStr);
          }

          if (!isNaN(date.getTime())) {
            if (key === 'startDate') {
              // Set to 12:00 AM
              date.setHours(0, 0, 0, 0);
            }

            if (key === 'endDate') {
              // Set to 11:59:59.999 PM
              date.setHours(23, 59, 59, 999);
            }

            params[key] = date.getTime(); // Convert to millisecond timestamp
          }
        }
      } else if (filters[key] !== '' && filters[key] !== null && filters[key] !== undefined) {
        params[key] = filters[key];
      }
    });

    logger.info('🔍 Searching conversations with filters', { 
      locationId, 
      params: JSON.stringify(params)
    });

    try {
      const result = await this.apiRequest(
        'GET',
        '/conversations/search',
        locationId,
        null,
        params
      );
      
      logger.info('✅ Conversations search successful', {
        count: result.conversations?.length || 0
      });
      
      return result;
      
    } catch (error) {
      logger.error('❌ GHL API rejected conversation search', {
        status: error.response?.status,
        error: error.response?.data,
        sentParams: params
      });
      throw error;
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(locationId, conversationId) {
    try {
      const result = await this.apiRequest(
        'GET',
        `/conversations/${conversationId}`,
        locationId
      );
      
      logger.info('✅ Single conversation fetched', {
        conversationId,
        hasType: !!result.type,
        hasLastMessageType: !!result.lastMessageType,
        hasDirection: !!result.lastMessageDirection
      });
      
      return result;
      
    } catch (error) {
      logger.error('❌ Failed to fetch conversation', {
        conversationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get messages for a conversation with pagination support
   */
  async getMessages(locationId, conversationId, options = {}) {
    const params = {
      limit: options.limit || 100
    };

    // Add pagination cursor if provided
    if (options.lastMessageId) {
      params.lastMessageId = options.lastMessageId;
    }

    // Add sorting
    if (options.sortOrder) {
      params.sortOrder = options.sortOrder; // 'asc' or 'desc'
    }

    return await this.apiRequest(
      'GET',
      `/conversations/${conversationId}/messages`,
      locationId,
      null,
      params
    );
  }

  /**
   * Export messages with advanced filters
   * Includes conversationId in response and supports cursor pagination
   */
  async exportMessages(locationId, options = {}) {
    try {
      const params = {
        locationId: locationId,
        limit: options.limit || 100
      };

      console.log('options', options);

      // Channel filter (omit for all non-email, or specify: SMS, Email, WhatsApp, Call, etc.)
      if (options.channel && options.channel !== 'undefined' && options.channel.trim()) {
        params.channel = options.channel;
      }

      // Cursor for pagination (valid for 2 minutes)
      if (options.cursor && options.cursor !== 'undefined' && options.cursor.trim()) {
        params.cursor = options.cursor;
      }

      if (options.startDate) {
         // Pass as ISO string for messages API
         params.startDate = typeof options.startDate === 'string'
           ? options.startDate
           : new Date(options.startDate).toISOString();
      }

      if (options.endDate) {
          // Pass as ISO string for messages API
          params.endDate = typeof options.endDate === 'string'
            ? options.endDate
            : new Date(options.endDate).toISOString();
      }

      // Contact filter
      if (options.contactId && options.contactId !== 'undefined' && options.contactId.trim()) {
        params.contactId = options.contactId;
      }

      // Conversation filter
      if (options.conversationId && options.conversationId !== 'undefined' && options.conversationId.trim()) {
        params.conversationId = options.conversationId;
      }

      console.log('params', params);

      const response = await this.apiRequest(
        'GET',
        '/conversations/messages/export',
        locationId,
        null,
        params
      );

      return response;
    } catch (error) {
      logger.error('Export failed:', error);
      throw error;
    }
  }

  /**
   * Export all messages with automatic pagination
   */
  async exportAllMessages(locationId, filters = {}, onProgress = null) {
    const allMessages = [];
    let cursor = null;
    let totalFetched = 0;

    try {
      do {
        const options = { ...filters, limit: 100 };
        if (cursor) options.cursor = cursor;

        const response = await this.exportMessages(locationId, options);
        
        if (response.messages && response.messages.length > 0) {
          allMessages.push(...response.messages);
          totalFetched += response.messages.length;

          if (onProgress) {
            onProgress(totalFetched, response.total || totalFetched);
          }
        }

        cursor = response.nextCursor || null;

        // Rate limiting
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } while (cursor);

      logger.info(`Export complete: ${totalFetched} messages`);
      return allMessages;
      
    } catch (error) {
      logger.error('Bulk export failed:', error.message);
      throw error;
    }
  }

  /**
   * Send message
   */
  async sendMessage(locationId, data) {
    return await this.apiRequest(
      'POST',
      '/conversations/messages',
      locationId,
      data
    );
  }

  /**
   * Validate location exists
   * https://marketplace.gohighlevel.com/docs/ghl/locations/get-location
   */
  async validateLocation(locationId) {
    try {
      const response = await this.apiRequest(
        'GET',
        `/locations/${locationId}`,
        locationId
      );
      return !!response.location || !!response;
    } catch (error) {
      logger.error('Location validation failed:', error.message);
      return false;
    }
  }

  /**
   * Upsert contact (create or update)
   * https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact
   */
  async upsertContact(locationId, contactData) {
    try {
      logger.info('Upserting contact', { locationId, email: contactData.email, phone: contactData.phone });
      
      // Add locationId to request body (required by GHL API)
      const requestBody = {
        ...contactData,
        locationId: locationId
      };
      
      const response = await this.apiRequest(
        'POST',
        '/contacts/upsert',
        locationId,
        requestBody
      );

      logger.info('Contact upserted successfully', { contactId: response.contact?.id || response.id });
      return response.contact || response;
    } catch (error) {
      logger.error('Upsert contact failed:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Failed to create contact: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create conversation
   * https://marketplace.gohighlevel.com/docs/ghl/conversations/create-conversation
   */
  async createConversation(locationId, conversationData) {
    try {
      logger.info('Creating conversation', { contactId: conversationData.contactId });
      
      const response = await this.apiRequest(
        'POST',
        '/conversations/',
        locationId,
        conversationData
      );

      logger.info('Conversation created successfully', { conversationId: response.conversation?.id || response.id });
      return response.conversation || response;
    } catch (error) {
      logger.error('Create conversation failed:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Failed to create conversation: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = new GHLService();

