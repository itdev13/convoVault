import apiClient from './client';

export const billingAPI = {
  /**
   * Get cost estimate for export
   * @param {string} locationId - Location ID
   * @param {string} exportType - 'conversations' or 'messages'
   * @param {Object} filters - Export filters { channel, startDate, endDate, contactId }
   */
  getEstimate: async (locationId, exportType, exportFilters = {}) => {
    const response = await apiClient.post('/billing/estimate', {
      locationId,
      exportType,
      filters:exportFilters
    });
    return response;
  },

  /**
   * Charge wallet and start export
   * @param {string} locationId - Location ID
   * @param {string} exportType - 'conversations' or 'messages'
   * @param {string} format - 'csv' or 'json'
   * @param {Object} filters - Export filters
   * @param {string} notificationEmail - Email for notification (optional)
   */
  chargeAndExport: async (locationId, exportType, format, filters = {}, notificationEmail = null) => {
    const response = await apiClient.post('/billing/charge-and-export', {
      locationId,
      exportType,
      format,
      filters,
      notificationEmail
    });
    return response;
  },

  /**
   * Get export job status
   * @param {string} jobId - Export job ID
   * @param {string} locationId - Location ID (for verification)
   */
  getExportStatus: async (jobId, locationId) => {
    const response = await apiClient.get(`/billing/export-status/${jobId}`, {
      params: { locationId }
    });
    return response;
  },

  /**
   * Get export history for location with pagination
   * @param {string} locationId - Location ID
   * @param {number} page - Page number (default 1)
   * @param {number} limit - Max number of jobs per page (default 10)
   */
  getExportHistory: async (locationId, page = 1, limit = 10) => {
    const response = await apiClient.get('/billing/export-history', {
      params: { locationId, page, limit }
    });
    return response;
  },

  /**
   * Get pricing information
   */
  getPricing: async () => {
    const response = await apiClient.get('/billing/pricing');
    return response;
  },

  /**
   * Get pipelines for a location
   * @param {string} locationId - Location ID
   */
  getPipelines: async (locationId) => {
    const response = await apiClient.get('/billing/pipelines', {
      params: { locationId }
    });
    return response;
  },

  /**
   * Get forms for a location
   * @param {string} locationId - Location ID
   */
  getForms: async (locationId) => {
    const response = await apiClient.get('/billing/forms', {
      params: { locationId }
    });
    return response;
  },

  /**
   * Search tasks for a location (preview)
   */
  searchTasks: async (locationId, filters = {}, skip = 0, limit = 25) => {
    const response = await apiClient.post('/billing/tasks/search', {
      locationId,
      filters,
      skip,
      limit
    });
    return response;
  }
};
