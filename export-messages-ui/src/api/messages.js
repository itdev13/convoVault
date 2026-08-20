import apiClient from './client';

export const messagesAPI = {
  /**
   * Get messages for a conversation with pagination
   */
  get: async (conversationId, locationId, options = {}) => {
    const params = {
      locationId,
      limit: options.limit || 100
    };
    
    if (options.lastMessageId) {
      params.lastMessageId = options.lastMessageId;
    }
    
    if (options.sortOrder) {
      params.sortOrder = options.sortOrder;
    }
    
    const response = await apiClient.get(`/messages/${conversationId}`, { params });
    return response;
  },

  /**
   * Download messages as CSV
   */
  download: async (conversationId, locationId) => {
    // Get session token
    const token = localStorage.getItem('sessionToken');
    
    // Open download in new window
    const url = `/api/messages/${conversationId}/download?locationId=${locationId}&token=${token}`;
    window.open(url, '_blank');
  }
};

