import apiClient from './client';

export const usersAPI = {
  search: async (locationId, query = '') => {
    return await apiClient.get('/billing/users', {
      params: { locationId, query }
    });
  }
};
