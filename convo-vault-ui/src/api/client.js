import axios from 'axios';

// Create axios instance
// Use cloudflare tunnel for backend
const apiClient = axios.create({
  baseURL: 'https://convo-vault.vercel.app/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
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
    
    const message = error.response?.data?.error || error.message || 'An error occurred';
    return Promise.reject(new Error(message));
  }
);

export default apiClient;

