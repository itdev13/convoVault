/**
 * Message Type Utilities
 * Converts GHL message types to user-friendly display names
 */

// Message type enum mapping
export const MESSAGE_TYPE_MAP = {
  // Calls
  1: 'Call',
  8: 'Campaign Call',
  13: 'Manual Call',
  24: 'IVR Call',
  34: 'Custom Call',
  10: 'Voicemail',
  
  // SMS
  2: 'SMS',
  7: 'Campaign SMS',
  14: 'Manual SMS',
  20: 'Custom SMS',
  22: 'Custom Provider SMS',
  35: 'Group SMS',
  4: 'SMS Review',
  6: 'SMS No-Show',
  
  // Email
  3: 'Email',
  9: 'Campaign Email',
  21: 'Custom Email',
  23: 'Custom Provider Email',
  
  // Social
  11: 'Facebook',
  12: 'Campaign Facebook',
  32: 'Facebook Comment',
  18: 'Instagram',
  33: 'Instagram Comment',
  41: 'TikTok',
  42: 'TikTok Comment',
  19: 'WhatsApp',
  
  // GMB
  15: 'Google My Business',
  16: 'Campaign GMB',
  
  // Chat
  5: 'Web Chat',
  29: 'Live Chat',
  30: 'Live Chat Info',
  36: 'Internal Chat',
  37: 'Internal Comment',
  
  // Activity
  25: 'Contact Activity',
  26: 'Invoice Activity',
  27: 'Payment Activity',
  28: 'Opportunity Activity',
  31: 'Appointment Activity',
  38: 'Employee Action',
  
  // Other
  17: 'Review',
  100: 'Log Message'
};

/**
 * Convert message type (number or string) to display name
 */
export function getMessageTypeDisplay(type) {
  if (!type) return 'Unknown';
  
  // If it's a number, use the map
  if (typeof type === 'number') {
    return MESSAGE_TYPE_MAP[type] || `Type ${type}`;
  }
  
  // If it's a string like "TYPE_EMAIL", convert to display name
  const typeString = String(type);
  
  // Remove TYPE_ prefix if present
  const cleanType = typeString.replace(/^TYPE_/, '');
  
  // Handle common cases
  switch (cleanType) {
    case 'EMAIL':
    case 'CAMPAIGN_EMAIL':
    case 'CUSTOM_EMAIL':
    case 'CUSTOM_PROVIDER_EMAIL':
      return 'Email';
      
    case 'SMS':
    case 'CAMPAIGN_SMS':
    case 'CUSTOM_SMS':
    case 'CUSTOM_PROVIDER_SMS':
    case 'CAMPAIGN_MANUAL_SMS':
    case 'GROUP_SMS':
      return 'SMS';
      
    case 'CALL':
    case 'CAMPAIGN_CALL':
    case 'CUSTOM_CALL':
    case 'CAMPAIGN_MANUAL_CALL':
    case 'IVR_CALL':
      return 'Call';
      
    case 'WHATSAPP':
      return 'WhatsApp';
      
    case 'FACEBOOK':
    case 'CAMPAIGN_FACEBOOK':
    case 'FACEBOOK_COMMENT':
      return 'Facebook';
      
    case 'INSTAGRAM':
    case 'INSTAGRAM_COMMENT':
      return 'Instagram';
      
    case 'GMB':
    case 'CAMPAIGN_GMB':
      return 'Google My Business';
      
    case 'LIVE_CHAT':
    case 'LIVE_CHAT_INFO_MESSAGE':
      return 'Live Chat';
      
    case 'WEBCHAT':
      return 'Web Chat';
      
    case 'TIKTOK':
    case 'TIKTOK_COMMENT':
      return 'TikTok';
      
    default:
      // Fallback: Convert snake_case to Title Case
      return cleanType
        .split('_')
        .map(word => word.charAt(0) + word.slice(1).toLowerCase())
        .join(' ');
  }
}

/**
 * Get icon for message type
 */
export function getMessageTypeIcon(type) {
  const displayType = getMessageTypeDisplay(type);
  
  switch (displayType) {
    case 'Email':
      return '📧';
    case 'SMS':
      return '💬';
    case 'Call':
      return '📞';
    case 'WhatsApp':
      return '💚';
    case 'Facebook':
      return '📘';
    case 'Instagram':
      return '📸';
    case 'Live Chat':
    case 'Web Chat':
      return '💭';
    case 'Google My Business':
      return '🏢';
    default:
      return '💬';
  }
}

