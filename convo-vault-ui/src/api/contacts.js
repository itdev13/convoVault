import apiClient from './client';

export const contactsAPI = {
  search: async (locationId, query = '', limit = 100) => {
    return await apiClient.get('/billing/contacts/search', {
      params: { locationId, query, limit }
    });
  },

  fetchNotes: async (locationId, contactId) => {
    return await apiClient.get(`/billing/contacts/${contactId}/notes`, {
      params: { locationId }
    });
  },

  fetchTasks: async (locationId, contactId) => {
    return await apiClient.get(`/billing/contacts/${contactId}/tasks`, {
      params: { locationId }
    });
  }
};
