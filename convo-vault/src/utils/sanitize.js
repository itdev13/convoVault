const validator = require('validator');

/**
 * Security utilities for input sanitization and validation
 */

/**
 * HTML escape to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  
  return String(text).replace(/[&<>"'/]/g, (char) => map[char]);
}

/**
 * Sanitize email
 */
function sanitizeEmail(email) {
  if (!email) return null;
  return validator.normalizeEmail(email);
}

/**
 * Validate and sanitize limit parameter
 */
function sanitizeLimit(limit, defaultValue = 20, maxValue = 100) {
  const parsedLimit = parseInt(limit);
  
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    return defaultValue;
  }
  
  return Math.min(parsedLimit, maxValue);
}

/**
 * Validate and sanitize offset parameter
 */
function sanitizeOffset(offset, defaultValue = 0) {
  const parsedOffset = parseInt(offset);
  
  if (isNaN(parsedOffset) || parsedOffset < 0) {
    return defaultValue;
  }
  
  return parsedOffset;
}

/**
 * Validate ISO date string or millisecond timestamp
 */
function isValidDate(dateInput) {
  if (!dateInput) return false;
  
  const dateStr = String(dateInput).trim();
  
  // Check if it's a number (millisecond timestamp) - numeric string without 'T'
  if (!isNaN(Number(dateStr)) && !dateStr.includes('T') && !dateStr.includes('-')) {
    const timestamp = Number(dateStr);
    // Valid timestamp range: between 1970 and 2100 (reasonable bounds)
    return timestamp > 0 && timestamp < 4102444800000; // Jan 1, 2100
  }
  
  // Check if it's an ISO 8601 string
  return validator.isISO8601(dateStr);
}

/**
 * Validate MongoDB ObjectId
 */
function isValidObjectId(id) {
  if (!id) return false;
  return validator.isMongoId(id);
}

/**
 * Sanitize string input (remove dangerous characters)
 */
function sanitizeString(str, maxLength = 1000) {
  if (!str) return '';
  
  // Remove any null bytes and trim
  let sanitized = String(str).replace(/\0/g, '').trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email) return false;
  return validator.isEmail(email);
}

/**
 * Sanitize filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'file';
  
  // Remove path traversal attempts and dangerous characters
  return filename
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
}

/**
 * Validate URL
 */
function isValidUrl(url) {
  if (!url) return false;
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true
  });
}

module.exports = {
  escapeHtml,
  sanitizeEmail,
  sanitizeLimit,
  sanitizeOffset,
  isValidDate,
  isValidObjectId,
  sanitizeString,
  isValidEmail,
  sanitizeFilename,
  isValidUrl
};

