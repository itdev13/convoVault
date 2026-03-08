const AWS = require('aws-sdk');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');

// Initialize AWS services
const s3 = new AWS.S3();
const lambda = new AWS.Lambda();

// Environment variables
const S3_BUCKET = process.env.S3_BUCKET || 'convo-vault-exports';
const MONGODB_URI = process.env.MONGODB_URI;
const GHL_API_URL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
const GHL_OAUTH_URL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;

// Post-export billing constants (notes/tasks all-contacts)
const GHL_APP_ID = process.env.GHL_APP_ID || '694f93f8a6babf0c821b1356';
const NOTES_TASKS_METER_ID = '69864aed1265653fdd7c0620';
const NOTES_TASKS_UNIT_PRICE = 0.002;
const INTERNAL_TESTING_COMPANY_IDS = ['PG9VJ27QFRumQrOGB2Ee', '7IlT9P1bafOCnq2JV00t'];

// Brevo Email configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_FROM_NAME = 'VaultSuite';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';

// Batch processing configuration
const BATCH_SIZE = 10000;           // Records per Lambda invocation
const API_PAGE_SIZE = 100;          // Records per GHL API call
const API_MESSAGES_PAGE_SIZE = 500;
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
  const params = {
    locationId,
    limit: API_MESSAGES_PAGE_SIZE,
    ...filters
  };

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
 * Fetch a page of contacts for a location
 */
async function fetchContactsPage(locationId, accessToken, startAfterId) {
  const params = { locationId, limit: 100 };
  if (startAfterId) params.startAfterId = startAfterId;

  const response = await axios.get(`${GHL_API_URL}/contacts/`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  return {
    contacts: response.data.contacts || [],
    meta: response.data.meta || {},
    total: response.data.meta?.total || 0
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
  const params = {
    location_id: locationId,
    limit: API_PAGE_SIZE,
    page
  };

  if (filters.pipelineId) params.pipeline_id = filters.pipelineId;
  if (filters.pipelineStageId) params.pipeline_stage_id = filters.pipelineStageId;
  if (filters.status) params.status = filters.status;
  if (filters.query) params.q = filters.query;
  if (filters.contactId) params.contact_id = filters.contactId;

  // Convert date filters
  if (filters.startDate) {
    const date = new Date(filters.startDate);
    date.setHours(0, 0, 0, 0);
    params.date = date.getTime();
  }
  if (filters.endDate) {
    const date = new Date(filters.endDate);
    date.setHours(23, 59, 59, 999);
    params.endDate = date.getTime();
  }

  const response = await axios.get(`${GHL_API_URL}/opportunities/search`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    params
  });

  const opportunities = response.data.opportunities || [];
  const total = response.data.meta?.total || response.data.total || 0;

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
    pageSize: API_PAGE_SIZE
  };

  if (filters.agentId) params.agentId = filters.agentId;
  if (filters.contactId) params.contactId = filters.contactId;
  if (filters.callType) params.callType = filters.callType;
  if (filters.actionType) params.actionType = filters.actionType;
  if (filters.sortBy) params.sortBy = filters.sortBy;
  if (filters.sort) params.sort = filters.sort;

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
    hasMore: callLogs.length === API_PAGE_SIZE
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
      header = 'Date,ConversationID,ContactID,MessageType,Direction,Status,From,To,Subject,CC,BCC,Message,Attachments,Source\n';
    } else {
      // Default for SMS, WhatsApp, Facebook, Instagram, Call, etc. - includes meta fields
      header = 'Date,ConversationID,ContactID,MessageType,Direction,Status,From,To,Message,Attachments,Source,CallDuration,CallStatus,FacebookPage,InstagramPage\n';
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
    ? 'NoteID,ContactID,ContactName,Body,BodyText,UserID,DateAdded,Relations\n'
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
    ? 'CallID,ContactID,AgentID,FromNumber,CallType,Duration,Summary,CreatedAt,TrialCall,CallActions,Transcript\n'
    : '';

  const rows = callLogs.map(log => {
    const actions = Array.isArray(log.executedCallActions)
      ? log.executedCallActions.map(a => a.actionType || a).join('; ')
      : '';
    return [
      escapeCsv(log.id || log._id),
      escapeCsv(log.contactId || ''),
      escapeCsv(log.agentId || ''),
      escapeCsv(log.fromNumber || ''),
      escapeCsv(log.callType || ''),
      escapeCsv(log.duration || ''),
      escapeCsv(log.summary || ''),
      escapeCsv(formatDate(log.createdAt)),
      escapeCsv(log.trialCall ? 'Yes' : 'No'),
      escapeCsv(actions),
      escapeCsv(log.transcript || '')
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
        jobDetails.exportType === 'templates' ? 'Templates' : 'Messages'
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
 * Charge GHL wallet after export completes (post-export billing for notes/tasks all-contacts)
 */
async function chargePostExport(db, job, actualCount, accessToken) {
  if (INTERNAL_TESTING_COMPANY_IDS.includes(job.companyId)) {
    console.log('[PostExportBilling] Internal testing company - skipping charge', { companyId: job.companyId });
    await db.collection('billingtransactions').updateOne(
      { _id: new ObjectId(job.billingTransactionId.toString()) },
      { $set: {
        status: 'tested',
        internalTesting: true,
        paymentIgnored: true,
        [`itemCounts.${job.exportType}`]: actualCount,
        'itemCounts.total': actualCount,
        'pricing.finalAmount': actualCount * NOTES_TASKS_UNIT_PRICE,
        'pricing.baseAmount': actualCount * NOTES_TASKS_UNIT_PRICE
      }}
    );
    return;
  }

  const finalAmount = actualCount * NOTES_TASKS_UNIT_PRICE;
  const transactionId = job.billingTransactionId.toString();


  const response = await axios.post(
    `${GHL_API_URL}/marketplace/billing/charges`,
    {
      companyId: job.companyId,
      meterId: NOTES_TASKS_METER_ID,
      units: actualCount,
      price: NOTES_TASKS_UNIT_PRICE,
      appId: GHL_APP_ID,
      eventId: transactionId,
      locationId: job.locationId,
      description: 'Exported Data ' + '_' + new Date().toDateString()
    },
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    }
  );

  await db.collection('billingtransactions').updateOne(
    { _id: new ObjectId(transactionId) },
    { $set: {
      status: 'charged',
      ghlChargeId: response.data?.chargeId || response.data?.id || null,
      [`itemCounts.${job.exportType}`]: actualCount,
      'itemCounts.total': actualCount,
      'pricing.finalAmount': finalAmount,
      'pricing.baseAmount': finalAmount
    }}
  );
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
      const multipart = await s3.createMultipartUpload({
        Bucket: S3_BUCKET,
        Key: s3Key,
        ContentType: job.format === 'json' ? 'application/json' : 'text/csv',
        ContentDisposition: `attachment; filename="${exportFilename}"`
      }).promise();

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
        items.forEach(item => { item.contactId = job.filters.contactId; item.contactName = singleName; });
        records.push(...items);
        hasMoreData = false;
        cursor = null;
      } else if (job.filters?.contactIds?.length > 0) {
        // === NOTES: Multiple specific contacts ===
        for (const cId of job.filters.contactIds) {
          if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) { hasMoreData = true; break; }
          let items;
          try {
            items = await fetchNotesForContact(cId, accessToken);
          } catch (fetchError) {
            if (fetchError.response?.status === 401) {
              await refreshAndUpdateToken();
              items = await fetchNotesForContact(cId, accessToken);
            } else { throw fetchError; }
          }
          const cName = (job.filters.contactNames || {})[cId] || '';
          items.forEach(item => { item.contactId = cId; item.contactName = cName; });
          records.push(...items);
          await sleep(150);
        }
        hasMoreData = false;
        cursor = null;
      } else {
        // === NOTES: All contacts — per-contact iteration ===
        let contactStartAfter = cursor;
        while (recordsFetched < BATCH_SIZE && hasMoreData) {
          if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS) { break; }
          let contactsResult;
          try {
            contactsResult = await fetchContactsPage(job.locationId, accessToken, contactStartAfter);
          } catch (fetchError) {
            if (fetchError.response?.status === 401) {
              await refreshAndUpdateToken();
              contactsResult = await fetchContactsPage(job.locationId, accessToken, contactStartAfter);
            } else { throw fetchError; }
          }
          const contacts = contactsResult.contacts;
          if (contacts.length === 0) { hasMoreData = false; break; }
          let stoppedEarly = false;
          for (const contact of contacts) {
            if (context.getRemainingTimeInMillis() < TIMEOUT_BUFFER_MS || recordsFetched >= BATCH_SIZE) { stoppedEarly = true; break; }
            let items;
            try {
              items = await fetchNotesForContact(contact.id, accessToken);
            } catch (fetchError) {
              if (fetchError.response?.status === 401) {
                await refreshAndUpdateToken();
                items = await fetchNotesForContact(contact.id, accessToken);
              } else if (fetchError.response?.status === 429) {
                await sleep(2000);
                items = await fetchNotesForContact(contact.id, accessToken);
              } else { throw fetchError; }
            }
            const contactName = contact.contactName || contact.name ||
              `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
            items.forEach(item => { item.contactId = contact.id; item.contactName = contactName; });
            records.push(...items);
            recordsFetched += items.length;
            contactStartAfter = contact.id;
            await sleep(150);
          }
          if (stoppedEarly) break;
          if (contacts.length < 100) { hasMoreData = false; }
        }
        cursor = hasMoreData ? contactStartAfter : null;
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

        if (pageResult.data.length < API_PAGE_SIZE) {
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
    const isFirstPart = parts.length === 0;
    const isLastPart = !hasMoreData && !cursor;
    let useSimpleUpload = false;  // Flag to skip multipart finalization

    if (records.length > 0 || (isFirstPart && isLastPart && records.length === 0)) {
      // Handle empty export case
      if (records.length === 0) {
        log('Empty export, creating empty file');
      }
      let content;
      if (job.format === 'json') {
        content = toJSON(records, job.exportType, isFirstPart, isLastPart);
      } else if (job.exportType === 'conversations') {
        content = conversationsToCSV(records, isFirstPart);
      } else if (job.exportType === 'notes') {
        content = notesToCSV(records, isFirstPart);
      } else if (job.exportType === 'tasks') {
        content = tasksToCSV(records, isFirstPart);
      } else if (job.exportType === 'opportunities') {
        content = opportunitiesToCSV(records, isFirstPart);
      } else if (job.exportType === 'formSubmissions') {
        content = formSubmissionsToCSV(records, isFirstPart);
      } else if (job.exportType === 'links') {
        content = linksToCSV(records, isFirstPart);
      } else if (job.exportType === 'socialPosts') {
        content = socialPostsToCSV(records, isFirstPart);
      } else if (job.exportType === 'callLogs') {
        content = callLogsToCSV(records, isFirstPart);
      } else if (job.exportType === 'templates') {
        content = templatesToCSV(records, isFirstPart);
      } else {
        content = messagesToCSV(records, isFirstPart, job.filters?.channel || '');
      }

      const contentSize = Buffer.byteLength(content);

      // If this is both first and last part (single batch export), use putObject directly
      // This avoids S3 multipart upload issues with small files (< 5MB)
      if (isFirstPart && isLastPart) {
        log('Single batch export, using putObject directly', { contentSize });

        // Abort the multipart upload we started (if any)
        if (uploadId) {
          try {
            await s3.abortMultipartUpload({
              Bucket: S3_BUCKET,
              Key: s3Key,
              UploadId: uploadId
            }).promise();
            log('Aborted unused multipart upload');
          } catch (abortErr) {
            // Ignore abort errors
            log('Could not abort multipart upload (may not exist yet)', { error: abortErr.message });
          }
        }

        // Upload directly with putObject
        await s3.putObject({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: content,
          ContentType: job.format === 'json' ? 'application/json' : 'text/csv',
          ContentDisposition: `attachment; filename="${exportFilename}"`
        }).promise();

        log('File uploaded with putObject');
        useSimpleUpload = true;

      } else {
        // Multi-batch: use multipart upload
        const partNumber = parts.length + 1;

        const uploadResult = await s3.uploadPart({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: content
        }).promise();

        parts.push({
          partNumber,
          etag: uploadResult.ETag,
          size: contentSize
        });

        log('Uploaded part', { partNumber, size: contentSize });
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

      await lambda.invoke({
        FunctionName: context.functionName,
        InvocationType: 'Event',  // Async
        Qualifier: '$LATEST',     // Required for durable functions
        Payload: JSON.stringify({ exportJobId })
      }).promise();

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

      // Complete multipart upload (only if we didn't use simple putObject)
      if (!useSimpleUpload && parts.length > 0) {
        await s3.completeMultipartUpload({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(p => ({
              PartNumber: p.partNumber,
              ETag: p.etag
            }))
          }
        }).promise();

        log('Multipart upload completed');
      } else if (useSimpleUpload) {
        log('Skipping multipart completion (used putObject)');
      }

      // Generate signed download URL (7 days)
      const downloadUrl = s3.getSignedUrl('getObject', {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Expires: 7 * 24 * 60 * 60
      });

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

      // Post-export billing: charge actual count for notes/tasks all-contacts exports
      if (job.postExportBilling && processedItems > 0) {
        try {
          await chargePostExport(db, job, processedItems, accessToken);
          log('Post-export billing completed', { qty: processedItems, amount: processedItems * NOTES_TASKS_UNIT_PRICE });
        } catch (billingError) {
          log('Post-export billing failed (export still successful)', { error: billingError.message });
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

    // Increment retry count
    const retryCount = (job.retryCount || 0) + 1;

    if (retryCount < (job.maxRetries || 3)) {
      // Retry - invoke self again
      log('Retrying...', { attempt: retryCount + 1, maxRetries: job.maxRetries || 3 });

      await updateJob(db, exportJobId, { retryCount });

      // Wait a bit before retry
      await sleep(5000);

      await lambda.invoke({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Qualifier: '$LATEST',
        Payload: JSON.stringify({ exportJobId })
      }).promise();

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
          await s3.abortMultipartUpload({
            Bucket: S3_BUCKET,
            Key: job.s3Upload.key,
            UploadId: job.s3Upload.uploadId
          }).promise();
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
