const express = require('express');
const router = express.Router();
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const billingService = require('../services/billingService');
const { calculateEstimateLite } = require('../services/billingServiceLite');
const ghlService = require('../services/ghlService');
const BillingTransaction = require('../models/BillingTransaction');
const ExportJob = require('../models/ExportJob');
const OAuthToken = require('../models/OAuthToken');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');

/**
 * Billing Routes (LITE) — the messages-only slice of the premium billing router for the
 * "Export Messages" app. Mirrors the premium `messages` estimate + charge-and-export flow
 * EXACTLY, but:
 *   - prices via billingServiceLite.calculateEstimateLite (credits model),
 *   - bills the LITE GHL marketplace app (GHL_LITE_APP_ID) against the LITE meter (GHL_LITE_METER_ID),
 *   - stamps `lite: true` on the BillingTransaction and ExportJob so lite vs premium records
 *     stay segregated in the shared DB,
 *   - scopes all list/history queries to `lite: true`.
 * The premium billing.js is untouched.
 */

// Lambda client (same config as premium billing.js).
const lambda = new LambdaClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

const LAMBDA_FUNCTION_NAME = process.env.EXPORT_LAMBDA_FUNCTION_NAME || 'convo-vault-export';

// S3 client for on-the-fly presigned download URLs (same pattern as premium billing.js).
const downloadS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Maximum date range for exports (2 years) — mirrors premium.
const MAX_DATE_RANGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Validate the date range. Mirrors premium billing.js — any span allowed as long as dates are
 * valid and startDate is before endDate.
 */
function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) return { valid: true };

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }
  if (end < start) {
    return { valid: false, error: 'End date must be after start date' };
  }
  return { valid: true };
}

/**
 * Re-fetch a sample of messages and extrapolate SMS vs email counts. Mirrors the premium
 * `messages` branch of POST /estimate exactly (email = TYPE_EMAIL / type 3, everything else text).
 */
async function computeMessageCounts(locationId, filters) {
  // lite: true → use the LITE token + lite refresh creds for this location.
  const result = await ghlService.exportMessages(locationId, {
    ...filters,
    limit: 100,
    lite: true
  });

  const messages = result.messages || [];
  const total = result.total || messages.length;

  let textCount = 0, emailCount = 0;
  messages.forEach(msg => {
    const type = String(msg.type || '').toLowerCase();
    if (type.includes('email') || type === '3' || type === 'type_email') {
      emailCount++;
    } else {
      textCount++; // SMS, WhatsApp, Call, GMB, FB, etc.
    }
  });

  // Extrapolate from the sample when total exceeds the sample size.
  let smsMessages, emailMessages;
  if (messages.length > 0 && total > messages.length) {
    const ratio = total / messages.length;
    smsMessages = Math.round(textCount * ratio);
    emailMessages = Math.round(emailCount * ratio);
  } else {
    smsMessages = textCount;
    emailMessages = emailCount;
  }

  return { smsMessages, emailMessages, total: smsMessages + emailMessages };
}

/**
 * @route POST /api/billing-lite/estimate
 * @desc Cost estimate for a messages export using LITE credit pricing.
 */
router.post('/estimate', authenticateSession, async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);
  try {
    const { locationId, filters } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const dateValidation = validateDateRange(filters?.startDate, filters?.endDate);
    if (!dateValidation.valid) {
      return res.status(400).json({ success: false, error: dateValidation.error });
    }

    logger.info('Calculating lite export estimate', { locationId, exportType: 'messages', filters });

    const { smsMessages, emailMessages } = await computeMessageCounts(locationId, filters || {});

    const est = calculateEstimateLite({ smsMessages, emailMessages });

    return res.json({
      success: true,
      data: {
        estimate: est,
        filters,
        exportType: 'messages'
      }
    });

  } catch (error) {
    logError('Lite estimate error', error, { locationId: req.body?.locationId });
    res.status(500).json({
      success: false,
      error: 'Failed to calculate estimate',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route POST /api/billing-lite/charge-and-export
 * @desc Check funds, charge the LITE app wallet, create a lite export job, trigger Lambda.
 */
router.post('/charge-and-export', authenticateSession, async (req, res) => {
  try {
    const { locationId, format, filters, notificationEmail } = req.body;
    const { companyId, userId } = req.user;
    const exportType = 'messages';

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    // Email required for notification (mirrors premium).
    if (!notificationEmail || !notificationEmail.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required for export notification'
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(notificationEmail.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    const dateValidation = validateDateRange(filters?.startDate, filters?.endDate);
    if (!dateValidation.valid) {
      return res.status(400).json({ success: false, error: dateValidation.error });
    }

    logger.info('Starting lite charge-and-export', { locationId, exportType, companyId });

    // Step 1: Recompute counts the same way as /estimate (re-fetch sample + extrapolate).
    // Retry once on a 0 result to guard against a transient empty fetch (mirrors premium).
    let { smsMessages, emailMessages, total: totalItems } = await computeMessageCounts(locationId, filters || {});
    if (totalItems === 0) {
      logger.warn('Lite totalItems=0 on first fetch, retrying once', { locationId });
      ({ smsMessages, emailMessages, total: totalItems } = await computeMessageCounts(locationId, filters || {}));
    }
    if (totalItems === 0) {
      return res.status(400).json({ success: false, error: 'No items found matching the filters' });
    }

    const counts = { smsMessages, emailMessages };
    const totalMessages = smsMessages + emailMessages;

    // Step 2: Lite pricing.
    const est = calculateEstimateLite({ smsMessages, emailMessages });

    // Safety net: block a $0 export despite items > 0 (mirrors premium).
    if (est.finalAmount === 0) {
      logger.warn('Lite billing calculated $0 — blocking export', { locationId, totalItems, counts });
      return res.status(400).json({
        success: false,
        error: 'No billable items found. Please adjust your filters and try again.'
      });
    }

    // Step 3: Access token for billing API (LITE token — lite:true selects the lite row + lite refresh creds).
    const tokenData = await ghlService.getValidToken(locationId, { lite: true });
    const accessToken = tokenData.accessToken || tokenData;

    // Meter charge: qty is the MESSAGE count (not credits — the price already encodes credits).
    // Price is set via finalAmount/qty just like premium's standalone meter charges.
    const meterCharges = [{
      meterId: process.env.GHL_LITE_METER_ID,
      qty: totalMessages,
      description: 'Export Messages export'
    }];

    // Step 4: Check wallet funds (same 402 handling as premium).
    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      const requiredAmount = Number(est.finalAmount) || 0;
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient wallet balance',
        message: `Your agency or sub-account wallet doesn't have enough funds for this export. Add at least $${requiredAmount.toFixed(2)} and try again.`,
        requiredAmount,
      });
    }

    const transaction = await BillingTransaction.create({
      locationId,
      companyId,
      type: 'export_messages',
      itemCounts: {
        smsMessages,
        emailMessages,
        total: totalItems
      },
      pricing: {
        baseAmount: est.finalAmount,
        discountPercent: 0,
        discountAmount: 0,
        finalAmount: est.finalAmount
      },
      meterCharges,
      status: 'pending',
      lite: true,
      userId
    });

    // Step 5: Charge wallet — pass the LITE appId as the 7th arg so it bills the lite app.
    try {
      const chargeResult = await billingService.chargeWallet(
        companyId,
        accessToken,
        meterCharges,
        locationId,
        transaction._id.toString(),
        est.finalAmount,
        process.env.GHL_LITE_APP_ID
      );

      transaction.ghlChargeId = chargeResult?.charges.map(c => c?.chargeId).join(',');
      transaction.referralCode = chargeResult.referralCode || null;

      if (chargeResult.internalTesting) {
        transaction.status = 'tested';
        transaction.internalTesting = true;
        transaction.paymentIgnored = true;
      } else {
        transaction.status = 'charged';
      }
      await transaction.save();

    } catch (chargeError) {
      transaction.status = 'failed';
      transaction.errorMessage = chargeError.message;
      await transaction.save();

      // Same INSUFFICIENT_FUNDS branch as premium — charge can fail even after hasFunds() passed.
      if (chargeError.insufficientFunds) {
        const requiredAmount = Number(est.finalAmount) || 0;
        const walletName = chargeError.walletScope === 'agency' ? 'agency wallet'
          : chargeError.walletScope === 'location' ? 'sub-account wallet'
          : 'agency or sub-account wallet';
        return res.status(402).json({
          success: false,
          code: 'INSUFFICIENT_FUNDS',
          error: 'Insufficient wallet balance',
          message: `Your ${walletName} doesn't have enough funds for this export. Add at least $${requiredAmount.toFixed(2)} and try again.`,
          requiredAmount,
          walletScope: chargeError.walletScope || null,
        });
      }

      return res.status(402).json({
        success: false,
        error: 'Payment failed',
        message: chargeError.message
      });
    }

    // Step 6: Verify OAuth token exists for this location (lite row).
    const oauthToken = await OAuthToken.findActiveToken(locationId, { lite: true });
    if (!oauthToken || !oauthToken.refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'No valid OAuth token found for this location'
      });
    }

    // Step 7: Create export job (messages filters only — mirrors premium's messages fields).
    const jobFilters = {
      channel: filters?.channel || null,
      startDate: filters?.startDate ? new Date(filters.startDate) : null,
      endDate: filters?.endDate ? new Date(filters.endDate) : null,
      contactId: filters?.contactId || null,
      conversationId: filters?.conversationId || null,
      userIds: filters?.userIds?.length > 0 ? filters.userIds : []
    };

    const exportJob = await ExportJob.create({
      locationId,
      companyId,
      billingTransactionId: transaction._id,
      exportType: 'messages',
      format: format || 'csv',
      filters: jobFilters,
      totalItems: totalMessages,
      status: 'pending',
      lite: true,
      notificationEmail: notificationEmail || null,
      userId
    });

    transaction.exportJobId = exportJob._id;
    await transaction.save();

    // Step 8: Trigger Lambda (identical to premium).
    try {
      const lambdaParams = {
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: 'Event',
        Qualifier: '$LATEST',
        Payload: Buffer.from(JSON.stringify({
          exportJobId: exportJob._id.toString()
        }))
      };

      const lambdaResult = await lambda.send(new InvokeCommand(lambdaParams));

      exportJob.status = 'processing';
      exportJob.startedAt = new Date();
      exportJob.lambdaRequestId = lambdaResult.$metadata?.requestId || null;
      await exportJob.save();

      logger.info('Lite Lambda triggered successfully', {
        jobId: exportJob._id,
        requestId: lambdaResult.$metadata?.requestId
      });

    } catch (lambdaError) {
      logger.error('Lite Lambda invocation failed', {
        jobId: exportJob._id,
        error: lambdaError.message
      });
      exportJob.status = 'failed';
      exportJob.errorMessage = `Lambda invocation failed: ${lambdaError.message}`;
      await exportJob.save();
    }

    logger.info('Lite export job created', {
      jobId: exportJob._id,
      transactionId: transaction._id,
      totalItems: totalMessages
    });

    res.json({
      success: true,
      message: exportJob.status != 'failed' ? 'Exported started successfully' : 'Export failed',
      data: {
        jobId: exportJob._id,
        transactionId: transaction._id,
        totalItems: totalMessages,
        estimatedAmount: est.finalAmountDollars,
        status: exportJob.status
      }
    });

  } catch (error) {
    logError('Lite charge and export error', error, {
      locationId: req.body?.locationId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to start export',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/billing-lite/export-status/:jobId
 * @desc Get export job status (lite jobs).
 */
router.get('/export-status/:jobId', authenticateSession, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ExportJob.findById(jobId).populate('billingTransactionId');

    if (!job) {
      return res.status(404).json({ success: false, error: 'Export job not found' });
    }

    // Access check: same location, or same company (mirrors premium).
    if (job.locationId !== req.query.locationId && job.locationId !== req.body?.locationId) {
      if (job.companyId !== req.user?.companyId) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    res.json({
      success: true,
      data: {
        jobId: job._id,
        exportType: job.exportType,
        format: job.format,
        status: job.status,
        progress: {
          total: job.totalItems,
          processed: job.processedItems,
          percent: job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0
        },
        downloadUrl: job.status === 'completed' ? job.downloadUrl : null,
        downloadUrlExpiresAt: job.downloadUrlExpiresAt,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        billing: job.billingTransactionId?.pricing?.finalAmount ? {
          amount: job.billingTransactionId.pricing.finalAmount,
          status: job.billingTransactionId.status
        } : null
      }
    });

  } catch (error) {
    logError('Lite get export status error', error, { jobId: req.params?.jobId });
    res.status(500).json({ success: false, error: 'Failed to get export status' });
  }
});

/**
 * @route GET /api/billing-lite/download/:jobId
 * @desc Regenerate a fresh presigned S3 download URL ON THE FLY (7-day policy gate).
 *   Identical logic to premium — the URL stored at export time is signed with short-lived STS
 *   creds and dies within hours, so we presign fresh at click-time inside the 7-day window.
 */
router.get('/download/:jobId', authenticateSession, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await ExportJob.findById(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Export job not found' });
    }

    // Access check: same location, or same company (mirrors premium).
    if (job.locationId !== req.query.locationId && job.companyId !== req.user?.companyId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (job.status !== 'completed' || !job.s3Key) {
      return res.status(409).json({ success: false, error: 'Export is not ready for download yet.' });
    }

    // 7-day policy gate.
    if (job.downloadUrlExpiresAt && Date.now() >= new Date(job.downloadUrlExpiresAt).getTime()) {
      return res.status(410).json({
        success: false,
        code: 'DOWNLOAD_EXPIRED',
        error: 'This download link has expired (7-day limit reached). Please run the export again.'
      });
    }

    const freshUrl = await getSignedUrl(
      downloadS3,
      new GetObjectCommand({ Bucket: job.s3Bucket || 'convo-vault-exports-1', Key: job.s3Key }),
      { expiresIn: 60 * 60 }
    );

    return res.json({ success: true, data: { url: freshUrl } });
  } catch (error) {
    logError('Lite download redirect error', error, { jobId: req.params?.jobId });
    res.status(500).json({ success: false, error: 'Failed to generate download link' });
  }
});

/**
 * @route GET /api/billing-lite/download-email/:jobId?token=…
 * @desc PUBLIC (no session) download link used in the "Your Export is Ready" email. Authorized
 *   by the per-job downloadToken. Regenerates a fresh presigned S3 URL on click, enforces the
 *   7-day window, then 302-redirects to S3. Identical to premium.
 */
router.get('/download-email/:jobId', async (req, res) => {
  const sendHtml = (title, msg) => res.status(410).send(
    `<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px">
       <h2 style="color:#EF4444">${title}</h2><p style="color:#6B7280">${msg}</p></body></html>`
  );
  try {
    const { jobId } = req.params;
    const { token } = req.query;
    const job = await ExportJob.findById(jobId);

    if (!job || job.status !== 'completed' || !job.s3Key) {
      return sendHtml('Export not found', 'This export is no longer available.');
    }

    // Token gate — must match the job's stored downloadToken.
    if (!token || !job.downloadToken || token !== job.downloadToken) {
      return res.status(403).send(
        `<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px">
           <h2 style="color:#EF4444">Invalid link</h2>
           <p style="color:#6B7280">This download link is not valid.</p></body></html>`
      );
    }

    // 7-day policy gate.
    if (job.downloadUrlExpiresAt && Date.now() >= new Date(job.downloadUrlExpiresAt).getTime()) {
      return sendHtml('Link expired', 'This download link has expired (7-day limit). Please run the export again from the app.');
    }

    const freshUrl = await getSignedUrl(
      downloadS3,
      new GetObjectCommand({ Bucket: job.s3Bucket || 'convo-vault-exports-1', Key: job.s3Key }),
      { expiresIn: 60 * 60 }
    );
    return res.redirect(302, freshUrl);
  } catch (error) {
    logError('Lite email download redirect error', error, { jobId: req.params?.jobId });
    return sendHtml('Something went wrong', 'Could not generate the download link. Please try again from the app.');
  }
});

/**
 * @route GET /api/billing-lite/export-history
 * @desc Recent lite export jobs for a location, paginated. Scoped to lite: true.
 */
router.get('/export-history', authenticateSession, async (req, res) => {
  try {
    const { locationId, limit, page } = req.query;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const query = { locationId, lite: true };

    const totalCount = await ExportJob.countDocuments(query);

    const jobs = await ExportJob.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('billingTransactionId');

    res.json({
      success: true,
      data: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        jobs: jobs.map(job => ({
          jobId: job._id,
          exportType: job.exportType,
          format: job.format,
          status: job.status,
          totalItems: job.totalItems,
          processedItems: job.processedItems,
          downloadUrl: job.status === 'completed' ? job.downloadUrl : null,
          downloadUrlExpiresAt: job.downloadUrlExpiresAt,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          filters: job.filters || {},
          errorMessage: job.errorMessage,
          billing: job.billingTransactionId?.pricing?.finalAmount ? {
            amount: job.billingTransactionId.pricing.finalAmount
          } : null
        }))
      }
    });

  } catch (error) {
    logError('Lite get export history error', error, { locationId: req.query?.locationId });
    res.status(500).json({ success: false, error: 'Failed to get export history' });
  }
});

module.exports = router;
