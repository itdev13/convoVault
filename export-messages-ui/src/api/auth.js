import apiClient from './client';

export const authAPI = {
  /**
   * Verify user context and create session
   */
  verify: async ({ locationId, companyId, userId }) => {
    const response = await apiClient.post('/auth/verify', {
      locationId,
      companyId,
      userId
    });
    return response;
  },

  /**
   * Refresh session token
   */
  refresh: async () => {
    const response = await apiClient.post('/auth/refresh');
    return response;
  },

  /**
   * Get current session info
   */
  getSession: async () => {
    const response = await apiClient.get('/auth/session');
    return response;
  },

  /**
   * Get all sub-accounts for company
   */
  getLocations: async () => {
    const response = await apiClient.get('/auth/locations');
    return response;
  }
};

