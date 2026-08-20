import apiClient from './client';

export const customFieldsAPI = {
  list: async (locationId, model = 'all') => {
    return await apiClient.get('/locations/custom-fields', {
      params: { locationId, model }
    });
  }
};

export const customValuesAPI = {
  list: async (locationId, documentType = 'all') => {
    return await apiClient.get('/locations/custom-values', {
      params: { locationId, documentType }
    });
  }
};

export const tagsAPI = {
  list: async (locationId) => {
    return await apiClient.get('/locations/tags', {
      params: { locationId }
    });
  }
};
