import apiClient from './client';

export const conversationsAPI = {
  /**
   * Download conversations with filters
   */
  download: async (locationId, filters = {}) => {
    const params = {
      locationId,
      ...filters
    };
    const response = await apiClient.get('/conversations/download', { params });
    return response;
  },

  /**
   * Search conversations
   */
  search: async (locationId, filters = {}) => {
    const params = {
      locationId,
      ...filters
    };
    const response = await apiClient.get('/conversations/search', { params });
    return response;
  },

  /**
   * Get single conversation
   */
  get: async (conversationId, locationId) => {
    const response = await apiClient.get(`/conversations/${conversationId}`, {
      params: { locationId }
    });
    return response;
  }
};

