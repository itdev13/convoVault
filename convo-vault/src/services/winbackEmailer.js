const axios = require('axios');
const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM_NAME = 'ExportKit Support';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';
const CALENDAR_URL = 'https://calendar.app.google/2Z1qcGSxbvDU9e6DA';

function buildTextBody({ firstName, locationName }) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const sub = locationName
    ? `We noticed ExportKit was uninstalled from ${locationName}.`
    : 'We noticed ExportKit was just uninstalled from your sub-account.';

  return [
    greeting,
    '',
    sub,
    '',
    "Was it the pricing? If so, we can almost certainly work something out.",
    "ExportKit has volume tiers that kick in above 50k / 100k / 500k items, and we",
    "also set custom rates for high-volume accounts on a case-by-case basis.",
    '',
    "Happy to jump on a quick call if that's easier:",
    CALENDAR_URL,
    '',
    "Or just reply here — we'll come back with a number that makes sense for your volume.",
    '',
    "If it wasn't the pricing (missing feature, bug, something just didn't fit),",
    "we'd genuinely love to know. Your feedback shapes what gets built next.",
    '',
    'ExportKit Support'
  ].join('\n');
}

/**
 * Send a plain-text win-back email via Brevo. No HTML — plain text only to avoid
 * Gmail's Promotions tab. Never throws; call without await from the uninstall handler.
 */
async function sendUninstallWinBackEmail({ to, name, locationName, locationId, source }) {
  if (!to) {
    logger.info('Win-back email skipped (no installer email captured)', { locationId, source });
    return;
  }
  if (!BREVO_API_KEY) {
    logger.warn('Win-back email skipped — BREVO_API_KEY not set', { locationId });
    return;
  }
  const firstName = (name || '').trim().split(/\s+/)[0] || null;
  try {
    const response = await axios.post(BREVO_API_URL, {
      sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM_ADDRESS },
      to: [{ email: to, name: name || undefined }],
      replyTo: { email: EMAIL_FROM_ADDRESS, name: EMAIL_FROM_NAME },
      subject: 'Did something go wrong with ExportKit?',
      textContent: buildTextBody({ firstName, locationName })
      // No htmlContent — plain text only for inbox deliverability
    }, {
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      }
    });
    logger.info('✉️ Win-back email sent', { to, locationId, source, messageId: response.data?.messageId });
  } catch (err) {
    logger.warn('Win-back email failed (non-blocking):', {
      to,
      locationId,
      error: err.response?.data || err.message
    });
  }
}

module.exports = { sendUninstallWinBackEmail };
