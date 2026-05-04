const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');

// Initialize AWS services
const s3 = new S3Client();
const lambda = new LambdaClient();

// Environment variables
const S3_BUCKET = process.env.S3_BUCKET || 'convo-vault-exports';
const MONGODB_URI = process.env.MONGODB_URI;
const GHL_API_URL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
const GHL_OAUTH_URL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;

// Brevo Email configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_FROM_NAME = 'VaultSuite';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';

// Batch processing configuration
const BATCH_SIZE = 5000;            // Records per Lambda invocation
const API_PAGE_SIZE = 100;          // Records per GHL API call
const API_MESSAGES_PAGE_SIZE = 1000;
const API_CALL_LOGS_PAGE_SIZE = 50; // Max pageSize for Voice AI call logs API
const TIMEOUT_BUFFER_MS = 13 * 60 * 1000;  // 14 min buffer before timeout

// MongoDB client (reused across warm invocations)
let dbClient = null;

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get MongoDB connection
 */
async function getDb() {
  if (!dbClient) {
    dbClient = new MongoClient(MONGODB_URI);
    await dbClient.connect();
  }
  return dbClient.db();
}

/**
 * Refresh GHL access token
 * Returns both the new access token and new refresh token
 */
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams();
  params.append('client_id', GHL_CLIENT_ID);
  params.append('client_secret', GHL_CLIENT_SECRET);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const response = await axios.post(`${GHL_OAUTH_URL}/token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token
  };
}

/**
 * Fetch a single page of conversations
 */
async function fetchConversationsPage(locationId, accessToken, filters, skip) {
  const params = {
    locationId,
    limit: API_PAGE_SIZE,
    skip,
    ...filters
  };

  // Convert date filters to timestamps (start of day / end of day)
  if (params.startDate) {
    const date = new Date(params.startDate);
    date.setHours(0, 0, 0, 0); // 12:00 AM
    params.startDate = date.getTime();
  }
  if (params.endDate) {
    const date = new Date(params.endDate);
    date.setHours(23, 59, 59, 999); // 11:59 PM
    params.endDate = date.getTime();
  }

  const response = await axios.get(`${GHL_API_URL}/conversations/search`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  return {
    data: response.data.conversations || [],
    hasMore: (response.data.conversations || []).length === API_PAGE_SIZE
  };
}

/**
 * Fetch a single page of messages
 */
async function fetchMessagesPage(locationId, accessToken, filters, cursor) {
  // Only pass valid GHL message export params — exclude internal fields
  const params = {
    locationId,
    limit: API_MESSAGES_PAGE_SIZE,
  };
  if (filters.channel) params.channel = filters.channel;
  if (filters.startDate) params.startDate = filters.startDate;
  if (filters.endDate) params.endDate = filters.endDate;
  if (filters.contactId) params.contactId = filters.contactId;
  if (filters.conversationId) params.conversationId = filters.conversationId;
  if (filters.query) params.query = filters.query;
  if (filters.id) params.id = filters.id;
  if (filters.direction) params.direction = filters.direction;
  if (Array.isArray(filters.userIds) && filters.userIds.length > 0) {
    params.userIds = filters.userIds.filter(Boolean);
  }

  // Convert date filters to ISO strings (start of day / end of day)
  if (params.startDate) {
    const date = new Date(params.startDate);
    date.setHours(0, 0, 0, 0); // 12:00 AM
    params.startDate = date.toISOString();
  }
  if (params.endDate) {
    const date = new Date(params.endDate);
    date.setHours(23, 59, 59, 999); // 11:59 PM
    params.endDate = date.toISOString();
  }

  if (cursor) {
    params.cursor = cursor;
  }

  const response = await axios.get(`${GHL_API_URL}/conversations/messages/export`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  return {
    data: response.data.messages || [],
    nextCursor: response.data.nextCursor || null
  };
}





/**
 * Fetch all notes for a specific contact
 */
async function fetchNotesForContact(contactId, accessToken) {
  const response = await axios.get(`${GHL_API_URL}/contacts/${contactId}/notes`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    }
  });
  return response.data.notes || [];
}

function nonNullValue(val){
  return val != null && val != undefined && val != "";
}

/**
 * Fetch all tasks for a specific contact
 */
/**
 * Fetch a page of tasks for a location via location-level search API
 */
async function fetchTasksPage(locationId, accessToken, skip, filters = {}) {
  const LIMIT = 1000;
  const body = { limit: LIMIT, skip, count: true };

  // contactId is always an array in the API
  if (filters.contactIds && filters.contactIds.length > 0) {
    body.contactId = filters.contactIds;
  }
  if (filters.assignedTo) body.assignedTo = filters.assignedTo;
  if (nonNullValue(filters.completed)) body.completed = filters.completed;
  if (nonNullValue(filters.overdue)) body.overdue = filters.overdue;
  if (filters.query) body.query = filters.query;
  // dueDate filter: { gt, lte }
  if (filters.dueDate) body.dueDate = filters.dueDate;
  if (filters.sortKey) body.sortKey = filters.sortKey;
  if (nonNullValue(filters.sortDirection)) body.sortDirection = filters.sortDirection;
  if (nonNullValue(filters.businessId)) body.businessId = filters.businessId;
  if (nonNullValue(filters.unAssigned)) body.unAssigned = filters.unAssigned;

  const response = await axios.post(`${GHL_API_URL}/locations/${locationId}/tasks/search`, body, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    }
  });

  const tasks = response.data.tasks || [];
  const total = response.data.count || response.data.total || 0;
  return { data: tasks, total, hasMore: tasks.length >= LIMIT };
}

/**
 * Fetch a page of opportunities for a location
 */
async function fetchOpportunitiesPage(locationId, accessToken, page, filters = {}) {
  const body = {
    locationId,
    limit: API_PAGE_SIZE,
    page
  };

  if (filters.query) body.query = filters.query;

  // Build filters array from named options
  const filterArr = [];
  if (filters.pipelineId) filterArr.push({ field: 'pipeline_id', operator: 'eq', value: filters.pipelineId });
  if (filters.pipelineStageId) filterArr.push({ field: 'pipeline_stage_id', operator: 'eq', value: filters.pipelineStageId });
  if (filters.status) filterArr.push({ field: 'status', operator: 'eq', value: filters.status });
  if (filters.assignedTo) filterArr.push({ field: 'assigned_to', operator: 'eq', value: filters.assignedTo });
  if (filters.contactId) filterArr.push({ field: 'contact_id', operator: 'eq', value: filters.contactId });
  if (filters.contactName) filterArr.push({ field: 'contact_name', operator: 'contains', value: filters.contactName });

  // Monetary value range
  if (filters.monetaryValueMin != null || filters.monetaryValueMax != null) {
    const range = {};
    if (filters.monetaryValueMin != null) range.gte = Number(filters.monetaryValueMin);
    if (filters.monetaryValueMax != null) range.lte = Number(filters.monetaryValueMax);
    if (Object.keys(range).length > 0) filterArr.push({ field: 'monetary_value', operator: 'range', value: range });
  }

  // Date added range
  if (filters.startDate || filters.endDate) {
    const range = {};
    if (filters.startDate) range.gte = new Date(filters.startDate).getTime();
    if (filters.endDate) range.lte = new Date(filters.endDate).getTime();
    filterArr.push({ field: 'date_added', operator: 'range', value: range });
  }

  if (filterArr.length > 0) body.filters = filterArr;

  // Sort
  if (filters.sortField) {
    body.sort = [{ field: filters.sortField, direction: filters.sortDirection || 'desc' }];
  }

  const response = await axios.post(`${GHL_API_URL}/opportunities/search`, body, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    }
  });

  const opportunities = response.data.opportunities || [];
  const total = response.data.total || 0;

  return {
    data: opportunities,
    total,
    hasMore: opportunities.length === API_PAGE_SIZE
  };
}

/**
 * Fetch a page of templates for a location
 * GET /locations/{locationId}/templates
 */
async function fetchTemplatesPage(locationId, accessToken, skip, filters = {}) {
  const params = {
    limit: '100',
    skip: String(skip || 0),
    deleted: false
  };
  if (filters.templateType) params.type = filters.templateType;

  const response = await axios.get(`${GHL_API_URL}/locations/${locationId}/templates`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  const templates = response.data.templates || [];
  const total = response.data.totalCount || 0;

  return {
    data: templates,
    total,
    hasMore: templates.length === 100
  };
}

/**
 * Fetch a page of form submissions for a location
 */
async function fetchFormSubmissionsPage(locationId, accessToken, page, filters = {}) {
  const params = {
    locationId,
    limit: API_PAGE_SIZE,
    page
  };

  if (filters.formId) params.formId = filters.formId;
  if (filters.query) params.q = filters.query;

  // Convert date filters to YYYY-MM-DD format
  if (filters.startDate) {
    const date = new Date(filters.startDate);
    params.startAt = date.toISOString().split('T')[0];
  }
  if (filters.endDate) {
    const date = new Date(filters.endDate);
    params.endAt = date.toISOString().split('T')[0];
  }

  const response = await axios.get(`${GHL_API_URL}/forms/submissions`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  const submissions = response.data.submissions || [];
  const total = response.data.meta?.total || 0;

  return {
    data: submissions,
    total,
    hasMore: submissions.length === API_PAGE_SIZE
  };
}

/**
 * Fetch a page of trigger links for a location via /links/search
 */
async function fetchLinksPage(locationId, accessToken, skip, filters = {}) {
  const params = {
    locationId,
    limit: 1000,
    skip: skip || 0
  };
  if (filters.query) params.query = filters.query;

  const response = await axios.get(`${GHL_API_URL}/links/search`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  const links = response.data.links || [];
  const total = response.data.totalCount || links.length;

  return {
    data: links,
    total,
    hasMore: links.length === 1000
  };
}

/**
 * Fetch a page of social media posts for a location
 */
async function fetchSocialPostsPage(locationId, accessToken, skip = 0, filters = {}) {
  const body = {
    limit: API_PAGE_SIZE,
    skip
  };

  if (filters.type) body.type = filters.type;
  if (filters.status) body.status = filters.status;
  if (filters.accountIds) body.accountIds = filters.accountIds;

  const response = await axios.post(`${GHL_API_URL}/social-media-posting/${locationId}/posts/list`, body, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    }
  });

  const posts = response.data.posts || response.data.data || [];

  return {
    data: posts,
    total: response.data.total || posts.length,
    hasMore: posts.length === API_PAGE_SIZE
  };
}

/**
 * Fetch a page of voice AI call logs for a location
 * Note: Uses Version header 2021-04-15
 */
async function fetchCallLogsPage(locationId, accessToken, page = 1, filters = {}) {
  const params = {
    locationId,
    page,
    pageSize: API_CALL_LOGS_PAGE_SIZE
  };

  if (filters.agentId) params.agentId = filters.agentId;
  if (filters.contactId) params.contactId = filters.contactId;
  if (filters.callType) params.callType = filters.callType;
  if (filters.actionType) params.actionType = filters.actionType;
  if (filters.direction) params.direction = filters.direction;
  if (filters.callSortBy) params.sortBy = filters.callSortBy;
  if (filters.callSort) params.sort = filters.callSort;

  // Convert date filters
  if (filters.startDate) {
    const date = new Date(filters.startDate);
    date.setHours(0, 0, 0, 0);
    params.startDate = date.toISOString();
  }
  if (filters.endDate) {
    const date = new Date(filters.endDate);
    date.setHours(23, 59, 59, 999);
    params.endDate = date.toISOString();
  }

  const response = await axios.get(`${GHL_API_URL}/voice-ai/dashboard/call-logs`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-04-15'
    },
    params
  });

  const callLogs = response.data.callLogs || [];
  const total = response.data.total || 0;

  return {
    data: callLogs,
    total,
    hasMore: callLogs.length === API_CALL_LOGS_PAGE_SIZE
  };
}

/**
 * Escape CSV value
 */
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${str}"`;
}

/**
 * Format date to readable string (ISO format)
 */
function formatDate(val) {
  if (!val) return '';
  try {
    const date = new Date(val);
    if (isNaN(date.getTime())) return '';
    return date.toISOString();
  } catch {
    return '';
  }
}

/**
 * Convert conversations to CSV format
 */
function conversationsToCSV(conversations, includeHeader = true) {
  const header = includeHeader
    ? 'ID,ContactID,ContactName,ContactEmail,ContactPhone,Type,LastMessageType,LastMessageDate,UnreadCount,DateAdded\n'
    : '';

  const rows = conversations.map(conv => {
    return [
      escapeCsv(conv.id),
      escapeCsv(conv.contactId),
      escapeCsv(conv.contactName || conv.fullName),
      escapeCsv(conv.email),
      escapeCsv(conv.phone),
      escapeCsv(conv.type),
      escapeCsv(conv.lastMessageType),
      escapeCsv(formatDate(conv.lastMessageDate)),
      escapeCsv(conv.unreadCount || 0),
      escapeCsv(formatDate(conv.dateAdded))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert messages to CSV format
 * @param {Array} messages - Messages to convert
 * @param {boolean} includeHeader - Include CSV header row
 * @param {string} channelFilter - Channel filter (Email, SMS, Call, Facebook, Instagram, WhatsApp, etc.)
 */
function messagesToCSV(messages, includeHeader = true, channelFilter = '') {
  const isEmailExport = channelFilter === 'Email';

  // Different headers based on channel type
  let header = '';
  if (includeHeader) {
    if (isEmailExport) {
      // Email-specific columns with Subject, CC, BCC
      header = 'Date,ConversationID,ContactID,ConversationProviderId,MessageType,Direction,Status,From,To,Subject,CC,BCC,Message,Attachments,Source\n';
    } else {
      // Default for SMS, WhatsApp, Facebook, Instagram, Call, etc. - includes meta fields
      header = 'Date,ConversationID,ContactID,ConversationProviderId,MessageType,Direction,Status,From,To,Message,Attachments,Source,CallDuration,CallStatus,FacebookPage,InstagramPage\n';
    }
  }

  const rows = messages.map(msg => {
    const direction = msg.direction || msg?.meta?.email?.direction || 'outbound';
    const isEmail = msg.messageType === 'TYPE_EMAIL' || msg.messageType === 'TYPE_CAMPAIGN_EMAIL' || msg.messageType === 'TYPE_CUSTOM_EMAIL' || msg.messageType === 'TYPE_CUSTOM_PROVIDER_EMAIL';

    // For emails, get email-specific fields from meta
    const emailMeta = msg.meta?.email || {};
    const subject = emailMeta.subject || msg?.subject || '';
    const cc = emailMeta.cc || msg?.cc || '';
    const bcc = emailMeta.bcc || msg?.bcc || '';

    // From/To: for emails use email addresses, for others use phone numbers
    const from = (isEmail ? emailMeta.from || msg.from : msg.from) || '';
    let to = (isEmail ? emailMeta.to || msg.to : msg.to) || '';
    if(Array.isArray(to)){
      to = to?.join(";");
    }

    // Attachments as semicolon-separated URLs
    const attachments = Array.isArray(msg.attachments) ? msg.attachments.join('; ') : '';

    // Source (workflow, bulk_actions, campaign, api, app)
    const source = msg.source || '';

    // Meta fields for non-email exports
    const callDuration = msg.meta?.callDuration || '';
    const callStatus = msg.meta?.callStatus || '';
    const fbPage = msg.meta?.fb?.page_name || '';
    const igPage = msg.meta?.ig?.page_name || '';

    // Build row based on export type
    if (isEmailExport) {
      return [
        escapeCsv(formatDate(msg.dateAdded)),
        escapeCsv(msg.conversationId),
        escapeCsv(msg.contactId),
        escapeCsv(msg.conversationProviderId || ''),
        escapeCsv(msg.messageType || msg.type),
        escapeCsv(direction),
        escapeCsv(msg.status),
        escapeCsv(from),
        escapeCsv(to),
        escapeCsv(subject),
        escapeCsv(cc),
        escapeCsv(bcc),
        escapeCsv(msg.body),
        escapeCsv(attachments),
        escapeCsv(source)
      ].join(',');
    } else {
      // Default for all other channels - includes meta fields
      return [
        escapeCsv(formatDate(msg.dateAdded)),
        escapeCsv(msg.conversationId),
        escapeCsv(msg.contactId),
        escapeCsv(msg.conversationProviderId || ''),
        escapeCsv(msg.messageType || msg.type),
        escapeCsv(direction),
        escapeCsv(msg.status),
        escapeCsv(from),
        escapeCsv(to),
        escapeCsv(msg.body),
        escapeCsv(attachments),
        escapeCsv(source),
        escapeCsv(callDuration),
        escapeCsv(callStatus),
        escapeCsv(fbPage),
        escapeCsv(igPage)
      ].join(',');
    }
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}


/**
 * Convert notes to CSV format
 */
function notesToCSV(notes, includeHeader = true) {
  const header = includeHeader
    ? 'NoteID,ContactID,ContactName,ContactEmail,ContactPhone,Body,BodyText,UserID,DateAdded,Relations\n'
    : '';

  const serializeRelations = (relations) => {
    if (!Array.isArray(relations) || relations.length === 0) return '';
    return relations.map(r => `${r.objectKey}:${r.recordId}`).join('|');
  };

  const rows = notes.map(note => {
    return [
      escapeCsv(note.id),
      escapeCsv(note.contactId),
      escapeCsv(note.contactName || ''),
      escapeCsv(note.contactEmail || ''),
      escapeCsv(note.contactPhone || ''),
      escapeCsv(note.body || ''),
      escapeCsv(note.bodyText || ''),
      escapeCsv(note.userId || ''),
      escapeCsv(formatDate(note.dateAdded)),
      escapeCsv(serializeRelations(note.relations))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert tasks to CSV format
 */
function tasksToCSV(tasks, includeHeader = true) {
  const header = includeHeader
    ? 'TaskID,ContactID,ContactName,Title,Body,DueDate,Completed,AssignedTo\n'
    : '';

  const rows = tasks.map(task => {
    return [
      escapeCsv(task._id),
      escapeCsv(task.contactId),
      escapeCsv(task.contactName || ''),
      escapeCsv(task.title || ''),
      escapeCsv(task.bodyText || task.body || ''),
      escapeCsv(task.dueDate ? formatDate(task.dueDate) : ''),
      escapeCsv(nonNullValue(task.completed)  ? (task.completed ? 'Yes' : 'No') : ''),
      escapeCsv(task.assignedTo || ''),
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert opportunities to CSV format
 */
function opportunitiesToCSV(opportunities, includeHeader = true) {
  const header = includeHeader
    ? 'OpportunityID,Name,MonetaryValue,PipelineId,PipelineStageId,Status,Source,ContactId,ContactName,ContactEmail,ContactPhone,AssignedTo,LostReasonId,CreatedAt,UpdatedAt,LastStatusChangeAt,LastStageChangeAt\n'
    : '';

  const rows = opportunities.map(opp => {
    const contact = opp.contact || {};
    return [
      escapeCsv(opp.id),
      escapeCsv(opp.name),
      escapeCsv(opp.monetaryValue || 0),
      escapeCsv(opp.pipelineId),
      escapeCsv(opp.pipelineStageId),
      escapeCsv(opp.status),
      escapeCsv(opp.source || ''),
      escapeCsv(opp.contactId),
      escapeCsv(contact.name || contact.contactName || ''),
      escapeCsv(contact.email || ''),
      escapeCsv(contact.phone || ''),
      escapeCsv(opp.assignedTo || ''),
      escapeCsv(opp.lostReasonId || ''),
      escapeCsv(formatDate(opp.createdAt)),
      escapeCsv(formatDate(opp.updatedAt)),
      escapeCsv(formatDate(opp.lastStatusChangeAt)),
      escapeCsv(formatDate(opp.lastStageChangeAt))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert form submissions to CSV format
 */
function formSubmissionsToCSV(submissions, includeHeader = true) {
  const header = includeHeader
    ? 'SubmissionID,FormID,ContactID,Name,Email,CreatedAt,OtherFields\n'
    : '';

  const rows = submissions.map(sub => {
    // Flatten 'others' object into a readable string
    let otherFields = '';
    if (sub.others && typeof sub.others === 'object') {
      otherFields = Object.entries(sub.others)
        .filter(([key]) => !key.startsWith('event'))
        .map(([key, val]) => `${key}: ${val}`)
        .join('; ');
    }

    return [
      escapeCsv(sub.id),
      escapeCsv(sub.formId),
      escapeCsv(sub.contactId),
      escapeCsv(sub.name || ''),
      escapeCsv(sub.email || ''),
      escapeCsv(formatDate(sub.createdAt)),
      escapeCsv(otherFields)
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert links to CSV format
 */
function linksToCSV(links, includeHeader = true) {
  const header = includeHeader
    ? 'LinkID,Name,RedirectTo,FieldKey,dateAdded,dateUpdated\n'
    : '';

  const rows = links.map(link => {
    return [
      escapeCsv(link._id),
      escapeCsv(link.name),
      escapeCsv(link.redirectTo || ''),
      escapeCsv("{{trigger_link."+link._id+"}}"),
      escapeCsv(formatDate(link.dateAdded)),
      escapeCsv(formatDate(link.dateUpdated))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert templates to CSV format
 */
function templatesToCSV(templates, includeHeader = true) {
  const header = includeHeader
    ? 'TemplateID,Name,Type,Subject,Body,HTML,Attachments,LocationID,OriginID,DateAdded,DateUpdated\n'
    : '';

  const rows = templates.map(t => {
    const tpl = t.template || {};
    // Email: subject, html, attachments; SMS/WhatsApp: body
    const subject = tpl.subject || '';
    const body = tpl.body || '';
    const html = tpl.html || '';

    // Attachments: prefer template.attachments (emails), fallback to urlAttachments
    const attachments = Array.isArray(tpl.attachments) && tpl.attachments.length > 0
      ? tpl.attachments
      : Array.isArray(t.urlAttachments) && t.urlAttachments.length > 0
        ? t.urlAttachments
        : [];
    const attachmentList = attachments.join('; ');

    return [
      escapeCsv(t._id || t.id || ''),
      escapeCsv(t.name || ''),
      escapeCsv(t.type || ''),
      escapeCsv(subject),
      escapeCsv(body),
      escapeCsv(html),
      escapeCsv(attachmentList),
      escapeCsv(t.locationId || ''),
      escapeCsv(t.originId || ''),
      escapeCsv(formatDate(t.dateAdded)),
      escapeCsv(formatDate(t.dateUpdated))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert social posts to CSV format
 */
function socialPostsToCSV(posts, includeHeader = true) {
  const header = includeHeader
    ? 'PostID,Summary,Type,Status,Platforms,ScheduledAt,PublishedAt,CreatedAt,UpdatedAt\n'
    : '';

  const rows = posts.map(post => {
    const platforms = Array.isArray(post.accountIds) ? post.accountIds.join('; ') : (post.platforms || '');
    return [
      escapeCsv(post.id || post._id),
      escapeCsv(post.summary || post.content || ''),
      escapeCsv(post.type || ''),
      escapeCsv(post.status || ''),
      escapeCsv(platforms),
      escapeCsv(formatDate(post.scheduledAt || post.scheduleDate)),
      escapeCsv(formatDate(post.publishedAt || post.publishDate)),
      escapeCsv(formatDate(post.createdAt)),
      escapeCsv(formatDate(post.updatedAt))
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert call logs to CSV format
 */
function callLogsToCSV(callLogs, includeHeader = true) {
  const header = includeHeader
    ? 'CallID,ContactID,AgentID,FromNumber,CallType,CallStatus,Duration,Summary,CreatedAt,TrialCall,WorkflowID,MessageID,ExtractedData,CallActions,Transcript,Translation\n'
    : '';

  const rows = callLogs.map(log => {
    // Flatten extractedData into readable key=value pairs
    let extractedData = '';
    if (log.extractedData && typeof log.extractedData === 'object') {
      extractedData = Object.entries(log.extractedData)
        .map(([key, val]) => `${key}=${val}`)
        .join('; ');
    }

    // Full action details: actionType | actionName | executedAt | key params
    const actions = Array.isArray(log.executedCallActions)
      ? log.executedCallActions.map(a => {
          const parts = [`[${a.actionType || 'UNKNOWN'}] ${a.actionName || ''}`];
          if (a.executedAt) parts.push(`executed: ${formatDate(a.executedAt)}`);
          // Include key action parameters
          const params = a.actionParameters || {};
          if (params.transferToValue) parts.push(`transferTo: ${params.transferToValue}`);
          if (params.messageBody) parts.push(`message: ${params.messageBody}`);
          if (params.workflowId) parts.push(`workflowId: ${params.workflowId}`);
          if (params.calendarId) parts.push(`calendarId: ${params.calendarId}`);
          if (params.description) parts.push(`desc: ${params.description}`);
          if (params.apiDetails?.url) parts.push(`url: ${params.apiDetails.url}`);
          return parts.join(' | ');
        }).join(' ;; ')
      : '';

    const translation = log.translation?.transcript || '';
    return [
      escapeCsv(log.id || log._id),
      escapeCsv(log.contactId || ''),
      escapeCsv(log.agentId || ''),
      escapeCsv(log.fromNumber || ''),
      escapeCsv(log.callType || ''),
      escapeCsv(log.callStatus || ''),
      escapeCsv(log.duration != null ? log.duration + ' sec' : ''),
      escapeCsv(log.summary || ''),
      escapeCsv(formatDate(log.createdAt)),
      escapeCsv(log.trialCall ? 'Yes' : 'No'),
      escapeCsv(log.workflowId || ''),
      escapeCsv(log.messageId || ''),
      escapeCsv(extractedData),
      escapeCsv(actions),
      escapeCsv(log.transcript || ''),
      escapeCsv(translation)
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert live chat messages to CSV format
 */
function specialMessagesToCSV(messages, includeHeader = true) {
  const header = includeHeader
    ? 'Date,ConversationID,ContactID,MessageType,Direction,Status,From,To,Message,Attachments,Source\n'
    : '';

  const rows = messages.map(msg => {
    const direction = msg.direction || 'outbound';
    return [
      escapeCsv(formatDate(msg.dateAdded)),
      escapeCsv(msg.conversationId || ''),
      escapeCsv(msg.contactId || ''),
      escapeCsv(msg.messageType || msg.type || ''),
      escapeCsv(direction),
      escapeCsv(msg.status || ''),
      escapeCsv(msg.meta?.email?.from || msg.from || ''),
      escapeCsv(msg.meta?.email?.to?.join('; ') || msg.to || msg.phone || ''),
      escapeCsv(msg.body || msg.message || ''),
      escapeCsv((msg.attachments || []).map(a => a.url || a).join('; ')),
      escapeCsv(msg.source || '')
    ].join(',');
  }).join('\n');

  return header + rows + (rows.length > 0 ? '\n' : '');
}

/**
 * Convert to JSON format
 */
function toJSON(data, exportType, isFirst, isLast) {
  if (isFirst && isLast) {
    // Single batch - return complete JSON
    return JSON.stringify({
      [exportType]: data,
      exportedAt: new Date().toISOString(),
      totalCount: data.length
    }, null, 2);
  } else if (isFirst) {
    // First batch - open JSON array
    return `{"${exportType}":[` + data.map(d => JSON.stringify(d)).join(',');
  } else if (isLast) {
    // Last batch - close JSON array
    const items = data.length > 0 ? ',' + data.map(d => JSON.stringify(d)).join(',') : '';
    return items + `],"exportedAt":"${new Date().toISOString()}"}`;
  } else {
    // Middle batch - just data with leading comma
    return ',' + data.map(d => JSON.stringify(d)).join(',');
  }
}

/**
 * Update job progress in database
 */
async function updateJob(db, jobId, updates) {
  await db.collection('exportjobs').updateOne(
    { _id: new ObjectId(jobId) },
    {
      $set: {
        ...updates,
        lastProcessedAt: new Date()
      }
    }
  );
}

/**
 * Send email notification with download link using Brevo API
 */
async function sendEmail(email, downloadUrl, jobDetails) {
  if (!BREVO_API_KEY) {
    console.log('BREVO_API_KEY not configured, skipping email notification');
    return false;
  }

  try {
    const emailData = {
      sender: {
        name: EMAIL_FROM_NAME,
        email: EMAIL_FROM_ADDRESS
      },
      to: [{ email: email }],
      subject: `Your ${
        jobDetails.exportType === 'conversations' ? 'Conversations' :
        jobDetails.exportType === 'notes' ? 'Notes' :
        jobDetails.exportType === 'tasks' ? 'Tasks' :
        jobDetails.exportType === 'opportunities' ? 'Opportunities' :
        jobDetails.exportType === 'formSubmissions' ? 'Form Submissions' :
        jobDetails.exportType === 'links' ? 'Links' :
        jobDetails.exportType === 'socialPosts' ? 'Social Posts' :
        jobDetails.exportType === 'callLogs' ? 'Call Logs' :
        jobDetails.exportType === 'templates' ? 'Templates' :
        jobDetails.exportType === 'specialTabMessages' ? 'Special Messages' : 'Messages'
      } Export is Ready`,
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10B981;">Your Export is Ready!</h2>
          <p>Your ${jobDetails.exportType} export has been completed successfully.</p>

          <div style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Export Details:</strong></p>
            <ul style="margin: 10px 0;">
              <li>Type: ${jobDetails.exportType}</li>
              <li>Format: ${jobDetails.format.toUpperCase()}</li>
              <li>Total Items: ${jobDetails.totalItems.toLocaleString()}</li>
            </ul>
          </div>

          <p>
            <a href="${downloadUrl}"
               style="display: inline-block; background: #10B981; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; font-weight: bold;">
              Download Export
            </a>
          </p>

          <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
            This download link will expire in 7 days.
          </p>

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px;">
            This email was sent by VaultSuite. If you didn't request this export, please ignore this email.
          </p>
        </div>
      `
    };

    const response = await axios.post(BREVO_API_URL, emailData, {
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      }
    });

    console.log('Email sent successfully to:', email, 'MessageId:', response.data?.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error.response?.data || error.message);
    return false;
  }
}


/**
 * Extract exportJobId from event (handles both normal and durable execution formats)
 */
function extractExportJobId(event) {
  // Direct invocation format
  if (event.exportJobId) {
    return event.exportJobId;
  }

  // Durable execution format - payload is nested
  if (event.InitialExecutionState?.Operations?.[0]?.ExecutionDetails?.InputPayload) {
    try {
      const payload = JSON.parse(event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload);
      return payload.exportJobId;
    } catch (e) {
      console.error('Failed to parse durable execution payload:', e.message);
    }
  }

  return undefined;
}

/**
 * Main Lambda handler with batch processing
 */
exports.handler = async (event, context) => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));

  const exportJobId = extractExportJobId(event);

  // Logger with job ID prefix for easy tracing
  const log = (msg, data = null) => {
    const prefix = `[Job:${exportJobId}]`;
    if (data) {
      console.log(prefix, msg, JSON.stringify(data));
    } else {
      console.log(prefix, msg);
    }
  };

  const logError = (msg, data = null) => {
    const prefix = `[Job:${exportJobId}]`;
    if (data) {
      console.error(prefix, msg, JSON.stringify(data));
    } else {
      console.error(prefix, msg);
    }
  };

  log('Lambda started');

  if (!exportJobId) {
    console.error('No exportJobId found in event');
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing exportJobId' }) };
  }

  const db = await getDb();

  // Load job from database
  const job = await db.collection('exportjobs').findOne({
    _id: new ObjectId(exportJobId)
  });

  if (!job) {
    logError('Job not found');
    return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
  }

  log('Job loaded', { status: job.status, processedItems: job.processedItems, totalItems: job.totalItems, cursor: job.cursor });

  if (job.status === 'completed') {
    log('Job already completed, skipping');
    return { statusCode: 200, body: JSON.stringify({ message: 'Already completed' }) };
  }

  if (job.status === 'failed' && job.retryCount >= job.maxRetries) {
    log('Job failed and max retries exceeded');
    return { statusCode: 400, body: JSON.stringify({ error: 'Max retries exceeded' }) };
  }

  // Fetch OAuth token from oauthtokens collection
  const oauthToken = await db.collection('oauthtokens').findOne({
    locationId: job.locationId,
    tokenType: 'location',
    isActive: true,
  });

  log('OAuth token found for location:', job.locationId);

  if (!oauthToken || !oauthToken.refreshToken) {
    logError('No valid OAuth token found for location:', job.locationId);
    await updateJob(db, exportJobId, {
      status: 'failed',
      errorMessage: 'No valid OAuth token found. Please reconnect your account.'
    });
    return { statusCode: 401, body: JSON.stringify({ error: 'No valid OAuth token found' }) };
  }

  // Token state from OAuthToken collection
  let accessToken = oauthToken.accessToken;
  let refreshToken = oauthToken.refreshToken;

  /**
   * Refresh token and update OAuthToken collection
   * IMPORTANT: Re-reads token from DB to avoid race conditions with concurrent requests
   * Refresh tokens are one-time use - if another process refreshed first, we use their result
   */
  async function refreshAndUpdateToken() {
    log('Refreshing access token...');

    // CRITICAL: Re-read latest token from DB to avoid race condition
    // Another Lambda or API request might have already refreshed it
    const latestToken = await db.collection('oauthtokens').findOne({ _id: oauthToken._id });
    log('Checking latest token from DB for refresh');

    if (!latestToken) {
      throw new Error('OAuth token not found in database');
    }

    if (latestToken.expiresAt > new Date(Date.now() + 23 * 60 * 60 * 1000)) {
      // Token expires in more than 23 hours, meaning it was just refreshed
      log('Token was recently refreshed by another process, using latest');
      accessToken = latestToken.accessToken;
      refreshToken = latestToken.refreshToken;
      return accessToken;
    }

    // Use the latest refresh token from DB, not our local copy
    const currentRefreshToken = latestToken.refreshToken;

    try {
      const tokenData = await refreshAccessToken(currentRefreshToken);
      accessToken = tokenData.accessToken;
      refreshToken = tokenData.refreshToken;

      // Update tokens in OAuthToken collection (single source of truth)
      await db.collection('oauthtokens').updateOne(
        { _id: oauthToken._id },
        {
          $set: {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000) // 24 hours
          }
        }
      );
      log('Tokens refreshed and saved');
      return accessToken;

    } catch (refreshError) {
      // Handle "invalid_grant" - refresh token was already used by another process
      if (refreshError.response?.data?.error === 'invalid_grant') {
        log('Refresh token already used, fetching latest from DB...');

        // Re-fetch token - another process should have updated it
        const updatedToken = await db.collection('oauthtokens').findOne({ _id: oauthToken._id });

        if (updatedToken && updatedToken.accessToken !== latestToken.accessToken) {
          // Another process did refresh successfully, use their tokens
          accessToken = updatedToken.accessToken;
          refreshToken = updatedToken.refreshToken;
          log('Using token refreshed by another process');
          return accessToken;
        }
      }

      // Re-throw if we can't recover
      throw refreshError;
    }
  }

  try {

    // Initialize or get S3 multipart upload
    let uploadId = job.s3Upload?.uploadId;
    let parts = job.s3Upload?.parts || [];
    const s3Key = job.s3Upload?.key || `exports/${job.companyId}/${job.locationId}/${exportJobId}.${job.format}`;

    // Generate filename based on export type and channel filter
    const channelFilter = job.filters?.channel || '';
    const channelPrefix = channelFilter ? `${channelFilter.toLowerCase()}_` : '';
    const exportFilename = `${channelPrefix}${job.exportType}_export.${job.format}`;

    if (!uploadId) {
      // Start new multipart upload
      log('Starting S3 multipart upload...');
      const multipart = await s3.send(new CreateMultipartUploadCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        ContentType: job.format === 'json' ? 'application/json' : 'text/csv',
        ContentDisposition: `attachment; filename="${exportFilename}"`
      }));

      uploadId = multipart.UploadId;
      log('Multipart upload started', { uploadId });

      // Save to DB
      await updateJob(db, exportJobId, {
        's3Upload.uploadId': uploadId,
        's3Upload.bucket': S3_BUCKET,
        's3Upload.key': s3Key,
        's3Upload.parts': [],
        status: 'processing',
        startedAt: job.startedAt || new Date()
      });
    }

    // Fetch batch of records
    let cursor = job.cursor;
    let skip = job.exportType === 'conversations' ? (job.processedItems || 0) : 0;
    let records = [];
    let recordsFetched = 0;
    let hasMoreData = true;

    log('Starting batch', { cursor, skip, alreadyProcessed: job.processedItems || 0 });

    if (job.exportType === 'notes') {
      if (job.filters?.contactId) {
        // === NOTES: Single contact ===
        let items;
        try {
          items = await fetchNotesForContact(job.filters.contactId, accessToken);
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            await refreshAndUpdateToken();
            items = await fetchNotesForContact(job.filters.contactId, accessToken);
          } else { throw fetchError; }
        }
        const singleName = (job.filters.contactNames || {})[job.filters.contactId] || '';
        const singleMeta = (job.filters.contactsMeta || {})[job.filters.contactId] || {};
        items.forEach(item => {
          item.contactId = job.filters.contactId;
          item.contactName = singleName;
          item.contactEmail = singleMeta.email || '';
          item.contactPhone = singleMeta.phone || '';
        });
        records.push(...items);
        hasMoreData = false;
        cursor = null;
      } else if (job.filters?.contactIds?.length > 0) {
        // === NOTES: Multiple contacts — process 50 per Lambda invocation ===
        const CONTACTS_PER_BATCH = 50;
        const allContactIds = job.filters.contactIds;
        const startIndex = cursor ? parseInt(cursor) : 0;
        const endIndex = Math.min(startIndex + CONTACTS_PER_BATCH, allContactIds.length);
        const batchContactIds = allContactIds.slice(startIndex, endIndex);

        log('Notes multi-contact batch starting', { totalContactIds: allContactIds.length, startIndex, endIndex, batchSize: batchContactIds.length });

        let processedCount = 0;
        let skippedCount = 0;
        for (const cId of batchContactIds) {
          if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) { hasMoreData = true; break; }
          let items;
          try {
            items = await fetchNotesForContact(cId, accessToken);
          } catch (fetchError) {
            if (fetchError.response?.status === 401) {
              await refreshAndUpdateToken();
              try {
                items = await fetchNotesForContact(cId, accessToken);
              } catch (retryError) {
                log('Failed to fetch notes after token refresh, skipping contact', { contactId: cId, error: retryError.message });
                skippedCount++;
                continue;
              }
            } else if (fetchError.response?.status === 429) {
              // Rate limited — wait and retry up to 3 times
              let retryItems = null;
              for (let r = 0; r < 3; r++) {
                await sleep(2000 * (r + 1));
                try {
                  retryItems = await fetchNotesForContact(cId, accessToken);
                  break;
                } catch (retryErr) {
                  if (r === 2) log('Rate limit retry exhausted, skipping contact', { contactId: cId });
                }
              }
              if (!retryItems) { skippedCount++; continue; }
              items = retryItems;
            } else {
              log('Failed to fetch notes, skipping contact', { contactId: cId, status: fetchError.response?.status, error: fetchError.message });
              skippedCount++;
              continue;
            }
          }
          const cName = (job.filters.contactNames || {})[cId] || '';
          const cMeta = (job.filters.contactsMeta || {})[cId] || {};
          items.forEach(item => {
            item.contactId = cId;
            item.contactName = cName;
            item.contactEmail = cMeta.email || '';
            item.contactPhone = cMeta.phone || '';
          });
          records.push(...items);
          processedCount++;
          await sleep(150);
        }

        // Check if more contacts remain
        if (endIndex < allContactIds.length) {
          hasMoreData = true;
          cursor = String(endIndex);
        } else {
          hasMoreData = false;
          cursor = null;
        }
        log('Notes multi-contact batch done', { totalContactIds: allContactIds.length, startIndex, endIndex, processed: processedCount, skipped: skippedCount, notesFound: records.length, hasMore: hasMoreData });
      } else {
        // No contactId or contactIds — should not happen (backend resolves tags to contactIds)
        log('Notes export with no contacts — skipping');
        hasMoreData = false;
        cursor = null;
      }

    } else if (job.exportType === 'tasks') {
      // === TASKS: Location-level skip-based API (limit 1000 per page) ===
      let skip = cursor ? parseInt(cursor) : 0;

      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) { break; }

        let pageResult;
        try {
          pageResult = await fetchTasksPage(job.locationId, accessToken, skip, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            await refreshAndUpdateToken();
            pageResult = await fetchTasksPage(job.locationId, accessToken, skip, job.filters || {});
          } else { throw fetchError; }
        }

        // Enrich tasks with contactName from contactNames map if available
        const contactNamesMap = job.filters?.contactNames || {};
        pageResult.data.forEach(task => {
          if (!task.contactName && task.contactId) {
            task.contactName = contactNamesMap[task.contactId] || '';
          }
        });

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        skip += pageResult.data.length;

        log('Fetched tasks batch', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, skip, hasMore: pageResult.hasMore });

        if (!pageResult.hasMore) { hasMoreData = false; }
        if (hasMoreData && recordsFetched < BATCH_SIZE) { await sleep(100); }
      }

      cursor = hasMoreData ? String(skip) : null;

    } else if (job.exportType === 'opportunities') {
      // === OPPORTUNITIES: Page-based pagination ===
      let page = cursor ? parseInt(cursor) : 1;

      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        const remaining = context.getRemainingTimeInMillis();
        if (remaining < TIMEOUT_BUFFER_MS) {
          log('Approaching timeout, saving progress', { remainingMs: remaining });
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchOpportunitiesPage(job.locationId, accessToken, page, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchOpportunitiesPage(job.locationId, accessToken, page, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        page++;

        log('Fetched opportunities page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, page, hasMore: pageResult.hasMore });

        if (pageResult.data.length < API_PAGE_SIZE) {
          hasMoreData = false;
        }

        if (hasMoreData && recordsFetched < BATCH_SIZE) {
          await sleep(100);
        }
      }

      // Store current page as cursor for next Lambda invocation
      cursor = hasMoreData ? String(page) : null;

    } else if (job.exportType === 'formSubmissions') {
      // === FORM SUBMISSIONS: Page-based pagination ===
      let page = cursor ? parseInt(cursor) : 1;

      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        const remaining = context.getRemainingTimeInMillis();
        if (remaining < TIMEOUT_BUFFER_MS) {
          log('Approaching timeout, saving progress', { remainingMs: remaining });
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchFormSubmissionsPage(job.locationId, accessToken, page, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchFormSubmissionsPage(job.locationId, accessToken, page, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        page++;

        log('Fetched form submissions page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, page });

        if (pageResult.data.length < API_PAGE_SIZE) {
          hasMoreData = false;
        }

        if (hasMoreData && recordsFetched < BATCH_SIZE) {
          await sleep(100);
        }
      }

      cursor = hasMoreData ? String(page) : null;

    } else if (job.exportType === 'links') {
      // === LINKS: Page-based pagination via /links/search (limit 1000) ===
      let currentSkip = cursor ? parseInt(cursor) : 0;
      let hasMoreData_inner = true;

      while (hasMoreData_inner && records.length < BATCH_SIZE) {
        if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) {
          hasMoreData = true;
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchLinksPage(job.locationId, accessToken, currentSkip, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchLinksPage(job.locationId, accessToken, currentSkip, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        currentSkip += pageResult.data.length;

        if (!pageResult.hasMore) {
          hasMoreData_inner = false;
          hasMoreData = false;
        } else if (records.length >= BATCH_SIZE) {
          hasMoreData = true;
        }

        if (hasMoreData_inner && records.length < BATCH_SIZE) {
          await sleep(100);
        }
      }

      cursor = hasMoreData ? String(currentSkip) : null;

      log('Fetched links batch', { fetched: records.length, skip: currentSkip });

    } else if (job.exportType === 'socialPosts') {
      // === SOCIAL POSTS: Skip-based pagination ===
      let currentSkip = cursor ? parseInt(cursor) : 0;

      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        const remaining = context.getRemainingTimeInMillis();
        if (remaining < TIMEOUT_BUFFER_MS) {
          log('Approaching timeout, saving progress', { remainingMs: remaining });
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchSocialPostsPage(job.locationId, accessToken, currentSkip, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchSocialPostsPage(job.locationId, accessToken, currentSkip, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        currentSkip += pageResult.data.length;

        log('Fetched social posts page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, skip: currentSkip });

        if (pageResult.data.length < API_PAGE_SIZE) {
          hasMoreData = false;
        }

        if (hasMoreData && recordsFetched < BATCH_SIZE) {
          await sleep(100);
        }
      }

      cursor = hasMoreData ? String(currentSkip) : null;

    } else if (job.exportType === 'callLogs') {
      // === CALL LOGS: Page-based pagination ===
      let page = cursor ? parseInt(cursor) : 1;

      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        const remaining = context.getRemainingTimeInMillis();
        if (remaining < TIMEOUT_BUFFER_MS) {
          log('Approaching timeout, saving progress', { remainingMs: remaining });
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchCallLogsPage(job.locationId, accessToken, page, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchCallLogsPage(job.locationId, accessToken, page, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        page++;

        log('Fetched call logs page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, page });

        if (pageResult.data.length < API_CALL_LOGS_PAGE_SIZE) {
          hasMoreData = false;
        }

        if (hasMoreData && recordsFetched < BATCH_SIZE) {
          await sleep(100);
        }
      }

      cursor = hasMoreData ? String(page) : null;

    } else if (job.exportType === 'templates') {
      // === TEMPLATES: Skip-based pagination (limit 100) ===
      let currentSkip = cursor ? parseInt(cursor) : 0;
      let hasMoreData_inner = true;

      while (hasMoreData_inner && records.length < BATCH_SIZE) {
        if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) {
          hasMoreData = true;
          break;
        }

        let pageResult;
        try {
          pageResult = await fetchTemplatesPage(job.locationId, accessToken, currentSkip, job.filters || {});
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();
            pageResult = await fetchTemplatesPage(job.locationId, accessToken, currentSkip, job.filters || {});
          } else {
            throw fetchError;
          }
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;
        currentSkip += pageResult.data.length;

        log('Fetched templates page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, skip: currentSkip });

        if (!pageResult.hasMore) {
          hasMoreData_inner = false;
          hasMoreData = false;
        } else if (records.length >= BATCH_SIZE) {
          hasMoreData = true;
        }

        if (hasMoreData_inner && records.length < BATCH_SIZE) {
          await sleep(100);
        }
      }

      cursor = hasMoreData ? String(currentSkip) : null;

    } else if (job.exportType === 'specialTabMessages') {
      // === SPECIAL MESSAGES: Read pre-fetched messages from specialexports collection ===
      // Try by exportJobId first, then fall back to latest ready export for this location
      let specialExport = await db.collection('specialexports').findOne({
        exportJobId: new ObjectId(exportJobId),
        status: 'ready'
      });
      if (!specialExport) {
        specialExport = await db.collection('specialexports').findOne({
          locationId: job.locationId,
          status: 'ready'
        }, { sort: { createdAt: -1 } });
      }

      if (!specialExport || !specialExport.messages || specialExport.messages.length === 0) {
        throw new Error('No pre-fetched messages found in specialexports for this job');
      }

      // Read messages in batches from the pre-fetched collection
      const startIdx = job.processedItems || 0;
      const endIdx = Math.min(startIdx + BATCH_SIZE, specialExport.messages.length);
      records = specialExport.messages.slice(startIdx, endIdx);
      recordsFetched = records.length;
      hasMoreData = endIdx < specialExport.messages.length;
      cursor = hasMoreData ? String(endIdx) : null;

      log('Special Messages batch from specialexports', {
        startIdx, endIdx, batchSize: records.length,
        totalStored: specialExport.messages.length, hasMoreData
      });

    } else {
      // === CONVERSATIONS/MESSAGES: Standard pagination ===
      while (recordsFetched < BATCH_SIZE && hasMoreData) {
        // Check if approaching timeout
        const remaining = context.getRemainingTimeInMillis();
        if (remaining < TIMEOUT_BUFFER_MS) {
          log('Approaching timeout, saving progress', { remainingMs: remaining });
          break;
        }

        // Check if we've already fetched all items (avoid extra API call when count matches exactly)
        if (job.totalItems > 0) {
          const totalProcessed = (job.processedItems || 0) + recordsFetched;
          if (totalProcessed >= job.totalItems) {
            log('Reached totalItems count, stopping fetch', { totalProcessed, totalItems: job.totalItems });
            hasMoreData = false;
            cursor = null;
            break;
          }
        }

        // Fetch page based on export type, with 401 retry
        let pageResult;
        try {
          if (job.exportType === 'conversations') {
            pageResult = await fetchConversationsPage(job.locationId, accessToken, job.filters || {}, skip);
          } else {
            pageResult = await fetchMessagesPage(job.locationId, accessToken, job.filters || {}, cursor);
          }
        } catch (fetchError) {
          if (fetchError.response?.status === 401) {
            log('Got 401, refreshing token and retrying...');
            await refreshAndUpdateToken();

            if (job.exportType === 'conversations') {
              pageResult = await fetchConversationsPage(job.locationId, accessToken, job.filters || {}, skip);
            } else {
              pageResult = await fetchMessagesPage(job.locationId, accessToken, job.filters || {}, cursor);
            }
          } else if (fetchError.response?.status === 400 && cursor) {
            // 400 likely means expired/invalid cursor — retry without cursor
            log('Got 400 with cursor, retrying without cursor (fresh start)', { cursor });
            cursor = null;
            if (job.exportType === 'conversations') {
              pageResult = await fetchConversationsPage(job.locationId, accessToken, job.filters || {}, 0);
            } else {
              pageResult = await fetchMessagesPage(job.locationId, accessToken, job.filters || {}, null);
            }
          } else {
            throw fetchError;
          }
        }

        if (job.exportType === 'conversations') {
          hasMoreData = pageResult.hasMore;
          skip += pageResult.data.length;
        } else {
          cursor = pageResult.nextCursor;
          hasMoreData = !!cursor;
        }

        records.push(...pageResult.data);
        recordsFetched += pageResult.data.length;

        log('Fetched page', { pageRecords: pageResult.data.length, batchTotal: recordsFetched, cursor, hasMoreData });

        // No more data available - use correct page size for each type
        const pageSize = job.exportType === 'conversations' ? API_PAGE_SIZE : API_MESSAGES_PAGE_SIZE;
        if (pageResult.data.length < pageSize) {
          hasMoreData = false;
          cursor = null;
        }

        // Rate limiting (GHL: 100 req/10 sec)
        if (hasMoreData && recordsFetched < BATCH_SIZE) {
          await sleep(100);
        }
      }
    }

    log('Batch complete', { processedItems: job.processedItems,  batchRecords: records.length, cursor: cursor, hasMore: hasMoreData || !!cursor });

    // Convert to format and upload
    const hasPendingBuffer = !!(job.s3Upload?.pendingBuffer);
    const isFirstContent = parts.length === 0 && !hasPendingBuffer;
    const isLastPart = !hasMoreData && !cursor;
    let useSimpleUpload = false;  // Flag to skip multipart finalization

    if (records.length > 0 || (isFirstContent && isLastPart && records.length === 0)) {
      // Handle empty export case
      if (records.length === 0) {
        log('Empty export, creating empty file');
      }
      let content;
      if (job.format === 'json') {
        content = toJSON(records, job.exportType, isFirstContent, isLastPart);
      } else if (job.exportType === 'conversations') {
        content = conversationsToCSV(records, isFirstContent);
      } else if (job.exportType === 'notes') {
        content = notesToCSV(records, isFirstContent);
      } else if (job.exportType === 'tasks') {
        content = tasksToCSV(records, isFirstContent);
      } else if (job.exportType === 'opportunities') {
        content = opportunitiesToCSV(records, isFirstContent);
      } else if (job.exportType === 'formSubmissions') {
        content = formSubmissionsToCSV(records, isFirstContent);
      } else if (job.exportType === 'links') {
        content = linksToCSV(records, isFirstContent);
      } else if (job.exportType === 'socialPosts') {
        content = socialPostsToCSV(records, isFirstContent);
      } else if (job.exportType === 'callLogs') {
        content = callLogsToCSV(records, isFirstContent);
      } else if (job.exportType === 'templates') {
        content = templatesToCSV(records, isFirstContent);
      } else if (job.exportType === 'specialTabMessages') {
        content = specialMessagesToCSV(records, isFirstContent);
      } else {
        content = messagesToCSV(records, isFirstContent, job.filters?.channel || '');
      }

      const contentSize = Buffer.byteLength(content);

      // If truly a single-batch export (no buffer, no parts), use putObject directly
      // This avoids S3 multipart upload issues with small files (< 5MB)
      if (isFirstContent && isLastPart && !hasPendingBuffer) {
        log('Single batch export, using putObject directly', { contentSize });

        // Abort the multipart upload we started (if any)
        if (uploadId) {
          try {
            await s3.send(new AbortMultipartUploadCommand({
              Bucket: S3_BUCKET,
              Key: s3Key,
              UploadId: uploadId
            }));
            log('Aborted unused multipart upload');
          } catch (abortErr) {
            // Ignore abort errors
            log('Could not abort multipart upload (may not exist yet)', { error: abortErr.message });
          }
        }

        // Upload directly with putObject
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: content,
          ContentType: job.format === 'json' ? 'application/json' : 'text/csv',
          ContentDisposition: `attachment; filename="${exportFilename}"`
        }));

        log('File uploaded with putObject');
        useSimpleUpload = true;

      } else {
        // Multi-batch: use multipart upload
        // S3 requires each part (except last) to be >= 5MB
        const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB

        // Accumulate content with any pending buffer from previous batches
        const pendingBuffer = job.s3Upload?.pendingBuffer || '';
        const accumulated = pendingBuffer + content;
        const accumulatedSize = Buffer.byteLength(accumulated);

        if (!isLastPart && accumulatedSize < MIN_PART_SIZE) {
          // Not enough data yet and more batches coming - buffer it
          log('Buffering content for next batch', { accumulatedSize, minRequired: MIN_PART_SIZE });
          await updateJob(db, exportJobId, {
            's3Upload.pendingBuffer': accumulated
          });
        } else if (isLastPart && parts.length === 0) {
          // All data fits in buffer + this batch, and no parts uploaded yet
          // Use putObject instead of multipart (total data < 5MB)
          log('Total export under 5MB, using putObject', { accumulatedSize });

          // Abort the multipart upload
          if (uploadId) {
            try {
              await s3.send(new AbortMultipartUploadCommand({
                Bucket: S3_BUCKET,
                Key: s3Key,
                UploadId: uploadId
              }));
            } catch (abortErr) {
              log('Could not abort multipart upload', { error: abortErr.message });
            }
          }

          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: accumulated,
            ContentType: job.format === 'json' ? 'application/json' : 'text/csv',
            ContentDisposition: `attachment; filename="${exportFilename}"`
          }));

          log('File uploaded with putObject (buffered)');
          useSimpleUpload = true;

          // Clear the pending buffer
          await updateJob(db, exportJobId, {
            's3Upload.pendingBuffer': ''
          });
        } else {
          // Enough data or last part with existing parts - upload as multipart part
          const partNumber = parts.length + 1;

          const uploadResult = await s3.send(new UploadPartCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: accumulated
          }));

          parts.push({
            partNumber,
            etag: uploadResult.ETag,
            size: accumulatedSize
          });

          log('Uploaded part', { partNumber, size: accumulatedSize });

          // Clear the pending buffer
          await updateJob(db, exportJobId, {
            's3Upload.pendingBuffer': ''
          });
        }
      }
    }

    // Update progress in DB
    const processedItems = (job.processedItems || 0) + records.length;
    const currentBatch = (job.currentBatch || 0) + 1;

    // Update totalItems if processedItems exceeds it (initial count was an estimate)
    const totalItems = job.totalItems;

    log('Updating progress', { processedItems, totalItems, currentBatch, prevProcessed: job.processedItems || 0, recordsThisBatch: records.length });

    await updateJob(db, exportJobId, {
      cursor: cursor,
      processedItems,
      totalItems,
      currentBatch,
      's3Upload.parts': parts
    });

    // Check if more data exists
    if (hasMoreData || cursor) {
      // More data - invoke next Lambda
      log('Invoking next Lambda', { processedItems, totalItems, cursor, hasMoreData });

      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',  // Async
        Qualifier: '$LATEST',     // Required for durable functions
        Payload: JSON.stringify({ exportJobId })
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Batch complete, next Lambda invoked',
          processedItems,
          batch: currentBatch
        })
      };

    } else {
      // No more data - finalize
      log('All data fetched, finalizing...');

      // Flush any remaining pending buffer as the final part
      // Re-read from DB in case buffer was updated during this invocation
      const freshJob = await db.collection('exportjobs').findOne({ _id: new ObjectId(exportJobId) });
      const remainingBuffer = freshJob?.s3Upload?.pendingBuffer || '';
      if (!useSimpleUpload && remainingBuffer) {
        const partNumber = parts.length + 1;
        const uploadResult = await s3.send(new UploadPartCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: remainingBuffer
        }));
        parts.push({
          partNumber,
          etag: uploadResult.ETag,
          size: Buffer.byteLength(remainingBuffer)
        });
        log('Flushed remaining buffer as final part', { partNumber, size: Buffer.byteLength(remainingBuffer) });
      }

      // Complete multipart upload (only if we didn't use simple putObject)
      if (!useSimpleUpload && parts.length > 0) {
        await s3.send(new CompleteMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(p => ({
              PartNumber: p.partNumber,
              ETag: p.etag
            }))
          }
        }));

        log('Multipart upload completed');
      } else if (useSimpleUpload) {
        log('Skipping multipart completion (used putObject)');
      }

      // Generate signed download URL (7 days)
      const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key
      }), { expiresIn: 7 * 24 * 60 * 60 });

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Update job as completed
      await updateJob(db, exportJobId, {
        status: 'completed',
        s3Key,
        s3Bucket: S3_BUCKET,
        downloadUrl,
        downloadUrlExpiresAt: expiresAt,
        completedAt: new Date(),
        totalBatches: currentBatch
      });

      // Clean up the pre-fetched messages for specialTabMessages — the CSV is now on S3, we don't need to hold the raw messages.
      // TTL index is the safety net if this delete fails.
      if (job.exportType === 'specialTabMessages') {
        try {
          const { deletedCount } = await db.collection('specialexports').deleteOne({
            exportJobId: new ObjectId(exportJobId)
          });
          log('SpecialExport cleanup', { deletedCount });
        } catch (cleanupErr) {
          log('SpecialExport cleanup failed (TTL will handle it)', { error: cleanupErr.message });
        }
      }

      // Send email notification
      let emailSent = false;
      if (job.notificationEmail) {
        emailSent = await sendEmail(job.notificationEmail, downloadUrl, {
          exportType: job.exportType,
          format: job.format,
          totalItems: processedItems
        });

        await updateJob(db, exportJobId, { emailSent });
      }

      log('Export completed', { processedItems, totalBatches: currentBatch, emailSent });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Export completed',
          processedItems,
          totalBatches: currentBatch,
          downloadUrl,
          emailSent
        })
      };
    }

  } catch (error) {
    logError('Export batch failed', { error: error.message, stack: error.stack });

    const updateFields = {};

    // If 400 error, reset cursor so retry starts fresh (cursor likely expired)
    if (error.response?.status === 400) {
      updateFields.cursor = null;
      log('Resetting cursor due to 400 error');
    }

    // Increment retry count
    const retryCount = (job.retryCount || 0) + 1;
    updateFields.retryCount = retryCount;

    if (retryCount < (job.maxRetries || 3)) {
      // Retry - invoke self again
      log('Retrying...', { attempt: retryCount + 1, maxRetries: job.maxRetries || 3 });

      await updateJob(db, exportJobId, updateFields);

      // Wait a bit before retry
      await sleep(5000);

      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Qualifier: '$LATEST',
        Payload: JSON.stringify({ exportJobId })
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: 'Error occurred, retrying...',
          retryCount,
          error: error.message
        })
      };

    } else {
      // Max retries exceeded - abort multipart upload and fail
      logError('Max retries exceeded, failing job');

      // Try to abort multipart upload
      if (job.s3Upload?.uploadId) {
        try {
          await s3.send(new AbortMultipartUploadCommand({
            Bucket: S3_BUCKET,
            Key: job.s3Upload.key,
            UploadId: job.s3Upload.uploadId
          }));
          log('Multipart upload aborted');
        } catch (abortError) {
          logError('Failed to abort multipart upload', { error: abortError.message });
        }
      }

      await updateJob(db, exportJobId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date()
      });

      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
  }
};
