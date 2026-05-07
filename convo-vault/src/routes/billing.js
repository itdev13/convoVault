const express = require('express');
const router = express.Router();
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const billingService = require('../services/billingService');
const ghlService = require('../services/ghlService');
const BillingTransaction = require('../models/BillingTransaction');
const ExportJob = require('../models/ExportJob');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const logger = require('../utils/logger');
const { logError, getUserFriendlyMessage } = require('../utils/errorLogger');
const { authenticateSession } = require('../middleware/auth');
const SpecialExport = require('../models/SpecialExport');
const AppConfig = require('../models/AppConfig');

// Initialize AWS Lambda client
const lambda = new LambdaClient({
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

// Maximum date range for exports (2 years in milliseconds)
const MAX_DATE_RANGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const MAX_DATE_RANGE_MS_SPECIAL_TAB = 365 * 24 * 60 * 60 * 1000; // 1 year

/**
 * Validate date range doesn't exceed the allowed maximum
 */
function validateDateRange(startDate, endDate, maxRange = MAX_DATE_RANGE_MS) {
  if (!startDate || !endDate) return { valid: true };

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (end - start > maxRange) {
    return { valid: false, error: maxRange === MAX_DATE_RANGE_MS ? 'Date range cannot exceed 2 years' : 'Date range cannot exceed 1 year' };
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
  // Extend timeout for this route — tag resolution + note counting can take minutes
  req.setTimeout(600000);
  res.setTimeout(600000);
  try {
    const { locationId, exportType, filters } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const validExportTypes = ['conversations', 'messages', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs', 'templates', 'specialTabMessages', 'callTranscriptions'];
    if (!exportType || !validExportTypes.includes(exportType)) {
      return res.status(400).json({
        success: false,
        error: `exportType must be one of: ${validExportTypes.join(', ')}`
      });
    }

    // Validate date range (not applicable for notes/links/templates)
    if (!['notes', 'links', 'templates'].includes(exportType)) {
      const dateValidation = validateDateRange(filters?.startDate, filters?.endDate, ['specialTabMessages', 'callTranscriptions'].includes(exportType) ? MAX_DATE_RANGE_MS_SPECIAL_TAB : MAX_DATE_RANGE_MS);
      if (!dateValidation.valid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }
    }

    logger.info('Calculating export estimate', { locationId, exportType, filters });

    // For notes: track resolved contacts from tag lookup to return to frontend
    let resolvedContactIds = null;
    let resolvedContactNames = null;
    let resolvedContactsMeta = null;

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
      callLogs: 0,
      templates: 0
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

    } else if (exportType === 'notes') {
      // Resolve contactIds: either direct selection or by tag
      resolvedContactIds = [];
      resolvedContactNames = filters?.contactNames || {};
      resolvedContactsMeta = filters?.contactsMeta ? { ...filters.contactsMeta } : {};

      if (filters?.contactId) {
        resolvedContactIds = [filters.contactId];
      } else if (filters?.contactIds?.length > 0) {
        resolvedContactIds = filters.contactIds;
      } else if (filters?.tags) {
        // Resolve all contacts matching the tag via pagination
        let startAfterId = null;
        let startAfter = null;
        let hasMore = true;
        let page = 0;
        const MAX_PAGES = 100; // Safety limit: 100 pages * 100 contacts = 10,000 max
        while (hasMore && page < MAX_PAGES) {
          page++;
          const result = await ghlService.searchContacts(locationId, { tag: filters.tags, limit: 100, startAfterId, startAfter });
          const contacts = result.contacts || [];
          logger.info('Tag contacts page result', { page, contactsReturned: contacts.length, metaTotal: result.meta?.total, metaStartAfterId: result.meta?.startAfterId });
          for (const c of contacts) {
            resolvedContactIds.push(c.id);
            if (!resolvedContactNames[c.id]) {
              resolvedContactNames[c.id] = c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown';
            }
            if (!resolvedContactsMeta[c.id]) {
              resolvedContactsMeta[c.id] = { email: c.email || '', phone: c.phone || '' };
            }
          }
          if (contacts.length < 100) {
            hasMore = false;
          } else if (result.meta?.startAfterId) {
            startAfterId = result.meta.startAfterId;
            startAfter = result.meta.startAfter || null;
          } else {
            // No cursor in meta — stop to avoid infinite loop
            logger.warn('No pagination cursor in meta, stopping', { page, totalResolved: resolvedContactIds.length });
            hasMore = false;
          }
        }
        if (page >= MAX_PAGES) {
          logger.warn('Hit max pages limit for tag contact resolution', { tag: filters.tags, totalResolved: resolvedContactIds.length });
        }
        logger.info('Tag contact resolution complete', { tag: filters.tags, totalContacts: resolvedContactIds.length, pages: page });
      }

      // Dedup contactIds
      const beforeDedup = resolvedContactIds.length;
      resolvedContactIds = [...new Set(resolvedContactIds)];
      if (beforeDedup !== resolvedContactIds.length) {
        logger.warn('Duplicate contactIds removed', { before: beforeDedup, after: resolvedContactIds.length });
      }

      if (resolvedContactIds.length === 0) {
        return res.status(400).json({ success: false, error: 'No contacts found with this tag' });
      }

      // Count notes in parallel batches with retry (3 attempts max)
      let total = 0;
      let skipped = 0;
      const BATCH_SIZE = 5;
      const MAX_RETRIES = 3;
      let pendingContactIds = [...resolvedContactIds];


      for (let attempt = 1; attempt <= MAX_RETRIES && pendingContactIds.length > 0; attempt++) {
        const failedThisRound = [];
        for (let i = 0; i < pendingContactIds.length; i += BATCH_SIZE) {
          const batch = pendingContactIds.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(cId => ghlService.getContactNotes(locationId, cId).then(r => ({ cId, total: r.total, notesLength: r.notes?.length || 0 })))
          );
          for (let j = 0; j < results.length; j++) {
            if (results[j].status === 'fulfilled') {
              const { cId, total: noteCount, notesLength } = results[j].value;
              logger.info('Contact notes count', { contactId: cId, noteCount, notesArrayLength: notesLength });
              total += noteCount;
            } else {
              failedThisRound.push(batch[j]);
            }
          }
        }
        if (failedThisRound.length > 0) {
          logger.warn(`Attempt ${attempt}: ${failedThisRound.length} contacts failed`, { attempt, failed: failedThisRound.length, runningTotal: total });
        }
        pendingContactIds = failedThisRound;
      }

      if (pendingContactIds.length > 0) {
        skipped = pendingContactIds.length;
        logger.warn('Contacts skipped after max retries', { skipped, contactIds: pendingContactIds.slice(0, 10) });
      }

      counts.notes = total;
      logger.info('Notes count complete', { totalContacts: resolvedContactIds.length, totalNotes: total, skippedContacts: skipped });

    } else if (exportType === 'tasks') {
      // Tasks: location-level search API — always upfront billing
      const result = await ghlService.getLocationTasks(locationId, {
        contactIds: filters?.contactIds || [],
        assignedTo: filters?.assignedTo,
        completed: filters?.completed,
        overdue: filters?.overdue,
        query: filters?.query,
        dueDate: filters?.dueDate,
        sortKey: filters?.sortKey,
        sortDirection: filters?.sortDirection,
        unAssigned: filters.unAssigned,
        businessId: filters.businessId,
        limit: 1
      });
      counts.tasks = result.total || 0;

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
        formId: filters?.formId,
        q: filters?.query,
        startAt: filters?.startDate,
        endAt: filters?.endDate,
        limit: 1
      });
      counts.formSubmissions = result.total || 0;

    } else if (exportType === 'links') {
      const result = await ghlService.getLinks(locationId, { query: filters?.query, limit: 1000 });
      counts.links = result.total || result.links?.length || 0;

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

    } else if (exportType === 'templates') {
      // Templates: returns totalCount directly
      const result = await ghlService.getTemplates(locationId, {
        type: filters?.type,
        limit: '1'
      });
      counts.templates = result.total || 0;

    } else if (exportType === 'specialTabMessages') {
      // Special Messages: fetch ALL conversations, then fetch + store messages matching the type
      const typeFilter = filters?.type;
      let allConversationIds = [];
      let startAfterDate = undefined;

      // Helper: retry on 429 with exponential backoff
      const withRetry = async (fn, maxRetries = 3) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err) {
            if (err.response?.status === 429 && attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
              logger.warn('Rate limited (429), retrying...', { attempt: attempt + 1, delay });
              await new Promise(r => setTimeout(r, delay));
            } else {
              throw err;
            }
          }
        }
      };

      // Paginate through ALL conversations with date filter
      // GHL search uses startAfterDate (timestamp) for cursor pagination
      while (true) {
        const searchParams = { locationId, limit: 100 };
        if (filters?.startDate) searchParams.startDate = filters.startDate;
        if (filters?.endDate) searchParams.endDate = filters.endDate;
        if (startAfterDate) searchParams.startAfterDate = startAfterDate;
        const result = await withRetry(() => ghlService.searchConversations(locationId, searchParams));
        const convos = result.conversations || [];
        if (convos.length === 0) break;
        allConversationIds.push(...convos.map(c => c.id));
        if (convos.length < 100) break;
        const lastConvo = convos[convos.length - 1];
        startAfterDate = lastConvo.lastMessageDate || lastConvo.dateUpdated || lastConvo.dateAdded;
      }

      logger.info('Special Messages: conversations fetched', { count: allConversationIds.length });

      // Fetch messages for each conversation (5 parallel), pass type filter to API
      const allMessages = [];
      const PARALLEL = 5;
      for (let i = 0; i < allConversationIds.length; i += PARALLEL) {
        const batch = allConversationIds.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(
          batch.map(async (cId) => {
            const msgs = [];
            let cursor = undefined;
            const PAGE_SIZE = 300;
            // Email is priced separately on the standard Messages tab; never include it here regardless of type filter.
            const isEmail = (m) => {
              const t = String(m?.type || '').toLowerCase();
              return t === 'type_email' || t === '3' || t.includes('email');
            };
            while (true) {
              const msgOptions = { limit: PAGE_SIZE };
              if (cursor) msgOptions.lastMessageId = cursor;
              if (typeFilter) msgOptions.type = typeFilter;
              const result = await withRetry(() => ghlService.getMessages(locationId, cId, msgOptions));
              // GHL response: { messages: { lastMessageId, nextPage, messages: [...] } }
              const wrapper = result.messages || {};
              const pageMsgs = wrapper.messages || [];
              const filtered = pageMsgs
                .filter(m => !isEmail(m))
                .map(m => ({ ...m, conversationId: cId }));
              msgs.push(...filtered);
              if (pageMsgs.length < PAGE_SIZE || !wrapper.nextPage) break;
              cursor = wrapper.lastMessageId;
            }
            return msgs;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') allMessages.push(...r.value);
        }
      }

      logger.info('Special Messages: fetched', { totalMessages: allMessages.length, totalConversations: allConversationIds.length, type: typeFilter });

      // Split into 5,000-message chunks to stay under MongoDB's 16MB BSON limit.
      // Lambda BATCH_SIZE is also 5000 so each invocation loads exactly one chunk doc.
      const CHUNK_SIZE = 5000;
      const totalChunks = Math.max(1, Math.ceil(allMessages.length / CHUNK_SIZE));

      // Create chunk 0 first to obtain its _id as the groupId for all remaining chunks.
      const firstChunkMessages = allMessages.slice(0, CHUNK_SIZE);
      const specialExport = await SpecialExport.create({
        locationId,
        filters: { type: typeFilter },
        messages: firstChunkMessages,
        totalMessages: allMessages.length,
        totalConversations: allConversationIds.length,
        chunkIndex: 0,
        totalChunks,
        status: 'ready'
      });

      // Create remaining chunks linked by groupId = specialExport._id
      if (totalChunks > 1) {
        const chunkDocs = [];
        for (let ci = 1; ci < totalChunks; ci++) {
          chunkDocs.push({
            locationId,
            filters: { type: typeFilter },
            messages: allMessages.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE),
            totalMessages: allMessages.length,
            totalConversations: allConversationIds.length,
            groupId: specialExport._id,
            chunkIndex: ci,
            totalChunks,
            status: 'ready',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        await SpecialExport.insertMany(chunkDocs);
        logger.info('Special Messages: chunks stored', { totalChunks, totalMessages: allMessages.length });
      }

      const total = allMessages.length;
      const unitPrice = 0.018;
      const finalAmount = total * unitPrice;
      return res.json({
        success: true,
        data: {
          estimate: {
            itemCounts: { specialTabMessages: total, total },
            baseAmount: finalAmount,
            discountPercent: 0,
            discountAmount: 0,
            finalAmount
          },
          filters,
          exportType,
          specialExportId: specialExport._id
        }
      });
    } else if (exportType === 'callTranscriptions') {
      // Single-walk export: walks every conversation once, fetches TYPE_CALL messages,
      // pulls transcripts for the eligible statuses, and persists the final CSV-ready
      // records into specialexports.callTranscriptionsMessages (chunked).
      // After this, charge-and-export only links the existing doc and triggers Lambda;
      // Lambda only reads + writes CSV.
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // Generous retry — GHL rate-limits aggressively under bulk read.
      const withRetry = async (fn, maxRetries = 6) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err) {
            const is429 = err.response?.status === 429;
            const is5xx = err.response?.status >= 500 && err.response?.status < 600;
            if ((is429 || is5xx) && attempt < maxRetries) {
              // Exponential w/ jitter, capped at 30s: 2s, 4s, 8s, 16s, 30s, 30s
              const base = Math.min(30000, Math.pow(2, attempt) * 2000);
              const delay = base + Math.floor(Math.random() * 500);
              logger.warn('Transient error, retrying', { status: err.response?.status, attempt: attempt + 1, delay });
              await sleep(delay);
            } else {
              throw err;
            }
          }
        }
      };

      // Paginate ALL conversations
      const allConversationIds = [];
      let startAfterDate = undefined;
      while (true) {
        const searchParams = { locationId, limit: 100 };
        if (startAfterDate) searchParams.startAfterDate = startAfterDate;
        const result = await withRetry(() => ghlService.searchConversations(locationId, searchParams));
        const convos = result.conversations || [];
        if (convos.length === 0) break;
        allConversationIds.push(...convos.map(c => c.id));
        if (convos.length < 100) break;
        const lastConvo = convos[convos.length - 1];
        startAfterDate = lastConvo.lastMessageDate || lastConvo.dateUpdated || lastConvo.dateAdded;
      }

      logger.info('Call Transcriptions: conversations fetched', { count: allConversationIds.length });

      // Step A — collect transcribable call messages.
      // Lower concurrency (3) to reduce 429 pressure on GHL; the tradeoff is wall-clock time.
      const PARALLEL = 3;
      const PAGE_SIZE = 300;
      const CALL_STATUSES_OK = new Set(['completed', 'answered', 'voicemail']);
      const transcribableMsgs = [];
      let conversationsFailed = 0;
      for (let i = 0; i < allConversationIds.length; i += PARALLEL) {
        const batch = allConversationIds.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(
          batch.map(async (cId) => {
            const out = [];
            let cursor = undefined;
            while (true) {
              const msgOptions = { limit: PAGE_SIZE, type: 'TYPE_CALL' };
              if (cursor) msgOptions.lastMessageId = cursor;
              const result = await withRetry(() => ghlService.getMessages(locationId, cId, msgOptions));
              const wrapper = result.messages || {};
              const pageMsgs = wrapper.messages || [];
              for (const m of pageMsgs) {
                if (CALL_STATUSES_OK.has(String(m?.status || '').toLowerCase())) {
                  out.push({ ...m, conversationId: cId });
                }
              }
              if (pageMsgs.length < PAGE_SIZE || !wrapper.nextPage) break;
              cursor = wrapper.lastMessageId;
            }
            return out;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            transcribableMsgs.push(...r.value);
          } else {
            conversationsFailed++;
            logger.warn('Conversation message fetch failed (after retries)', { error: r.reason?.message });
          }
        }
      }
      logger.info('Call Transcriptions: transcribable messages found', {
        count: transcribableMsgs.length, conversationsFailed
      });

      // Step B — fetch the plain-text transcript per message.
      // Per-message diagnostic logging so we can see exactly what GHL returns
      // (which messages are 400/404, empty, or unavailable for some other reason).
      const transcriptionRecords = [];
      let emptyCount = 0;
      let badRequestCount = 0;
      let notFoundCount = 0;
      let otherErrorCount = 0;
      for (let i = 0; i < transcribableMsgs.length; i += PARALLEL) {
        const batch = transcribableMsgs.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(
          batch.map(async (m) => {
            try {
              const raw = (await withRetry(() => ghlService.getMessageTranscription(locationId, m.id))) || '';
              const transcript = String(raw);
              const preview = transcript.length > 200 ? transcript.slice(0, 200) + '…' : transcript;
              logger.info('Transcription response', {
                messageId: m.id,
                conversationId: m.conversationId,
                msgStatus: m.status,
                bodyType: typeof raw,
                length: transcript.length,
                preview
              });
              if (!transcript.trim()) return { status: 'empty' };
              return {
                status: 'ok',
                record: {
                  messageId: m.id,
                  conversationId: m.conversationId,
                  contactId: m.contactId || '',
                  userId: m.userId || '',
                  messageType: m.type || '',
                  direction: m.direction || '',
                  status: m.status || '',
                  dateAdded: m.dateAdded || null,
                  callDuration: m.meta?.callDuration || '',
                  callStatus: m.meta?.callStatus || '',
                  transcript
                }
              };
            } catch (err) {
              const httpStatus = err.response?.status;
              const body = err.response?.data;
              const bodyPreview = typeof body === 'string'
                ? (body.length > 200 ? body.slice(0, 200) + '…' : body)
                : (body ? JSON.stringify(body).slice(0, 200) : '');
              logger.warn('Transcription fetch error', {
                messageId: m.id,
                conversationId: m.conversationId,
                msgStatus: m.status,
                httpStatus,
                error: err.message,
                bodyPreview
              });
              return { status: 'error', httpStatus };
            }
          })
        );
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const v = r.value;
          if (v.status === 'ok') transcriptionRecords.push(v.record);
          else if (v.status === 'empty') emptyCount++;
          else if (v.status === 'error') {
            if (v.httpStatus === 400) badRequestCount++;
            else if (v.httpStatus === 404) notFoundCount++;
            else otherErrorCount++;
          }
        }
      }

      logger.info('Call Transcriptions: transcripts fetched', {
        eligible: transcribableMsgs.length,
        storedTranscriptions: transcriptionRecords.length,
        emptyCount,
        badRequestCount,
        notFoundCount,
        otherErrorCount
      });

      if (transcriptionRecords.length === 0) {
        return res.status(400).json({ success: false, error: 'No transcribable calls found for this sub-account' });
      }

      // Chunked SpecialExport — store in callTranscriptionsMessages so it's clearly distinct
      // from the specialTabMessages records which use `messages`.
      const CHUNK_SIZE = 5000;
      const totalChunks = Math.max(1, Math.ceil(transcriptionRecords.length / CHUNK_SIZE));
      const specialExport = await SpecialExport.create({
        locationId,
        filters: { type: 'call_transcriptions' },
        callTranscriptionsMessages: transcriptionRecords.slice(0, CHUNK_SIZE),
        totalMessages: transcriptionRecords.length,
        totalConversations: allConversationIds.length,
        chunkIndex: 0,
        totalChunks,
        status: 'ready'
      });
      if (totalChunks > 1) {
        const chunkDocs = [];
        for (let ci = 1; ci < totalChunks; ci++) {
          chunkDocs.push({
            locationId,
            filters: { type: 'call_transcriptions' },
            callTranscriptionsMessages: transcriptionRecords.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE),
            totalMessages: transcriptionRecords.length,
            totalConversations: allConversationIds.length,
            groupId: specialExport._id,
            chunkIndex: ci,
            totalChunks,
            status: 'ready',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        await SpecialExport.insertMany(chunkDocs);
      }

      const total = transcriptionRecords.length;
      const unitPrice = 0.50;
      const finalAmount = total * unitPrice;
      return res.json({
        success: true,
        data: {
          estimate: {
            itemCounts: { callTranscriptions: total, total },
            baseAmount: finalAmount,
            discountPercent: 0,
            discountAmount: 0,
            finalAmount
          },
          filters,
          exportType,
          specialExportId: specialExport._id
        }
      });
    }

    // Get access token to fetch actual prices from GHL
    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    // Calculate estimate with actual GHL meter prices
    let estimate = await billingService.calculateEstimateWithPrices(counts, accessToken, locationId);
    estimate = {
      ...estimate,
      discountTiers: billingService.getDiscountTiers(),
      unitPrices: billingService.getUnitPrices(locationId)
    }
    const responseData = {
      estimate,
      filters,
      exportType,
      discountTiers: billingService.getDiscountTiers(),
      unitPrices: billingService.getUnitPrices(locationId)
    };

    // For notes with tags: return resolved contactIds so frontend can reuse them for export
    if (exportType === 'notes' && resolvedContactIds && resolvedContactIds.length > 0) {
      responseData.resolvedContactIds = resolvedContactIds;
      responseData.resolvedContactNames = resolvedContactNames;
      responseData.resolvedContactsMeta = resolvedContactsMeta || {};
    }

    res.json({ success: true, data: responseData });

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

    const validExportTypes = ['conversations', 'messages', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs', 'templates', 'specialTabMessages', 'callTranscriptions'];
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

    // Validate date range (not applicable for notes/links/templates)
    if (!['notes', 'links', 'templates'].includes(exportType)) {
      const dateValidation = validateDateRange(filters?.startDate, filters?.endDate, ['specialTabMessages', 'callTranscriptions'].includes(exportType) ? MAX_DATE_RANGE_MS_SPECIAL_TAB : MAX_DATE_RANGE_MS);
      if (!dateValidation.valid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }
    }

    logger.info('Starting charge-and-export', { locationId, exportType, companyId });

    // Notes require contacts — validate before any counting
    if (exportType === 'notes' && !filters?.contactId && !filters?.contactIds?.length) {
      return res.status(400).json({ success: false, error: 'Please select contacts or enter a tag to export notes' });
    }

    // Step 1: Get counts for billing
    const fetchCounts = async () => {
      const counts = {
        conversations: 0,
        smsMessages: 0,
        emailMessages: 0,
        notes: 0,
        tasks: 0,
        opportunities: 0,
        formSubmissions: 0,
        links: 0,
        socialPosts: 0,
        callLogs: 0,
        templates: 0
      };
      let totalItems = 0;

      if (exportType === 'conversations') {
        const result = await ghlService.searchConversations(locationId, {
          ...filters,
          limit: 100
        });
        totalItems = result.total || result.conversations?.length || 0;
        counts.conversations = totalItems;
      } else if (exportType === 'notes') {
        // Notes: contactIds already resolved during estimate, count passed from frontend
        totalItems = filters?.estimatedNoteCount || 0;
        counts.notes = totalItems;

      } else if (exportType === 'tasks') {
        // Tasks: location-level search API — always upfront billing
        const result = await ghlService.getLocationTasks(locationId, {
          contactIds: filters?.contactIds || [],
          assignedTo: filters?.assignedTo,
          completed: filters?.completed,
          overdue: filters?.overdue,
          query: filters?.query,
          dueDate: filters?.dueDate,
          sortKey: filters?.sortKey,
          sortDirection: filters?.sortDirection,
          limit: 1
        });
        totalItems = result.total || 0;
        counts.tasks = totalItems;

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
          formId: filters?.formId,
          q: filters?.query,
          startAt: filters?.startDate,
          endAt: filters?.endDate,
          limit: 1
        });
        totalItems = result.total || 0;
        counts.formSubmissions = totalItems;

      } else if (exportType === 'links') {
        const result = await ghlService.getLinks(locationId, { query: filters?.query, limit: 1000 });
        totalItems = result.total || result.links?.length || 0;
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

      } else if (exportType === 'templates') {
        const result = await ghlService.getTemplates(locationId, {
          type: filters?.type,
          limit: '1'
        });
        totalItems = result.total || 0;
        counts.templates = totalItems;

      } else if (exportType === 'specialTabMessages') {
        // LiveChat: use estimatedTotal from frontend (already counted during estimate)
        totalItems = filters?.estimatedTotal || 0;

      } else if (exportType === 'callTranscriptions') {
        // Use estimatedTotal from frontend (already counted during estimate — heavy task, do not re-walk)
        totalItems = filters?.estimatedTotal || 0;

      } else {
        // Use estimatedTotal from the estimate step if available (avoids GHL returning a different count)
        if (filters?.estimatedTotal) {
          totalItems = filters.estimatedTotal;
          logger.info('Using estimatedTotal from frontend', { estimatedTotal: totalItems });
        }

        const result = await ghlService.exportMessages(locationId, {
          ...filters,
          limit: 100
        });
        const messages = result.messages || [];

        if (!totalItems) {
          totalItems = result.total || messages.length;
        }

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

      return { counts, totalItems };
    };

    let { counts, totalItems } = await fetchCounts();

    // If first fetch returns 0, retry once to guard against transient empty results
    if (totalItems === 0) {
      logger.warn('totalItems=0 on first fetch, retrying once before declaring no data', { locationId, exportType });
      ({ counts, totalItems } = await fetchCounts());
    }

    if (totalItems === 0) {
      const noDataError = exportType === 'notes'
        ? 'No notes found for the selected contacts'
        : 'No items found matching the filters';
      return res.status(400).json({
        success: false,
        error: noDataError
      });
    }

    // Step 2: Get access token for billing API
    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    // Special Messages: standalone billing (flat $0.018/msg, single meter charge, no discount)
    let estimate, meterCharges;
    if (exportType === 'specialTabMessages') {
      const unitPrice = 0.018;
      const finalAmount = totalItems * unitPrice;
      estimate = { baseAmount: finalAmount, discountPercent: 0, discountAmount: 0, finalAmount };
      meterCharges = [{ meterId: '69864aed1265653fdd7c0620', qty: totalItems, description: 'Special messages export' }];
    } else if (exportType === 'callTranscriptions') {
      // Call Transcriptions: standalone billing (flat $0.50/record, single meter charge, no discount)
      // TODO: replace placeholder meterId with the real GHL meter ID for this product.
      const CALL_TRANSCRIPTIONS_METER_ID = process.env.CALL_TRANSCRIPTIONS_METER_ID || 'CALL_TRANSCRIPTIONS_METER_ID_TODO';
      const unitPrice = 0.50;
      const finalAmount = totalItems * unitPrice;
      estimate = { baseAmount: finalAmount, discountPercent: 0, discountAmount: 0, finalAmount };
      meterCharges = [{ meterId: CALL_TRANSCRIPTIONS_METER_ID, qty: totalItems, description: 'Call transcriptions export' }];
    } else {
      // Step 3: Calculate pricing with actual GHL meter prices
      estimate = await billingService.calculateEstimateWithPrices(counts, accessToken, locationId);
      // Step 5: Build meter charges
      meterCharges = billingService.buildMeterCharges(counts);
    }

    // Safety net: if billing resolved to $0 despite totalItems>0, the counts used for
    // billing are out of sync with the export count — block instead of exporting for free.
    if (estimate.finalAmount === 0) {
      logger.warn('Billing calculated $0 — blocking export to prevent free charge', {
        locationId, exportType, totalItems, counts
      });
      return res.status(400).json({
        success: false,
        error: 'No billable items found. Please adjust your filters and try again.'
      });
    }

    // Step 4: Check wallet funds
    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient wallet balance',
        message: 'Please add funds to your GHL wallet to continue'
      });
  }

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

      // Update transaction with charge IDs and referral code
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
      userIds: filters?.userIds?.length > 0 ? filters.userIds : [],
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
      assignedTo: filters?.assignedTo || null,
      monetaryValueMin: filters?.monetaryValueMin ?? null,
      monetaryValueMax: filters?.monetaryValueMax ?? null,
      sortKey: filters?.sortKey || null,
      sortDirection: filters?.sortDirection || null,
      contactName: filters?.contactName || null,
      // Form submission-specific filters
      formId: filters?.formId || null,
      // Template-specific filters
      templateType: filters?.type || null,
      // Call log-specific filters
      agentId: filters?.agentId || null,
      callType: filters?.callType || null,
      actionType: filters?.actionType || null,
      direction: filters?.direction || null,
      callSortBy: filters?.sortBy || null,
      callSort: filters?.sort || null,
      // Notes/Tasks contact name map { contactId: "Name" }
      contactNames: filters?.contactNames || null,
      // Notes contact meta map { contactId: { email, phone } } — enriches the exported CSV
      contactsMeta: filters?.contactsMeta || null,
      // Task-specific filters
      dueDate: filters?.dueDate ? { gt: filters.dueDate.gt || null, lte: filters.dueDate.lte || null } : null,
      businessId: filters?.businessId || null,
      completed: filters?.completed ?? null,
      overdue: filters?.overdue ?? null,
      unAssigned: filters?.unAssigned != null ? filters?.unAssigned : null,
      // Tag filter for notes export
      tags: filters?.tags || null,
      // LiveChat-specific filters
      specialTabType: filters?.type || null,
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

    console.log("jobfilters: ", jobFilters)
    // Update transaction with job reference
    transaction.exportJobId = exportJob._id;
    await transaction.save();

    // Step 9a: Link the SpecialExport to this job.
    // For specialTabMessages it was created during /estimate; for callTranscriptions it was created in Step 7a (post-charge).
    if (['specialTabMessages', 'callTranscriptions'].includes(exportType) && filters?.specialExportId) {
      try {
        await SpecialExport.findByIdAndUpdate(filters.specialExportId, {
          exportJobId: exportJob._id
        });
        logger.info('Linked SpecialExport to job', { specialExportId: filters.specialExportId, jobId: exportJob._id });
      } catch (linkError) {
        logger.error('Failed to link SpecialExport', { error: linkError.message });
      }
    }

    // Step 9: Trigger Lambda function
    try {
      const lambdaParams = {
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: 'Event',  // Async invocation
        Qualifier: '$LATEST',     // Required for durable functions
        Payload: Buffer.from(JSON.stringify({
          exportJobId: exportJob._id.toString()
        }))
      };

      const lambdaResult = await lambda.send(new InvokeCommand(lambdaParams));

      // Update job status
      exportJob.status = 'processing';
      exportJob.startedAt = new Date();
      exportJob.lambdaRequestId = lambdaResult.$metadata?.requestId || null;
      await exportJob.save();

      logger.info('Lambda triggered successfully', {
        jobId: exportJob._id,
        requestId: lambdaResult.$metadata?.requestId
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
  const locationId = req.query?.locationId;
  const [specialTabLocationIds, customChargeLocationIds, importNotesLocationIds, callTranscriptionsLocationIds] = await Promise.all([
    AppConfig.getValues('specialTabLocationIds'),
    AppConfig.getValues('customChargeLocationIds'),
    AppConfig.getValues('importNotesLocationIds'),
    AppConfig.getValues('callTranscriptionsLocationIds')
  ]);
  // "*" in values = show to all locations (global kill-switch)
  const specialTabEnabled = locationId
    ? (specialTabLocationIds.includes('*') || specialTabLocationIds.includes(locationId))
    : false;
  const customChargeEnabled = locationId
    ? (customChargeLocationIds.includes('*') || customChargeLocationIds.includes(locationId))
    : false;
  const importNotesEnabled = locationId
    ? (importNotesLocationIds.includes('*') || importNotesLocationIds.includes(locationId))
    : false;
  const callTranscriptionsEnabled = locationId
    ? (callTranscriptionsLocationIds.includes('*') || callTranscriptionsLocationIds.includes(locationId))
    : false;
  res.json({
    success: true,
    data: {
      unitPrices: billingService.getUnitPrices(locationId),
      discountTiers: billingService.getDiscountTiers(),
      maxDateRange: '1 month',
      maxDateRangeMonths: 6,
      specialTabEnabled,
      customChargeEnabled,
      importNotesEnabled,
      callTranscriptionsEnabled
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
 * @route GET /api/billing/contacts/:contactId/tasks
 * @desc Get tasks for a specific contact (for preview)
 */
router.get('/contacts/:contactId/tasks', authenticateSession, async (req, res) => {
  try {
    const { contactId } = req.params;
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.getContactTasks(locationId, contactId);

    res.json({
      success: true,
      data: {
        tasks: result.tasks || [],
        total: result.total || 0
      }
    });

  } catch (error) {
    logError('Get contact tasks error', error, { contactId: req.params?.contactId });
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
});

/**
 * @route POST /api/billing/formSubmissions/search
 * @desc Search form submissions for a location (for preview in UI)
 */
router.post('/formSubmissions/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, filters = {}, page = 1, limit = 25 } = req.body;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const result = await ghlService.getFormSubmissions(locationId, {
      formId: filters.formId,
      q: filters.query,
      startAt: filters.startDate,
      endAt: filters.endDate,
      page,
      limit
    });
    res.json({
      success: true,
      data: {
        submissions: result.submissions || [],
        total: result.total || 0,
        page,
        limit
      }
    });
  } catch (error) {
    logError('Search form submissions error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search form submissions' });
  }
});

/**
 * @route POST /api/billing/links/search
 * @desc Search trigger links for a location (for preview in UI)
 */
router.post('/links/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, query = '', page = 1, limit = 25 } = req.body;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const skip = (page - 1) * limit;
    const result = await ghlService.getLinks(locationId, { query, limit, skip });
    res.json({
      success: true,
      data: {
        links: result.links || [],
        total: result.total || 0,
        page,
        limit
      }
    });
  } catch (error) {
    logError('Search links error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search links' });
  }
});

/**
 * @route POST /api/billing/opportunities/search
 * @desc Search opportunities for a location (for preview in UI)
 */
router.post('/opportunities/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, filters = {}, searchAfter = null, limit = 20 } = req.body;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.searchOpportunities(locationId, {
      ...filters,
      searchAfter: searchAfter || [],
      limit
    });

    res.json({
      success: true,
      data: {
        opportunities: result.opportunities || [],
        total: result.total || 0,
        nextSearchAfter: result.searchAfter || null
      }
    });
  } catch (error) {
    logError('Search opportunities error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search opportunities' });
  }
});

/**
 * @route POST /api/billing/tasks/search
 * @desc Search tasks for a location (for preview in UI)
 */
router.post('/tasks/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, filters = {}, searchAfter = null, limit = 25 } = req.body;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const result = await ghlService.getLocationTasks(locationId, {
      contactIds: filters.contactIds || [],
      assignedTo: filters.assignedTo,
      unAssigned: filters.unAssigned,
      completed: filters.completed,
      overdue: filters.overdue,
      query: filters.query,
      dueDate: filters.dueDate,
      sortKey: filters.sortKey,
      sortDirection: filters.sortDirection,
      businessId: filters?.businessId,
      searchAfter: searchAfter || [],
      skip: 0,
      limit
    });

    // Return last task's searchAfter for cursor pagination
    const tasks = result.tasks || [];
    const nextSearchAfter = tasks.length > 0 ? (tasks[tasks.length - 1].searchAfter || null) : null;

    res.json({
      success: true,
      data: {
        tasks,
        total: result.total || 0,
        nextSearchAfter
      }
    });
  } catch (error) {
    logError('Search tasks error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search tasks' });
  }
});

/**
 * @route POST /api/billing/templates/search
 * @desc Search templates for a location (for preview in UI)
 */
router.post('/templates/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, filters = {}, page = 1, limit = 25 } = req.body;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const skip = (page - 1) * limit;
    const result = await ghlService.getTemplates(locationId, {
      type: filters.type,
      limit: String(limit),
      skip: String(skip)
    });
    res.json({
      success: true,
      data: {
        templates: result.templates || [],
        total: result.total || 0,
        page,
        limit
      }
    });
  } catch (error) {
    logError('Search templates error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search templates' });
  }
});

/**
 * @route POST /api/billing/callLogs/search
 * @desc Search call logs for a location (for preview in UI)
 */
router.post('/callLogs/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, filters = {}, page = 1, pageSize = 50 } = req.body;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const options = { page, pageSize };
    if (filters.agentId) options.agentId = filters.agentId;
    if (filters.contactId) options.contactId = filters.contactId;
    if (filters.callType) options.callType = filters.callType;
    if (filters.direction) options.direction = filters.direction;
    if (filters.actionType) options.actionType = filters.actionType;
    if (filters.startDate) options.startDate = filters.startDate;
    if (filters.endDate) options.endDate = filters.endDate;
    if (filters.sortBy) options.sortBy = filters.sortBy;
    if (filters.sort) options.sort = filters.sort;

    const result = await ghlService.getCallLogs(locationId, options);
    res.json({
      success: true,
      data: {
        callLogs: result.callLogs || [],
        total: result.total || 0,
        page,
        pageSize
      }
    });
  } catch (error) {
    logError('Search call logs error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search call logs' });
  }
});

/**
 * @route GET /api/billing/voice-ai-agents
 * @desc Get voice AI agents for a location (for filter dropdowns)
 */
router.get('/voice-ai-agents', authenticateSession, async (req, res) => {
  try {
    const { locationId } = req.query;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const result = await ghlService.getVoiceAIAgents(locationId);
    res.json({ success: true, data: result });
  } catch (error) {
    logError('Get voice AI agents error', error, { locationId: req.query?.locationId });
    res.status(500).json({ success: false, error: 'Failed to get voice AI agents' });
  }
});

/**
 * @route GET /api/billing/users
 * @desc Search users for a location's company (for filter dropdowns)
 */
router.get('/users', authenticateSession, async (req, res) => {
  try {
    const { locationId, query = '' } = req.query;
    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    const companyLocation = await CompanyLocation.findCompanyByLocation(locationId);
    if (!companyLocation) {
      return res.status(404).json({ success: false, error: 'Company not found for this location' });
    }
    const users = await ghlService.searchUsers(locationId, { companyId: companyLocation.companyId, query });
    res.json({ success: true, data: { users } });
  } catch (error) {
    logError('Search users error', error, { locationId: req.query?.locationId });
    res.status(500).json({ success: false, error: 'Failed to search users' });
  }
});

/**
 * @route GET /api/billing/contacts/search
 * @desc Search contacts for a location (for filter dropdowns)
 */
router.get('/contacts/search', authenticateSession, async (req, res) => {
  try {
    const { locationId, query, limit, tag } = req.query;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }

    const options = {
      query: query || '',
      limit: parseInt(limit) || 20
    };
    if (tag) options.tag = tag;

    const result = await ghlService.searchContacts(locationId, options);

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

/**
 * @route POST /api/billing/custom-charge
 * @desc Charge a specific location a custom amount directly
 */
router.post('/custom-charge', authenticateSession, async (req, res) => {
  try {
    const { locationId, amount } = req.body;
    const { companyId, userId } = req.user;

    const customChargeLocationIds = await AppConfig.getValues('customChargeLocationIds');
    const isAllowed = customChargeLocationIds.includes('*') || customChargeLocationIds.includes(locationId);
    if (!isAllowed) {
      return res.status(403).json({ success: false, error: 'Not authorized for this location' });
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid amount greater than 0 is required' });
    }

    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      return res.status(402).json({ success: false, error: 'Insufficient wallet balance' });
    }

    const meterCharges = [{ meterId: '69864aed1265653fdd7c0620', qty: 1, description: `Custom charge $${parsedAmount}` }];

    const transaction = await BillingTransaction.create({
      locationId,
      companyId,
      type: 'custom_charge',
      itemCounts: { total: 1 },
      pricing: { baseAmount: parsedAmount, discountPercent: 0, discountAmount: 0, finalAmount: parsedAmount },
      meterCharges,
      status: 'pending',
      userId,
    });

    try {
      const chargeResult = await billingService.chargeWallet(companyId, accessToken, meterCharges, locationId, transaction._id.toString(), parsedAmount);
      transaction.ghlChargeId = chargeResult?.charges?.map(c => c?.chargeId).join(',');
      transaction.referralCode = chargeResult.referralCode || null;
      transaction.status = chargeResult.internalTesting ? 'tested' : 'charged';
      transaction.internalTesting = !!chargeResult.internalTesting;
      transaction.paymentIgnored = !!chargeResult.internalTesting;
      await transaction.save();

      return res.json({ success: true, chargeId: transaction.ghlChargeId, amount: parsedAmount });
    } catch (chargeError) {
      transaction.status = 'failed';
      transaction.errorMessage = chargeError.message;
      await transaction.save();
      return res.status(402).json({ success: false, error: chargeError.message });
    }
  } catch (error) {
    logError('Custom charge error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: 'Custom charge failed' });
  }
});

module.exports = router;
