import apiClient from './client';

export const contactsAPI = {
  search: async (locationId, query = '', limit = 100) => {
    return await apiClient.get('/api/billing/contacts/search', {
      params: { locationId, query, limit }
    });
  },

  fetchNotes: async (locationId, contactId) => {
    return await apiClient.get(`/api/billing/contacts/${contactId}/notes`, {
      params: { locationId }
    });
  }
};
