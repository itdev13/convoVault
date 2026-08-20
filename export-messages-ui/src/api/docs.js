import apiClient from './client';

export const docsAPI = {
  /**
   * Get temporary access token for API documentation
   */
  getAccess: async () => {
    const response = await apiClient.post('/docs/access');
    return response;
  }
};

