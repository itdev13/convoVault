/**
 * App Updates Configuration
 * Add new features here - will automatically show in Updates popover
 */

export const APP_UPDATES = [
  {
    title: 'Custom Fields & Values',
    description: 'Export and import custom fields and custom values directly from CSV',
    badge: 'new',
    icon: '✨',
    color: 'green'
  },
  {
    title: 'Contacts Import',
    description: 'Bring contacts in from a CSV with volume discounts on bulk imports',
    badge: 'new',
    icon: '✨',
    color: 'green'
  },
  {
    title: 'Notes Import',
    description: 'Bulk import notes by contact name, email, or phone — auto-matched',
    badge: 'live',
    icon: '✓',
    color: 'green'
  },
  {
    title: 'New Export Tabs',
    description: 'Export Notes, Tasks, Opportunities, Forms, Links, Templates, Social Posts and Voice AI data',
    badge: 'live',
    icon: '✓',
    color: 'green'
  },
  {
    title: 'Contact & User Search Filters',
    description: 'Easily search and filter by contactId and userId across all export types',
    badge: 'live',
    icon: '✓',
    color: 'green'
  },
  {
    title: 'Tags Export',
    description: 'View and export every tag in your sub-account',
    badge: 'upcoming',
    icon: '🔜',
    color: 'blue'
  }
];

// Feature request CTA
export const FEATURE_REQUEST_CTA = {
  title: 'Need a Feature?',
  description: 'Visit the Support tab and raise a request. We\'ll add it within 24 hours!',
  icon: '💡'
};

// Badge configurations
export const BADGE_CONFIGS = {
  live: {
    label: 'LIVE',
    bgColor: '#48bb78',
    textColor: '#ffffff'
  },
  upcoming: {
    label: 'UPCOMING',
    bgColor: '#4299e1',
    textColor: '#ffffff'
  },
  new: {
    label: 'NEW',
    bgColor: '#f59e0b',
    textColor: '#ffffff'
  }
};

// Filter updates by badge type
export const getLiveUpdates = () => APP_UPDATES.filter(u => u.badge === 'live');
export const getUpcomingUpdates = () => APP_UPDATES.filter(u => u.badge === 'upcoming');
export const getAllUpdates = () => APP_UPDATES;

