import axios from 'axios';
import { API_URL } from '../constants/api';

export const supportAPI = {
  /**
   * Submit support ticket with images
   */
  submitTicket: async (formData) => {
    const token = localStorage.getItem('sessionToken');
    
    const response = await axios.post(
      `${API_URL}/support/ticket`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    return response.data;
  }
};

