const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Billing Service - Handle pricing calculations and GHL Marketplace billing
 */

// App ID for rebilling config
const APP_ID = process.env.GHL_APP_ID || '694f93f8a6babf0c821b1356';

// Internal testing company IDs - skip billing for these
const INTERNAL_TESTING_COMPANY_IDS = [
  'PG9VJ27QFRumQrOGB2Ee',
  '7IlT9P1bafOCnq2JV00t',
  '7eCKyMQq7PfdMP5X6gSe'
];

// Meter IDs for GHL Marketplace billing
const METER_IDS = {
  conversations: '69864aed1265653fdd7c0620',
  smsWhatsapp: '69864aed1265653fdd7c0620',
  email: '69864aed1265653fdd7c0620',
  notesAndTasks: '69864aed1265653fdd7c0620',
  opportunities: '69864aed1265653fdd7c0620',
  formSubmissions: '69864aed1265653fdd7c0620',
  links: '69864aed1265653fdd7c0620',
  socialPosts: '69864aed1265653fdd7c0620',
  callLogs: '69864aed1265653fdd7c0620',
  templates: '69864aed1265653fdd7c0620',
  businesses: '69864aed1265653fdd7c0620'
};

// Default unit prices in dollars (fallback if API fails)
const DEFAULT_UNIT_PRICES = {
  conversations: 0.018,    // 1.8 cents per conversation
  smsWhatsapp: 0.018,      // 1.8 cents per text message
  email: 0.054,            // 5.4 cents per email message (3x base)
  notesAndTasks: 0.015,    // 0.015 cents per note/task (no discounts)
  opportunities: 0.015,    // 0.015 cents per opportunity (with volume discounts)
  formSubmissions: 0.015,  // 0.015 cents per form submission (with volume discounts)
  links: 0.015,            // 0.015 cents per link (with volume discounts)
  socialPosts: 0.015,      // 0.015 cents per social post (with volume discounts)
  callLogs: 0.015,         // 0.015 cents per call log (with volume discounts)
  templates: 0.015         // 0.015 cents per template (with volume discounts)
};

// Special location pricing (enriched exports)
const SPECIAL_LOCATION_IDS = ['2yb4B4EdJMYLgOu7mZ9I'];
const SPECIAL_UNIT_PRICES = {
  ...DEFAULT_UNIT_PRICES,
  conversations: 0.025,
  smsWhatsapp: 0.025,
  email: 0.075
};

// Cached prices from GHL API
let cachedPrices = null;
let cacheExpiry = null;

// Volume discount tiers
const DISCOUNT_TIERS = [
  { min: 0, max: 1000, discount: 0 },
  { min: 1000, max: 2000, discount: 20 },
  { min: 2000, max: 5000, discount: 40 },
  { min: 5000, max: 30000, discount: 50 },
  { min: 30000, max: Infinity, discount: 70 }
];

class BillingService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
  }

  /**
   * Fetch rebilling config from GHL to get actual meter prices
   * @param {string} accessToken - GHL access token
   * @returns {Object} Prices per meter in cents
   */
  async fetchMeterPrices(accessToken, locationId) {
    // Return cached if still valid (cache for 1 hour)
    if (cachedPrices && cacheExpiry && Date.now() < cacheExpiry) {
      return cachedPrices;
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/marketplace/app/${APP_ID}/rebilling-config/location/${locationId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          }
        }
      );

      const config = response.data?.plans;
      logger.info('Fetched rebilling config:', config);

      // Extract prices from meters
      const prices = { ...DEFAULT_UNIT_PRICES };
      if (config.usage && Array.isArray(config.usage)) {
        config?.usage?.forEach(meter => {
          if (meter.meterId === METER_IDS.conversations) {
            prices.conversations = meter.fixedPricePerUnit || DEFAULT_UNIT_PRICES.conversations;
          } else if (meter.meterId === METER_IDS.smsWhatsapp) {
            prices.smsWhatsapp = meter.fixedPricePerUnit || DEFAULT_UNIT_PRICES.smsWhatsapp;
          } else if (meter.meterId === METER_IDS.email) {
            prices.email = meter.fixedPricePerUnit || DEFAULT_UNIT_PRICES.email;
          }
        });
      }

      // Cache for 1 hour
      cachedPrices = prices;
      cacheExpiry = Date.now() + (60 * 60 * 1000);

      return prices;
    } catch (error) {
      logger.error('Failed to fetch rebilling config:', {
        error: error.response?.data || error.message
      });
      // Return defaults on error
      return DEFAULT_UNIT_PRICES;
    }
  }

  /**
   * Get discount percentage based on total items
   */
  getDiscountPercent(totalItems) {
    for (const tier of DISCOUNT_TIERS) {
      if (totalItems >= tier.min && totalItems < tier.max) {
        return tier.discount;
      }
    }
    return 70; // Max discount for 30000+
  }

  /**
   * Get all discount tiers (for displaying to user)
   */
  getDiscountTiers() {
    return DISCOUNT_TIERS.map(tier => ({
      range: tier.max === Infinity ? `${tier.min}+` : `${tier.min}-${tier.max}`,
      discount: tier.discount
    }));
  }

  /**
   * Calculate pricing estimate for export
   * @param {Object} counts - Item counts { conversations, smsMessages, emailMessages }
   * @param {Object} prices - Optional prices (if not provided, uses defaults)
   * @returns {Object} Pricing estimate with breakdown
   */
  calculateEstimate(counts, prices = null) {
    const {
      conversations = 0,
      smsMessages = 0,
      emailMessages = 0,
      notes = 0,
      tasks = 0,
      opportunities = 0,
      formSubmissions = 0,
      links = 0,
      socialPosts = 0,
      callLogs = 0,
      templates = 0
    } = counts;

    // Use provided prices or defaults
    const unitPrices = prices || DEFAULT_UNIT_PRICES;
    console.log('unitPrices', unitPrices);
    // Calculate discountable amounts (conversations + messages + opportunities + formSubmissions + links + socialPosts)
    const conversationsCost = conversations * unitPrices.conversations;
    const textMessagesCost = smsMessages * unitPrices.smsWhatsapp;
    const emailCost = emailMessages * unitPrices.email;
    const opportunitiesCost = opportunities * (unitPrices.opportunities || DEFAULT_UNIT_PRICES.opportunities);
    const formSubmissionsCost = formSubmissions * (unitPrices.formSubmissions || DEFAULT_UNIT_PRICES.formSubmissions);
    const linksCost = links * (unitPrices.links || DEFAULT_UNIT_PRICES.links);
    const socialPostsCost = socialPosts * (unitPrices.socialPosts || DEFAULT_UNIT_PRICES.socialPosts);
    const callLogsCost = callLogs * (unitPrices.callLogs || DEFAULT_UNIT_PRICES.callLogs);
    const templatesCost = templates * (unitPrices.templates || DEFAULT_UNIT_PRICES.templates);
    const discountableBase = conversationsCost + textMessagesCost + emailCost + opportunitiesCost + formSubmissionsCost + linksCost + socialPostsCost + callLogsCost + templatesCost;
    const discountableItems = conversations + smsMessages + emailMessages + opportunities + formSubmissions + links + socialPosts + callLogs + templates;

    // Notes/tasks: flat rate, NO discounts
    const notesTasksPrice = unitPrices.notesAndTasks || DEFAULT_UNIT_PRICES.notesAndTasks;
    const notesCost = notes * notesTasksPrice;
    const tasksCost = tasks * notesTasksPrice;
    const nonDiscountableAmount = notesCost + tasksCost;

    const totalItems = discountableItems + notes + tasks;
    const baseAmount = discountableBase + nonDiscountableAmount;

    // Discount only applies to conversations/messages
    const discountPercent = discountableItems > 0 ? this.getDiscountPercent(discountableItems) : 0;
    const discountAmount = discountableBase * (discountPercent / 100);
    const finalAmount = (discountableBase - discountAmount) + nonDiscountableAmount;

    logger.info('Billing calculation:', {
      totalItems,
      baseAmount,
      discountPercent,
      discountAmount,
      finalAmount
    });

    return {
      itemCounts: {
        conversations,
        smsMessages,
        emailMessages,
        notes,
        tasks,
        opportunities,
        formSubmissions,
        links,
        socialPosts,
        callLogs,
        templates,
        total: totalItems
      },
      breakdown: {
        conversations: {
          count: conversations,
          unitPrice: unitPrices.conversations,
          subtotal: conversationsCost
        },
        smsWhatsapp: {
          count: smsMessages,
          unitPrice: unitPrices.smsWhatsapp,
          subtotal: textMessagesCost
        },
        email: {
          count: emailMessages,
          unitPrice: unitPrices.email,
          subtotal: emailCost
        },
        notes: {
          count: notes,
          unitPrice: notesTasksPrice,
          subtotal: notesCost
        },
        tasks: {
          count: tasks,
          unitPrice: notesTasksPrice,
          subtotal: tasksCost
        },
        opportunities: {
          count: opportunities,
          unitPrice: unitPrices.opportunities || DEFAULT_UNIT_PRICES.opportunities,
          subtotal: opportunitiesCost
        },
        formSubmissions: {
          count: formSubmissions,
          unitPrice: unitPrices.formSubmissions || DEFAULT_UNIT_PRICES.formSubmissions,
          subtotal: formSubmissionsCost
        },
        links: {
          count: links,
          unitPrice: unitPrices.links || DEFAULT_UNIT_PRICES.links,
          subtotal: linksCost
        },
        socialPosts: {
          count: socialPosts,
          unitPrice: unitPrices.socialPosts || DEFAULT_UNIT_PRICES.socialPosts,
          subtotal: socialPostsCost
        },
        callLogs: {
          count: callLogs,
          unitPrice: unitPrices.callLogs || DEFAULT_UNIT_PRICES.callLogs,
          subtotal: callLogsCost
        },
        templates: {
          count: templates,
          unitPrice: unitPrices.templates || DEFAULT_UNIT_PRICES.templates,
          subtotal: templatesCost
        }
      },
      baseAmount,
      discountPercent,
      discountAmount,
      finalAmount,
      finalAmountDollars: finalAmount
    };
  }

  /**
   * Calculate estimate with fetched prices from GHL
   * @param {Object} counts - Item counts
   * @param {string} accessToken - GHL access token
   * @returns {Object} Pricing estimate with actual GHL prices
   */
  async calculateEstimateWithPrices(counts, accessToken, locationId) {
    let prices = await this.fetchMeterPrices(accessToken, locationId);
    // Override with special pricing for special locations
    if (SPECIAL_LOCATION_IDS.includes(locationId)) {
      prices = { ...prices, ...SPECIAL_UNIT_PRICES };
    }
    return this.calculateEstimate(counts, prices);
  }

  /**
   * Check if wallet has sufficient funds
   * @param {string} companyId - Company ID
   * @param {string} accessToken - GHL access token
   * @returns {boolean} Whether wallet has funds
   */
  async hasFunds(companyId, accessToken) {
    if (INTERNAL_TESTING_COMPANY_IDS.includes(companyId)) {
      logger.info('Internal testing company - skipping funds check', { companyId });
      return true;
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/marketplace/billing/charges/has-funds`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          },
          params: { companyId }
        }
      );

      logger.info('Wallet funds check:', { companyId, response: response?.data });
      return response.data.hasFunds === true;
    } catch (error) {
      logger.error('Failed to check wallet funds:', {
        companyId,
        error: error.response?.data || error.message
      });
      throw new Error('Unable to verify wallet balance');
    }
  }

  /**
   * Charge wallet using GHL Billing API
   * @param {string} companyId - Company ID
   * @param {string} accessToken - GHL access token
   * @param {Array} meterCharges - Array of { meterId, qty, description }
   * @returns {Object} Charge result with charge IDs
   */
  async chargeWallet(companyId, accessToken, meterCharges, locationId, transactionId, finalAmount) {
    // Look up referral code for this location (non-blocking)
    let referralCode = null;
    try {
      const Referral = require('../models/Referral');
      const referral = await Referral.findByLocation(locationId);
      if (referral) {
        referralCode = referral.referralCode;
      }
    } catch (refErr) {
      // Silent fail
    }

    if (INTERNAL_TESTING_COMPANY_IDS.includes(companyId)) {
      logger.info('Internal testing company - skipping charge', { companyId, meterCharges });
      try {
        const Referral = require('../models/Referral');
        await Referral.addRevenue(locationId, finalAmount);
      } catch (refErr) {
        // Silent fail — referral tracking should never block billing
      }
      return {
        success: true,
        internalTesting: true,
        paymentIgnored: true,
        referralCode,
        charges: meterCharges.map(c => ({
          meterId: c.meterId,
          qty: c.qty,
          chargeId: `internal_test_${transactionId}`,
          success: true,
          paymentIgnored: true
        })),
        totalCharges: meterCharges.length
      };
    }

    try {
      const chargeResults = [];

      for (const charge of meterCharges) {
        if (charge.qty <= 0) continue;

        logger.info('Charging wallet:', {
          companyId,
          meterId: charge.meterId,
          qty: charge.qty,
          finalAmount: finalAmount,
          unitPrice: Number((finalAmount/charge.qty).toFixed(4)),
          referralCode
        });

        const response = await axios.post(
          `${this.baseURL}/marketplace/billing/charges`,
          {
            companyId,
            meterId: charge.meterId,
            units: charge.qty,
            price: Number((finalAmount/charge.qty).toFixed(4)),
            appId: process.env.GHL_APP_ID || "694f93f8a6babf0c821b1356",
            eventId: transactionId,
            locationId: locationId,
            description: "Exported Data " + "_" + new Date().toDateString()
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28'
            }
          }
        );

        chargeResults.push({
          meterId: charge.meterId,
          qty: charge.qty,
          unitPrice: (finalAmount/charge.qty).toFixed(4),
          finalAmount: finalAmount,
          chargeId: response.data.chargeId || response.data.id || response.data._id,
          referralCode,
          success: true
        });

        logger.info('Wallet charge successful:', {
          response: response.data,
          meterId: charge.meterId,
          chargeId: chargeResults[chargeResults.length - 1].chargeId,
          referralCode
        });
      }

      // Track revenue for referral (non-blocking)
      try {
        const Referral = require('../models/Referral');
        await Referral.addRevenue(locationId, finalAmount);
      } catch (refErr) {
        // Silent fail — referral tracking should never block billing
      }

      return {
        success: true,
        referralCode,
        charges: chargeResults,
        totalCharges: chargeResults.length
      };
    } catch (error) {
      logger.error('Failed to charge wallet:', {
        companyId,
        error: error.response?.data || error.message
      });
      throw new Error(error.response?.data?.message || 'Payment failed. Please check your wallet balance.');
    }
  }

  /**
   * Build meter charges array from item counts
   * @param {Object} counts - Item counts
   * @returns {Array} Array of meter charges for GHL API
   */
  buildMeterCharges(counts) {
    const charges = [];

    if (counts.conversations > 0) {
      charges.push({
        meterId: METER_IDS.conversations,
        qty: counts.conversations,
        description: 'Conversation exports'
      });
    }

    if (counts.smsMessages > 0) {
      charges.push({
        meterId: METER_IDS.smsWhatsapp,
        qty: counts.smsMessages,
        description: 'Text message exports'
      });
    }

    if (counts.emailMessages > 0) {
      charges.push({
        meterId: METER_IDS.email,
        qty: counts.emailMessages,
        description: 'Email message exports'
      });
    }

    if (counts.notes > 0) {
      charges.push({
        meterId: METER_IDS.notesAndTasks,
        qty: counts.notes,
        description: 'Note exports'
      });
    }

    if (counts.tasks > 0) {
      charges.push({
        meterId: METER_IDS.notesAndTasks,
        qty: counts.tasks,
        description: 'Task exports'
      });
    }

    if (counts.opportunities > 0) {
      charges.push({
        meterId: METER_IDS.opportunities,
        qty: counts.opportunities,
        description: 'Opportunity exports'
      });
    }

    if (counts.formSubmissions > 0) {
      charges.push({
        meterId: METER_IDS.formSubmissions,
        qty: counts.formSubmissions,
        description: 'Form submission exports'
      });
    }

    if (counts.links > 0) {
      charges.push({
        meterId: METER_IDS.links,
        qty: counts.links,
        description: 'Link exports'
      });
    }

    if (counts.socialPosts > 0) {
      charges.push({
        meterId: METER_IDS.socialPosts,
        qty: counts.socialPosts,
        description: 'Social post exports'
      });
    }

    if (counts.callLogs > 0) {
      charges.push({
        meterId: METER_IDS.callLogs,
        qty: counts.callLogs,
        description: 'Call log exports'
      });
    }

    return charges;
  }

  /**
   * Get meter IDs (for reference)
   */
  getMeterIds() {
    return { ...METER_IDS };
  }

  /**
   * Get unit prices (returns cached prices if available, otherwise defaults)
   */
  getUnitPrices(locationId) {
    const base = cachedPrices ? { ...cachedPrices } : { ...DEFAULT_UNIT_PRICES };
    if (locationId && SPECIAL_LOCATION_IDS.includes(locationId)) {
      return { ...base, ...SPECIAL_UNIT_PRICES };
    }
    return base;
  }

  /**
   * Get default unit prices (always returns the configured defaults, ignoring cache)
   */
  getDefaultUnitPrices(locationId) {
    if (locationId && SPECIAL_LOCATION_IDS.includes(locationId)) {
      return { ...SPECIAL_UNIT_PRICES };
    }
    return { ...DEFAULT_UNIT_PRICES };
  }
}

module.exports = new BillingService();
