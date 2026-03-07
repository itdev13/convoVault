import apiClient from './client';

export const contactsAPI = {
  search: async (locationId, query = '', limit = 20) => {
    return await apiClient.get('/api/billing/contacts/search', {
      params: { locationId, query, limit }
    });
  }
};
