import axios from 'axios';

export const supportAPI = {
  /**
   * Submit support ticket with images
   */
  submitTicket: async (formData) => {
    const token = localStorage.getItem('sessionToken');
    
    const response = await axios.post(
      'https://convoapi.vaultsuite.store/api/support/ticket',
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

