import apiClient from './client';
import { API_URL } from '../constants/api';

export const exportAPI = {
  /**
   * Export messages with filters (paginated)
   */
  exportMessages: async (locationId, filters = {}) => {
    const params = {
      locationId,
      ...filters
    };
    const response = await apiClient.get('/export/messages', { params });
    return response;
  },

  /**
   * Export all messages (bulk)
   */
  exportAll: async (locationId, filters = {}) => {
    const params = {
      locationId,
      ...filters
    };
    const response = await apiClient.get('/export/messages/all', { params });
    return response;
  },

  /**
   * Download as CSV
   */
  downloadCSV: async (locationId, filters = {}) => {
    const params = new URLSearchParams({
      locationId,
      ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
    });
    
    // Get session token for Authorization header
    const token = localStorage.getItem('sessionToken');
    
    // Use fetch with proper headers
    const response = await fetch(`${API_URL}/export/csv?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to download CSV');
    }
    
    // Get filename from header or use default
    const contentDisposition = response.headers.get('content-disposition');
    const filename = contentDisposition 
      ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
      : `messages_${Date.now()}.csv`;
    
    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
};

