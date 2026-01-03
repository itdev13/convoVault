const logger = require('./logger');

/**
 * Enhanced error logging utility
 * Extracts maximum information from error objects
 */

/**
 * Extract comprehensive error information
 */
function getErrorDetails(error) {
  if (!error) return 'Unknown error';
  
  // Try different error formats
  const message = error?.message || 
                 error?.response?.data?.message || 
                 error?.response?.data?.error ||
                 error?.response?.statusText ||
                 error?.toString() ||
                 'Unknown error';
  
  const status = error?.response?.status || error?.status || null;
  const code = error?.code || error?.response?.data?.code || null;
  const data = error?.response?.data || null;
  
  return {
    message,
    status,
    code,
    data,
    stack: error?.stack
  };
}

/**
 * Log error with comprehensive details
 */
function logError(context, error, additionalInfo = {}) {
  const errorDetails = getErrorDetails(error);
  
  logger.error(`❌ ${context}`, {
    error: errorDetails.message,
    status: errorDetails.status,
    code: errorDetails.code,
    ...additionalInfo,
    ...(process.env.NODE_ENV !== 'production' && errorDetails.data ? { apiResponse: errorDetails.data } : {}),
    ...(process.env.NODE_ENV !== 'production' && errorDetails.stack ? { stack: errorDetails.stack.split('\n').slice(0, 3).join('\n') } : {})
  });
}

/**
 * Log warning with details
 */
function logWarning(context, error, additionalInfo = {}) {
  const errorDetails = getErrorDetails(error);
  
  logger.warn(`⚠️ ${context}`, {
    warning: errorDetails.message,
    status: errorDetails.status,
    ...additionalInfo
  });
}

/**
 * Get user-friendly error message for API responses
 */
function getUserFriendlyMessage(error) {
  const errorDetails = getErrorDetails(error);
  
  // Common error messages
  if (errorDetails.status === 401) {
    return 'Authentication failed. Please reconnect your account.';
  }
  
  if (errorDetails.status === 403) {
    return 'Access denied. You don\'t have permission for this action.';
  }
  
  if (errorDetails.status === 404) {
    return 'Resource not found. It may have been deleted.';
  }
  
  if (errorDetails.status === 429) {
    return 'Too many requests. Please try again in a moment.';
  }
  
  if (errorDetails.status >= 500) {
    return 'Server error. Our team has been notified. Please try again later.';
  }
  
  // Return specific error message or generic fallback
  return errorDetails.message || 'An unexpected error occurred';
}

module.exports = {
  getErrorDetails,
  logError,
  logWarning,
  getUserFriendlyMessage
};

