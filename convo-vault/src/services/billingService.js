const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Billing Service - Handle pricing calculations and GHL Marketplace billing
 */

// App ID for rebilling config
const APP_ID = process.env.GHL_APP_ID || '694f93f8a6babf0c821b1356';

// Internal testing company IDs - skip billing for these
const INTERNAL_TESTING_COMPANY_IDS = [
  'PG9VJ27QFRumQrOGB2Ee'
];

// Meter IDs for GHL Marketplace billing
const METER_IDS = {
  conversations: '69864aed1265653fdd7c0620',
  smsWhatsapp: '69864aed1265653fdd7c0620',
  email: '69864aed1265653fdd7c0620'
};

// Default unit prices in cents (fallback if API fails)
const DEFAULT_UNIT_PRICES = {
  conversations: 0.025,    // 2.5 cents per conversation (1 credit)
  smsWhatsapp: 0.025,      // 2.5 cents per text message (1 credit)
  email: 0.075             // 7.5 cents per email message (3 credits)
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
      emailMessages = 0
    } = counts;

    // Use provided prices or defaults
    const unitPrices = prices || DEFAULT_UNIT_PRICES;

    // Calculate base amounts (in cents)
    const conversationsCost = conversations * unitPrices.conversations;
    const textMessagesCost = smsMessages * unitPrices.smsWhatsapp;
    const emailCost = emailMessages * unitPrices.email;

    const baseAmount = conversationsCost + textMessagesCost + emailCost;
    const totalItems = conversations + smsMessages + emailMessages;
    
    // Calculate discount
    const discountPercent = this.getDiscountPercent(totalItems);
    const discountAmount = baseAmount * (discountPercent / 100);
    const finalAmount = baseAmount - discountAmount;

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
    const prices = await this.fetchMeterPrices(accessToken, locationId);
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
    if (INTERNAL_TESTING_COMPANY_IDS.includes(companyId)) {
      logger.info('Internal testing company - skipping charge', { companyId, meterCharges });
      return {
        success: true,
        internalTesting: true,
        paymentIgnored: true,
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
          unitPrice: (finalAmount/charge.qty).toFixed(4)
        });

        const response = await axios.post(
          `${this.baseURL}/marketplace/billing/charges`,
          {
            companyId,
            meterId: charge.meterId,
            units: charge.qty,
            price: (finalAmount/charge.qty).toFixed(4),
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
          chargeId: response.data.chargeId || response.data.id || response.data._id,
          success: true
        });

        logger.info('Wallet charge successful:', {
          response: response.data,
          meterId: charge.meterId,
          chargeId: chargeResults[chargeResults.length - 1].chargeId
        });
      }

      return {
        success: true,
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
  getUnitPrices() {
    return cachedPrices ? { ...cachedPrices } : { ...DEFAULT_UNIT_PRICES };
  }
}

module.exports = new BillingService();
