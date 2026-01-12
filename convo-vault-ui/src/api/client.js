import axios from 'axios';
import { API_URL } from '../constants/api';

// Create axios instance
// Production backend on AWS ALB
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout (allow for large exports)
  withCredentials: true
});

// Request interceptor - Add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle errors
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // Don't auto-reload on 401 during initial authentication
    if (error.response?.status === 401 && !error.config.url.includes('/auth/verify')) {
      // Unauthorized - clear session (only for non-verify endpoints)
      localStorage.removeItem('sessionToken');
    }
    
    // Extract comprehensive error message from backend
    const backendMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.response?.data?.details;
    
    let message;
    
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      message = 'Request timeout. The server is taking too long to respond. Please try again.';
    } else if (error.code === 'ERR_NETWORK') {
      message = 'Network error. Please check your internet connection.';
    } else if (backendMessage) {
      message = backendMessage;
    } else if (error.response?.status === 429) {
      message = 'Too many requests. Please wait a moment before trying again.';
    } else if (error.response?.status >= 500) {
      message = 'Server error. Please try again in a moment.';
    } else {
      message = error.message || 'An unexpected error occurred';
    }
    
    // Add status code to error for debugging
    const enhancedError = new Error(message);
    enhancedError.status = error.response?.status;
    enhancedError.code = error.code;
    
    return Promise.reject(enhancedError);
  }
);

export default apiClient;

