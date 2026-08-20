import apiClient from './client';

export const notificationsAPI = {
  subscribe: async (feature, email, locationId, userId) => {
    return await apiClient.post('/notifications/subscribe', { feature, email, locationId, userId });
  }
};
