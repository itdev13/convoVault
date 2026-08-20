/**
 * billingServiceLite — pricing for the "Export Messages" (lite) app.
 *
 * Completely separate, credits-based model (distinct from the premium convoVault per-message
 * ladder). Messages-only app, so only SMS/WhatsApp/Instagram/Facebook + Email are billed.
 *
 * Model:
 *   1. Each message costs a number of CREDITS by channel:
 *        SMS / WhatsApp / Instagram / Facebook → 1 credit
 *        Email                                  → 5 credits
 *   2. The $/credit TIER is chosen by the MESSAGE COUNT (the table's "Messages" column),
 *      applied FLAT (one tier for the whole export).
 *   3. cost = totalMessages × creditsPerElement × pricePerCredit(messageCount)
 *      i.e. every message = (1 or 5 credits) × the tier's $/credit.
 *      (For a mixed export, each channel is priced with its own credit multiplier but the
 *       SAME tier — the tier is picked once from the total message count.)
 *
 * This service is used ONLY by the /api/billing-lite routes and the "Export Messages" app.
 * The premium app keeps using billingService.js untouched.
 */

// Credits per element, by channel. Non-email messaging channels are all 1 credit; email is 5.
const CREDITS_PER_ELEMENT = {
  sms: 1,
  whatsapp: 1,
  instagram: 1,
  facebook: 1,
  email: 5,
};

// Price-per-credit tiers, selected by MESSAGE COUNT (the table's "Messages" column), applied
// flat. Ordered high→low so the first match on `messages > min` wins.
const CREDIT_PRICE_TIERS = [
  { min: 100000, price: 0.0001 },   // 100k+
  { min: 50000,  price: 0.00015 },  // 50k–100k
  { min: 30000,  price: 0.00025 },  // 30k–50k
  { min: 15000,  price: 0.0005 },   // 15k–30k
  { min: 8000,   price: 0.00075 },  // 8k–15k
  { min: 5000,   price: 0.001 },    // 5k–8k
  { min: 2000,   price: 0.0015 },   // 2k–5k
  { min: 1000,   price: 0.0025 },   // 1k–2k
  { min: 0,      price: 0.003 },    // 0–1k
];

/** Resolve $/credit for a given MESSAGE count (flat tier). */
function getPricePerCredit(messageCount) {
  for (const tier of CREDIT_PRICE_TIERS) {
    if (messageCount > tier.min) return tier.price;
  }
  return CREDIT_PRICE_TIERS[CREDIT_PRICE_TIERS.length - 1].price; // 0–1k fallback
}

/**
 * Calculate a lite-app export estimate.
 * @param {Object} counts - { smsMessages, whatsappMessages, instagramMessages, facebookMessages, emailMessages }
 *   Any subset; missing channels count as 0. For simplicity the message export groups all
 *   non-email channels under smsMessages unless the caller splits them out.
 * @returns estimate mirroring billingService.calculateEstimate so the UI/modal render unchanged.
 */
function calculateEstimateLite(counts = {}) {
  const sms = Number(counts.smsMessages) || 0;
  const whatsapp = Number(counts.whatsappMessages) || 0;
  const instagram = Number(counts.instagramMessages) || 0;
  const facebook = Number(counts.facebookMessages) || 0;
  const email = Number(counts.emailMessages) || 0;

  // Non-email channels are all 1 credit — sum them into one "messages" bucket for display.
  const nonEmailMessages = sms + whatsapp + instagram + facebook;
  const nonEmailCredits = nonEmailMessages * CREDITS_PER_ELEMENT.sms; // ×1
  const emailCredits = email * CREDITS_PER_ELEMENT.email;             // ×5

  const totalMessages = nonEmailMessages + email;
  const totalCredits = nonEmailCredits + emailCredits;

  // Tier is chosen by MESSAGE COUNT (not credits), then applied to the credit total.
  const pricePerCredit = getPricePerCredit(totalMessages);
  const finalAmount = Number((totalCredits * pricePerCredit).toFixed(4));

  return {
    itemCounts: {
      smsMessages: nonEmailMessages,
      emailMessages: email,
      total: totalMessages,
    },
    breakdown: {
      // Effective per-item price = creditsPerElement × pricePerCredit (for display parity).
      smsWhatsapp: {
        count: nonEmailMessages,
        creditsPerItem: CREDITS_PER_ELEMENT.sms,
        creditPrice: pricePerCredit,
        unitPrice: CREDITS_PER_ELEMENT.sms * pricePerCredit,
        subtotal: Number((nonEmailCredits * pricePerCredit).toFixed(4)),
      },
      email: {
        count: email,
        creditsPerItem: CREDITS_PER_ELEMENT.email,
        creditPrice: pricePerCredit,
        unitPrice: CREDITS_PER_ELEMENT.email * pricePerCredit,
        subtotal: Number((emailCredits * pricePerCredit).toFixed(4)),
      },
    },
    // Credit-model fields (lite-specific) so the UI can show "X credits × $Y".
    totalCredits,
    pricePerCredit,
    baseAmount: finalAmount,
    discountPercent: 0,   // the tier IS the discount; no separate % discount
    discountAmount: 0,
    finalAmount,
    finalAmountDollars: finalAmount,
  };
}

/** Expose the tier ladder for the UI (mirrors billingService.getDiscountTiers shape loosely). */
function getCreditPriceTiers() {
  // Return low→high for display.
  return [...CREDIT_PRICE_TIERS].reverse().map(t => ({ minCredits: t.min, pricePerCredit: t.price }));
}

module.exports = {
  CREDITS_PER_ELEMENT,
  CREDIT_PRICE_TIERS,
  getPricePerCredit,
  calculateEstimateLite,
  getCreditPriceTiers,
};
