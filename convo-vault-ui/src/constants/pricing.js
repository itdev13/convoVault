/**
 * Pricing Configuration - Single source of truth for all pricing in the UI
 *
 * Backend source: billingService.js DEFAULT_UNIT_PRICES & DISCOUNT_TIERS
 * Change prices here and they update everywhere in the frontend.
 */

// Unit prices in dollars
export const UNIT_PRICES = {
  conversations: 0.018,    // 1.8 cents per conversation
  smsWhatsapp: 0.018,      // 1.8 cents per SMS/WhatsApp message
  email: 0.054,            // 5.4 cents per email (3x base)
  notesAndTasks: 0.015,    // 1.5 cents per note or task
  opportunities: 0.015,    // 1.5 cents per opportunity
  formSubmissions: 0.015,  // 1.5 cents per form submission
  links: 0.015,            // 1.5 cents per link
  socialPosts: 0.015,      // 1.5 cents per social post
  callLogs: 0.015,         // 1.5 cents per call log
  templates: 0.015,        // 1.5 cents per template
};

// Previous prices (for strikethrough display in UI)
export const OLD_UNIT_PRICES = {
  conversations: 0.025,
  smsWhatsapp: 0.025,
  email: 0.075,
  notesAndTasks: 0.020,
};

// Volume discount tiers
export const DISCOUNT_TIERS = [
  { min: 0, max: 1000, discount: 0 },
  { min: 1000, max: 2000, discount: 20 },
  { min: 2000, max: 5000, discount: 40 },
  { min: 5000, max: 30000, discount: 50 },
  { min: 30000, max: Infinity, discount: 70 },
];

// Format a unit price for display (e.g. "$0.0150")
export const formatUnitPrice = (price) => {
  const num = Number(price) || 0;
  return `$${num.toFixed(4)}`;
};

// Format a unit price as cents for display text (e.g. "1.5 cents")
export const formatCents = (price) => {
  const cents = Number(price) * 100;
  return cents % 1 === 0 ? `${cents} cent${cents !== 1 ? 's' : ''}` : `${cents} cents`;
};
