/**
 * App Updates Configuration
 * Add new features here - will automatically show in Updates popover
 */

export const APP_UPDATES = [
  {
    title: 'Universal Search',
    description: 'Search across contact name, email, company, tags, and message content',
    badge: 'live',
    icon: '✓',
    color: 'green'
  },
  {
    title: 'Date Range Filters',
    description: 'Filter conversations by Start Date and End Date for better reporting',
    badge: 'upcoming',
    icon: '✓',
    color: 'green'
  },
  {
    title: 'Enhanced Email Exports',
    description: 'Subject, From, To, CC, BCC now included in separate email CSV files',
    badge: 'upcoming',
    icon: '✓',
    color: 'green'
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

