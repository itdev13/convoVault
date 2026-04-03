import axios from 'axios';
import { API_URL } from '../constants/api';

// Create axios instance
// Production backend on AWS ALB
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 600000, // 10 minute timeout (allow for tag resolution + note counting)
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

      // Check if it's a session token expiration (TOKEN_EXPIRED)
      // Reload the page to trigger fresh authentication from GHL context
      const errorCode = error.response?.data?.code;
      if (errorCode === 'TOKEN_EXPIRED') {
        console.log('[apiClient] Session expired - reloading to re-authenticate');
        window.location.reload();
        return; // Prevent further error handling
      }
    }
    
    // Extract comprehensive error message from backend
    // Priority: details > message > error
    const backendDetails = error.response?.data?.details;
    const backendMessage = error.response?.data?.message || error.response?.data?.error;
    
    let message;
    let details;
    
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      message = 'Request timeout. The server is taking too long to respond. Please try again.';
    } else if (error.code === 'ERR_NETWORK') {
      message = 'Network error. Please check your internet connection.';
    } else if (backendDetails) {
      // Details field often contains the specific error (like "Company token expired")
      message = backendDetails;
      details = backendDetails;
    } else if (backendMessage) {
      message = backendMessage;
    } else if (error.response?.status === 429) {
      message = 'Too many requests. Please wait a moment before trying again.';
    } else if (error.response?.status >= 500) {
      message = 'Server error. Please try again in a moment.';
    } else {
      message = error.message || 'An unexpected error occurred';
    }
    
    // Create enhanced error with all relevant info
    const enhancedError = new Error(message);
    enhancedError.status = error.response?.status;
    enhancedError.code = error.code;
    enhancedError.details = details || backendDetails;
    
    return Promise.reject(enhancedError);
  }
);

export default apiClient;

