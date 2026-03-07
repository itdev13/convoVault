const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const billingService = require('../services/billingService');
const ghlService = require('../services/ghlService');
const BillingTransaction = require('../models/BillingTransaction');
const ExportJob = require('../models/ExportJob');
const OAuthToken = require('../models/OAuthToken');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');

// Initialize AWS Lambda client
const lambda = new AWS.Lambda({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

const LAMBDA_FUNCTION_NAME = process.env.EXPORT_LAMBDA_FUNCTION_NAME || 'convo-vault-export';

/**
 * Billing Routes - Handle export pricing, charges, and job management
 */

// Maximum date range for exports (6 months in milliseconds)
const MAX_DATE_RANGE_MS = 6 * 31 * 24 * 60 * 60 * 1000;

/**
 * Validate date range doesn't exceed 6 months
 */
function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) return { valid: true };

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (end - start > MAX_DATE_RANGE_MS) {
    return { valid: false, error: 'Date range cannot exceed 6 months' };
  }

  if (end < start) {
    return { valid: false, error: 'End date must be after start date' };
  }

  return { valid: true };
}

/**
 * @route POST /api/billing/estimate
 * @desc Get cost estimate for export
 */
router.post('/estimate', authenticateSession, async (req, res) => {
  try {
    const { locationId, exportType, filters } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const validExportTypes = ['conversations', 'messages', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs'];
    if (!exportType || !validExportTypes.includes(exportType)) {
      return res.status(400).json({
        success: false,
        error: `exportType must be one of: ${validExportTypes.join(', ')}`
      });
    }

    // Validate date range (not applicable for notes/tasks/links)
    if (!['notes', 'tasks', 'links'].includes(exportType)) {
      const dateValidation = validateDateRange(filters?.startDate, filters?.endDate);
      if (!dateValidation.valid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }
    }

    logger.info('Calculating export estimate', { locationId, exportType, filters });

    let counts = {
      conversations: 0,
      smsMessages: 0,
      emailMessages: 0,
      notes: 0,
      tasks: 0,
      opportunities: 0,
      formSubmissions: 0,
      links: 0,
      socialPosts: 0,
      callLogs: 0
    };

    if (exportType === 'conversations') {
      // Fetch first page of conversations to estimate count
      const result = await ghlService.searchConversations(locationId, {
        ...filters,
        limit: 100
      });

      // Use total from response if available, otherwise use fetched count
      const total = result.total || result.conversations?.length || 0;
      counts.conversations = total;

    } else if (exportType === 'messages') {
      // Fetch first page of messages to estimate count and types
      const result = await ghlService.exportMessages(locationId, {
        ...filters,
        limit: 100
      });

      const messages = result.messages || [];
      const total = result.total || messages.length;

      // Count message types from sample
      // Email = TYPE_EMAIL or type 3, everything else = text message
      let textCount = 0, emailCount = 0;
      messages.forEach(msg => {
        const type = String(msg.type || '').toLowerCase();
        if (type.includes('email') || type === '3' || type === 'type_email') {
          emailCount++;
        } else {
          textCount++; // SMS, WhatsApp, Call, GMB, FB, etc.
        }
      });

      // Extrapolate if we have more items than sample
      if (messages.length > 0 && total > messages.length) {
        const ratio = total / messages.length;
        counts.smsMessages = Math.round(textCount * ratio);
        counts.emailMessages = Math.round(emailCount * ratio);
      } else {
        counts.smsMessages = textCount;
        counts.emailMessages = emailCount;
      }

    } else if (exportType === 'notes' || exportType === 'tasks') {
      if (filters?.contactId) {
        // Exact count for a single contact
        if (exportType === 'notes') {
          const result = await ghlService.getContactNotes(locationId, filters.contactId);
          counts.notes = result.total;
        } else {
          const result = await ghlService.getContactTasks(locationId, filters.contactId);
          counts.tasks = result.total;
        }
      } else if (filters?.contactIds?.length > 0) {
        // Exact count for multiple specific contacts
        let total = 0;
        for (const cId of filters.contactIds) {
          try {
            const result = exportType === 'notes'
              ? await ghlService.getContactNotes(locationId, cId)
              : await ghlService.getContactTasks(locationId, cId);
            total += result.total;
          } catch (err) {
            logger.warn('Failed to count for contact during estimation:', { contactId: cId });
          }
        }
        if (exportType === 'notes') counts.notes = total;
        else counts.tasks = total;
      } else {
        // Notes/Tasks: per-contact APIs - sample contacts to estimate count
        const contactResult = await ghlService.searchContacts(locationId, { limit: 1 });
        const totalContacts = contactResult.total || 0;

        if (totalContacts > 0) {
          // Sample up to 10 contacts to estimate average items per contact
          const SAMPLE_SIZE = Math.min(10, totalContacts);
          const sampleResult = await ghlService.searchContacts(locationId, { limit: SAMPLE_SIZE });
          const sampleContacts = sampleResult.contacts || [];

          let totalItemsInSample = 0;
          for (const contact of sampleContacts) {
            try {
              if (exportType === 'notes') {
                const result = await ghlService.getContactNotes(locationId, contact.id);
                totalItemsInSample += result.total;
              } else {
                const result = await ghlService.getContactTasks(locationId, contact.id);
                totalItemsInSample += result.total;
              }
            } catch (err) {
              logger.warn('Failed to fetch for contact during estimation:', { contactId: contact.id });
            }
          }

          const avgPerContact = sampleContacts.length > 0 ? totalItemsInSample / sampleContacts.length : 0;
          const estimatedTotal = Math.max(totalItemsInSample, Math.round(avgPerContact * totalContacts));

          if (exportType === 'notes') {
            counts.notes = estimatedTotal;
          } else {
            counts.tasks = estimatedTotal;
          }
        }
      }

    } else if (exportType === 'opportunities') {
      // Opportunities: location-level search API returns total directly
      const result = await ghlService.searchOpportunities(locationId, {
        ...filters,
        limit: 1
      });
      counts.opportunities = result.total || 0;

    } else if (exportType === 'formSubmissions') {
      // Form Submissions: page-based API returns total in meta
      const result = await ghlService.getFormSubmissions(locationId, {
        ...filters,
        limit: 1
      });
      counts.formSubmissions = result.total || 0;

    } else if (exportType === 'links') {
      // Links: returns all links at once (no pagination)
      const result = await ghlService.getLinks(locationId);
      counts.links = result.links?.length || 0;

    } else if (exportType === 'socialPosts') {
      // Social Posts: list endpoint returns total
      const result = await ghlService.getSocialPosts(locationId, {
        ...filters,
        limit: 1
      });
      counts.socialPosts = result.total || 0;

    } else if (exportType === 'callLogs') {
      // Call Logs: page-based API returns total
      const result = await ghlService.getCallLogs(locationId, {
        ...filters,
        pageSize: 1
      });
      counts.callLogs = result.total || 0;
    }

    // Get access token to fetch actual prices from GHL
    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    // Calculate estimate with actual GHL meter prices
    const estimate = await billingService.calculateEstimateWithPrices(counts, accessToken, locationId);

    res.json({
      success: true,
      data: {
        estimate,
        filters,
        exportType,
        discountTiers: billingService.getDiscountTiers(),
        unitPrices: billingService.getUnitPrices()
      }
    });

  } catch (error) {
    logError('Estimate calculation error', error, {
      locationId: req.body?.locationId,
      exportType: req.body?.exportType
    });

    res.status(500).json({
      success: false,
      error: 'Failed to calculate estimate',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route POST /api/billing/charge-and-export
 * @desc Check funds, charge wallet, create job, trigger Lambda
 */
router.post('/charge-and-export', authenticateSession, async (req, res) => {
  try {
    const { locationId, exportType, format, filters, notificationEmail } = req.body;
    const { companyId, userId } = req.user;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const validExportTypes = ['conversations', 'messages', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs'];
    if (!exportType || !validExportTypes.includes(exportType)) {
      return res.status(400).json({
        success: false,
        error: `exportType must be one of: ${validExportTypes.join(', ')}`
      });
    }

    // Validate email is provided (required for notification)
    if (!notificationEmail || !notificationEmail.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required for export notification'
      });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(notificationEmail.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Validate date range (not applicable for notes/tasks/links)
    if (!['notes', 'tasks', 'links'].includes(exportType)) {
      const dateValidation = validateDateRange(filters?.startDate, filters?.endDate);
      if (!dateValidation.valid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }
    }

    logger.info('Starting charge-and-export', { locationId, exportType, companyId });

    // Step 1: Get counts for billing
    let counts = {
      conversations: 0,
      smsMessages: 0,
      emailMessages: 0,
      notes: 0,
      tasks: 0,
      opportunities: 0,
      formSubmissions: 0,
      links: 0,
      socialPosts: 0,
      callLogs: 0
    };
    let totalItems = 0;

    if (exportType === 'conversations') {
      const result = await ghlService.searchConversations(locationId, {
        ...filters,
        limit: 100
      });
      totalItems = result.total || result.conversations?.length || 0;
      counts.conversations = totalItems;
    } else if (exportType === 'notes' || exportType === 'tasks') {
      if (filters?.contactId) {
        // Exact count for a single contact
        if (exportType === 'notes') {
          const result = await ghlService.getContactNotes(locationId, filters.contactId);
          totalItems = result.total;
          counts.notes = totalItems;
        } else {
          const result = await ghlService.getContactTasks(locationId, filters.contactId);
          totalItems = result.total;
          counts.tasks = totalItems;
        }
      } else if (filters?.contactIds?.length > 0) {
        // Exact count for multiple specific contacts
        let total = 0;
        for (const cId of filters.contactIds) {
          try {
            const result = exportType === 'notes'
              ? await ghlService.getContactNotes(locationId, cId)
              : await ghlService.getContactTasks(locationId, cId);
            total += result.total;
          } catch (err) {
            logger.warn('Sample contact fetch failed:', { contactId: cId });
          }
        }
        totalItems = total;
        if (exportType === 'notes') counts.notes = totalItems;
        else counts.tasks = totalItems;
      } else {
        // Notes/Tasks: sample contacts to estimate
        const contactResult = await ghlService.searchContacts(locationId, { limit: 1 });
        const totalContacts = contactResult.total || 0;

        if (totalContacts > 0) {
          const SAMPLE_SIZE = Math.min(10, totalContacts);
          const sampleResult = await ghlService.searchContacts(locationId, { limit: SAMPLE_SIZE });
          const sampleContacts = sampleResult.contacts || [];

          let totalItemsInSample = 0;
          for (const contact of sampleContacts) {
            try {
              if (exportType === 'notes') {
                const result = await ghlService.getContactNotes(locationId, contact.id);
                totalItemsInSample += result.total;
              } else {
                const result = await ghlService.getContactTasks(locationId, contact.id);
                totalItemsInSample += result.total;
              }
            } catch (err) {
              logger.warn('Sample contact fetch failed:', { contactId: contact.id });
            }
          }

          const avgPerContact = sampleContacts.length > 0 ? totalItemsInSample / sampleContacts.length : 0;
          totalItems = Math.max(totalItemsInSample, Math.round(avgPerContact * totalContacts));

          if (exportType === 'notes') counts.notes = totalItems;
          else counts.tasks = totalItems;
        }
      }
    } else if (exportType === 'opportunities') {
      // Opportunities: location-level search API returns total directly
      const result = await ghlService.searchOpportunities(locationId, {
        ...filters,
        limit: 1
      });
      totalItems = result.total || 0;
      counts.opportunities = totalItems;

    } else if (exportType === 'formSubmissions') {
      const result = await ghlService.getFormSubmissions(locationId, {
        ...filters,
        limit: 1
      });
      totalItems = result.total || 0;
      counts.formSubmissions = totalItems;

    } else if (exportType === 'links') {
      const result = await ghlService.getLinks(locationId);
      totalItems = result.links?.length || 0;
      counts.links = totalItems;

    } else if (exportType === 'socialPosts') {
      const result = await ghlService.getSocialPosts(locationId, {
        ...filters,
        limit: 1
      });
      totalItems = result.total || 0;
      counts.socialPosts = totalItems;

    } else if (exportType === 'callLogs') {
      const result = await ghlService.getCallLogs(locationId, {
        ...filters,
        pageSize: 1
      });
      totalItems = result.total || 0;
      counts.callLogs = totalItems;

    } else {
      const result = await ghlService.exportMessages(locationId, {
        ...filters,
        limit: 100
      });
      const messages = result.messages || [];
      totalItems = result.total || messages.length;

      // Count types from sample and extrapolate
      // Email = TYPE_EMAIL or type 3, everything else = text message
      let textCount = 0, emailCount = 0;
      messages.forEach(msg => {
        const type = String(msg.type || '').toLowerCase();
        if (type.includes('email') || type === '3' || type === 'type_email') emailCount++;
        else textCount++; // SMS, WhatsApp, Call, GMB, FB, etc.
      });

      if (messages.length > 0 && totalItems > messages.length) {
        const ratio = totalItems / messages.length;
        counts.smsMessages = Math.round(textCount * ratio);
        counts.emailMessages = Math.round(emailCount * ratio);
      } else {
        counts.smsMessages = textCount;
        counts.emailMessages = emailCount;
      }
    }

    if (totalItems === 0) {
      return res.status(400).json({
        success: false,
        error: 'No items found matching the filters'
      });
    }

    // Step 2: Get access token for billing API
    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    // Step 3: Calculate pricing with actual GHL meter prices
    const estimate = await billingService.calculateEstimateWithPrices(counts, accessToken, locationId);

    // Step 4: Check wallet funds
    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient wallet balance',
        message: 'Please add funds to your GHL wallet to continue'
      });
  }

    // Step 5: Create billing transaction (pending)
    const meterCharges = billingService.buildMeterCharges(counts);

    const transaction = await BillingTransaction.create({
      locationId,
      companyId,
      type: `export_${exportType}`,
      itemCounts: {
        ...counts,
        total: totalItems
      },
      pricing: {
        baseAmount: estimate.baseAmount,
        discountPercent: estimate.discountPercent,
        discountAmount: estimate.discountAmount,
        finalAmount: estimate.finalAmount
      },
      meterCharges,
      status: 'pending',
      userId
    });

    // Step 6: Charge wallet
    try {
      const chargeResult = await billingService.chargeWallet(companyId, accessToken, meterCharges, locationId, transaction._id.toString(), estimate.finalAmount);

      // Update transaction with charge IDs
      transaction.ghlChargeId = chargeResult?.charges.map(c => c?.chargeId).join(',');

      if (chargeResult.internalTesting) {
        transaction.status = 'tested';
        transaction.internalTesting = true;
        transaction.paymentIgnored = true;
      } else {
        transaction.status = 'charged';
      }
      await transaction.save();

    } catch (chargeError) {
      // Mark transaction as failed
      transaction.status = 'failed';
      transaction.errorMessage = chargeError.message;
      await transaction.save();

      return res.status(402).json({
        success: false,
        error: 'Payment failed',
        message: chargeError.message
      });
    }

    // Step 7: Verify OAuth token exists for this location
    const oauthToken = await OAuthToken.findActiveToken(locationId);
    if (!oauthToken || !oauthToken.refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'No valid OAuth token found for this location'
      });
    }

    // Step 8: Create export job (Lambda will fetch tokens from OAuthToken collection)
    // Build filters object with all supported filter types
    const jobFilters = {
      // Common filters
      channel: filters?.channel || null,
      startDate: filters?.startDate ? new Date(filters.startDate) : null,
      endDate: filters?.endDate ? new Date(filters.endDate) : null,
      contactId: filters?.contactId || null,
      contactIds: filters?.contactIds?.length > 0 ? filters.contactIds : [],
      // Conversation-specific filters
      query: filters?.query || null,
      id: filters?.id || null,
      conversationId: filters?.conversationId || null,
      lastMessageType: filters?.lastMessageType || null,
      lastMessageDirection: filters?.lastMessageDirection || null,
      status: filters?.status || null,
      lastMessageAction: filters?.lastMessageAction || null,
      sortBy: filters?.sortBy || null,
      // Opportunity-specific filters
      pipelineId: filters?.pipelineId || null,
      pipelineStageId: filters?.pipelineStageId || null,
      // Form submission-specific filters
      formId: filters?.formId || null,
      // Call log-specific filters
      agentId: filters?.agentId || null,
      callType: filters?.callType || null,
      actionType: filters?.actionType || null
    };

    const exportJob = await ExportJob.create({
      locationId,
      companyId,
      billingTransactionId: transaction._id,
      exportType,
      format: format || 'csv',
      filters: jobFilters,
      totalItems,
      status: 'pending',
      notificationEmail: notificationEmail || null,
      userId
    });

    // Update transaction with job reference
    transaction.exportJobId = exportJob._id;
    await transaction.save();

    // Step 9: Trigger Lambda function
    try {
      const lambdaParams = {
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: 'Event',  // Async invocation
        Qualifier: '$LATEST',     // Required for durable functions
        Payload: JSON.stringify({
          exportJobId: exportJob._id.toString()
        })
      };

      const lambdaResult = await lambda.invoke(lambdaParams).promise();

      // Update job status
      exportJob.status = 'processing';
      exportJob.startedAt = new Date();
      exportJob.lambdaRequestId = lambdaResult.$response?.requestId || null;
      await exportJob.save();

      logger.info('Lambda triggered successfully', {
        jobId: exportJob._id,
        requestId: lambdaResult.$response?.requestId
      });

    } catch (lambdaError) {
      // Lambda invocation failed - mark job but don't fail the request
      // Job can be retried later
      logger.error('Lambda invocation failed', {
        jobId: exportJob._id,
        error: lambdaError.message
      });

      exportJob.status = 'failed';
      exportJob.errorMessage = `Lambda invocation failed: ${lambdaError.message}`;
      await exportJob.save();
    }

    logger.info('Export job created', {
      jobId: exportJob._id,
      transactionId: transaction._id,
      totalItems
    });

    res.json({
      success: true,
      message: exportJob.status != 'failed' ? "Exported started successfully" : "Export failed",
      data: {
        jobId: exportJob._id,
        transactionId: transaction._id,
        totalItems,
        estimatedAmount: estimate.finalAmountDollars,
        status: exportJob.status
      }
    });

  } catch (error) {
    logError('Charge and export error', error, {
      locationId: req.body?.locationId,
      exportType: req.body?.exportType
    });

    res.status(500).json({
      success: false,
      error: 'Failed to start export',
      message: getUserFriendlyMessage(error)
    });
  }
});

/**
 * @route GET /api/billing/export-status/:jobId
 * @desc Get export job status
 */
router.get('/export-status/:jobId', authenticateSession, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ExportJob.findById(jobId).populate('billingTransactionId');

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Export job not found'
      });
    }

    // Verify user has access (same location)
    if (job.locationId !== req.query.locationId && job.locationId !== req.body?.locationId) {
      // Allow if user is from same company
      if (job.companyId !== req.user?.companyId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
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
    logError('Get export status error', error, { jobId: req.params?.jobId });

    res.status(500).json({
      success: false,
      error: 'Failed to get export status'
    });
  }
});

/**
 * @route GET /api/billing/export-history
 * @desc Get recent export jobs for location with pagination
 */
router.get('/export-history', authenticateSession, async (req, res) => {
  try {
    const { locationId, limit, page } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalCount = await ExportJob.countDocuments({ locationId });

    // Get paginated jobs
    const jobs = await ExportJob.find({ locationId })
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
    logError('Get export history error', error, { locationId: req.query?.locationId });

    res.status(500).json({
      success: false,
      error: 'Failed to get export history'
    });
  }
});

/**
 * @route GET /api/billing/pricing
 * @desc Get current pricing information
 */
router.get('/pricing', async (req, res) => {
  res.json({
    success: true,
    data: {
      unitPrices: billingService.getUnitPrices(),
      discountTiers: billingService.getDiscountTiers(),
      maxDateRange: '1 month'
    }
  });
});

/**
 * @route GET /api/billing/pipelines
 * @desc Get pipelines for a location (proxy to GHL API)
 */
router.get('/pipelines', authenticateSession, async (req, res) => {
  try {
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const result = await ghlService.getPipelines(locationId);

    res.json({
      success: true,
      data: {
        pipelines: result.pipelines || []
      }
    });

  } catch (error) {
    logError('Get pipelines error', error, { locationId: req.query?.locationId });

    res.status(500).json({
      success: false,
      error: 'Failed to get pipelines'
    });
  }
});

/**
 * @route GET /api/billing/forms
 * @desc Get forms for a location (proxy to GHL API)
 */
router.get('/forms', authenticateSession, async (req, res) => {
  try {
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const result = await ghlService.getForms(locationId);

    res.json({
      success: true,
      data: {
        forms: result.forms || [],
        total: result.total || 0
      }
    });

  } catch (error) {
    logError('Get forms error', error, { locationId: req.query?.locationId });

    res.status(500).json({
      success: false,
      error: 'Failed to get forms'
    });
  }
});

/**
 * @route GET /api/billing/contacts/:contactId/notes
 * @desc Get notes for a specific contact (for preview)
 */
router.get('/contacts/:contactId/notes', authenticateSession, async (req, res) => {
  try {
    const { contactId } = req.params;
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.getContactNotes(locationId, contactId);

    res.json({
      success: true,
      data: {
        notes: result.notes || [],
        total: result.total || 0
      }
    });

  } catch (error) {
    logError('Get contact notes error', error, { contactId: req.params?.contactId });
    res.status(500).json({ success: false, error: 'Failed to fetch notes' });
  }
});

/**
 * @route GET /api/billing/contacts/search
 * @desc Search contacts for a location (for filter dropdowns)
 */
router.get('/contacts/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, query, limit } = req.query;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.searchContacts(locationId, {
      query: query || '',
      limit: parseInt(limit) || 20
    });

    res.json({
      success: true,
      data: {
        contacts: result.contacts || [],
        total: result.total || 0
      }
    });

  } catch (error) {
    logError('Search contacts error', error, { locationId: req.query?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search contacts' });
  }
});

module.exports = router;
