const express = require('express');
const router = express.Router();
const Referral = require('../models/Referral');
const BillingTransaction = require('../models/BillingTransaction');
const logger = require('../utils/logger');

/**
 * Referral Routes - Influencer tracking dashboard
 */

/**
 * Open API: Get dashboard stats for a referral code
 * GET /referrals/dashboard/:referralCode
 * Used by the external referral dashboard service
 */
router.get('/dashboard/:referralCode', async (req, res) => {
  try {
    const { referralCode } = req.params;
    const { from, to } = req.query;

    const referralFilter = { referralCode };
    const billingFilter = { referralCode, status: 'charged' };

    if (from || to) {
      const dateFilter = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) dateFilter.$lte = new Date(to + 'T23:59:59.999Z');
      referralFilter.installedAt = dateFilter;
      billingFilter.createdAt = dateFilter;
    }

    const [referrals, billingAgg] = await Promise.all([
      Referral.find(referralFilter),
      BillingTransaction.aggregate([
        { $match: billingFilter },
        {
          $group: {
            _id: null,
            totalRevenueCents: { $sum: '$pricing.finalAmount' },
            transactionCount: { $sum: 1 },
            totalExports: { $sum: '$itemCounts.total' }
          }
        }
      ])
    ]);

    const companies = new Set(referrals.filter(r => r.companyId).map(r => r.companyId));
    const locations = new Set(referrals.filter(r => r.locationId).map(r => r.locationId));
    const billing = billingAgg[0] || { totalRevenueCents: 0, transactionCount: 0, totalExports: 0 };

    res.json({
      success: true,
      referralCode,
      totalRevenue: Number((billing.totalRevenueCents).toFixed(4)),
      uniqueCompanies: companies.size,
      uniqueLocations: locations.size,
      transactionCount: billing.transactionCount,
      totalExports: billing.totalExports,
      totalInstalls: referrals.length,
      activeInstalls: referrals.filter(r => r.status === 'installed').length,
      uninstalls: referrals.filter(r => r.status === 'uninstalled').length
    });
  } catch (error) {
    logger.error('Error fetching referral dashboard:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get all influencer stats (grouped by referral code)
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await Referral.getInfluencerStats();

    const totalInstalls = stats.reduce((sum, s) => sum + s.totalInstalls, 0);
    const totalRevenue = stats.reduce((sum, s) => sum + s.totalRevenue, 0);
    const totalActive = stats.reduce((sum, s) => sum + s.activeInstalls, 0);

    res.json({
      success: true,
      summary: {
        totalInfluencers: stats.length,
        totalInstalls,
        totalActive,
        totalRevenue: Number(totalRevenue.toFixed(4))
      },
      influencers: stats.map(s => ({
        referralCode: s._id,
        influencer: s.influencer,
        totalInstalls: s.totalInstalls,
        activeInstalls: s.activeInstalls,
        uninstalls: s.uninstalls,
        totalRevenue: Number(s.totalRevenue.toFixed(4)),
        totalExports: s.totalExports,
        firstInstall: s.firstInstall,
        lastInstall: s.lastInstall
      }))
    });
  } catch (error) {
    logger.error('Error fetching referral stats:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get installs for a specific influencer
 */
router.get('/installs/:referralCode', async (req, res) => {
  try {
    const installs = await Referral.find({ referralCode: req.params.referralCode })
      .sort({ installedAt: -1 });

    res.json({
      success: true,
      referralCode: req.params.referralCode,
      count: installs.length,
      installs: installs.map(i => ({
        companyId: i.companyId,
        locationId: i.locationId,
        campaign: i.campaign,
        status: i.status,
        totalCharges: i.totalCharges,
        totalExports: i.totalExports,
        installedAt: i.installedAt,
        uninstalledAt: i.uninstalledAt
      }))
    });
  } catch (error) {
    logger.error('Error fetching referral installs:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Register/update an influencer's details
 * POST /referrals/influencer
 * Body: { referralCode, name, email, platform, notes }
 */
router.post('/influencer', async (req, res) => {
  try {
    const { referralCode, name, email, platform, notes } = req.body;

    if (!referralCode) {
      return res.status(400).json({ success: false, error: 'referralCode is required' });
    }

    // Update influencer details on all their referrals
    const result = await Referral.updateMany(
      { referralCode },
      { influencer: { name, email, platform, notes } }
    );

    // Generate their unique install URL
    const stateData = Buffer.from(JSON.stringify({ ref: referralCode })).toString('base64');
    const installUrl = `${process.env.BASE_URL}/oauth/authorize?ref=${encodeURIComponent(referralCode)}`;

    res.json({
      success: true,
      referralCode,
      installUrl,
      updatedRecords: result.modifiedCount
    });
  } catch (error) {
    logger.error('Error updating influencer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Generate install URL for an influencer
 * GET /referrals/link?ref=john&campaign=youtube_march
 */
router.get('/link', (req, res) => {
  const { ref, campaign } = req.query;

  if (!ref) {
    return res.status(400).json({ success: false, error: 'ref is required' });
  }

  const params = new URLSearchParams({ ref });
  if (campaign) params.append('campaign', campaign);

  const installUrl = `${process.env.BASE_URL}/oauth/authorize?${params.toString()}`;

  res.json({
    success: true,
    referralCode: ref,
    campaign: campaign || null,
    installUrl
  });
});

module.exports = router;
