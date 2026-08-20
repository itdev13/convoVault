/**
 * Pricing Configuration - Single source of truth for all pricing in the UI
 *
 * Backend source: billingService.js DEFAULT_UNIT_PRICES & DISCOUNT_TIERS
 * Change prices here and they update everywhere in the frontend.
 */

// Unit prices in dollars — every export type is 1.8 cents/item base.
// Flat-rate items get the percentage DISCOUNT_TIERS below.
// Messages (SMS/WhatsApp + email) are 1 credit each and priced by the MESSAGE_PRICE_TIERS
// volume ladder instead — that ladder IS their discount (no percentage stacking).
// The values here are the base (smallest-volume) rate; the modal uses backend-computed
// breakdown.smsWhatsapp.unitPrice / breakdown.email.unitPrice for the actual tiered price.
export const UNIT_PRICES = {
  conversations: 0.018,
  smsWhatsapp: 0.018,
  email: 0.018,
  notesAndTasks: 0.018,
  opportunities: 0.018,
  formSubmissions: 0.018,
  links: 0.018,
  socialPosts: 0.018,
  callLogs: 0.018,
  templates: 0.018,
};

// Message volume pricing ladder (SMS/WhatsApp + email, 1 credit each).
// Mirrors getMessageCreditPrice() in billingService.js. Messages do NOT get the
// percentage DISCOUNT_TIERS — this ladder is their only discount.
// `savePct` = how much cheaper each tier is vs the $0.018 base rate, for marketing ("Save X%").
export const MESSAGE_BASE_PRICE = 0.018;
export const MESSAGE_PRICE_TIERS = [
  { min: 0,      max: 1000,     price: 0.018,  savePct: 0  },
  { min: 1000,   max: 10000,    price: 0.006,  savePct: 67 },
  { min: 10000,  max: 50000,    price: 0.003,  savePct: 83 },
  { min: 50000,  max: 100000,   price: 0.002,  savePct: 89 },
  { min: 100000, max: 500000,   price: 0.001,  savePct: 94 },
  { min: 500000, max: Infinity, price: 0.0005, savePct: 97 },
];

// Resolve the per-message price for a given message count (mirrors backend getMessageCreditPrice).
export const getMessagePrice = (count) => {
  if (count > 500000) return 0.0005;
  if (count > 100000) return 0.001;
  if (count > 50000)  return 0.002;
  if (count > 10000)  return 0.003;
  if (count > 1000)   return 0.006;
  return 0.018;
};

// Marketing savings % for a given message count vs the $0.018 base rate.
// Use to render "Save X%" badges next to the live price.
export const getMessageSavingsPct = (count) => {
  const price = getMessagePrice(count);
  return Math.round((1 - price / MESSAGE_BASE_PRICE) * 100);
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
