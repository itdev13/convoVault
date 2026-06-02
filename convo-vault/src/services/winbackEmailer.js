const axios = require('axios');
const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM_NAME = 'ExportKit Support';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';
const CALENDAR_URL = 'https://calendar.app.google/2Z1qcGSxbvDU9e6DA';

function buildHtmlBody({ firstName, locationName }) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const sub = locationName
    ? `We noticed ExportKit was uninstalled from <strong>${escapeHtml(locationName)}</strong>.`
    : 'We noticed ExportKit was just uninstalled from your sub-account.';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;">
  <table cellpadding="0" cellspacing="0" width="100%" style="padding:32px 16px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" width="560" style="max-width:560px;">
        <tr><td style="padding:0 0 12px;">
          <p style="margin:0 0 12px;">${greeting}</p>
          <p style="margin:0 0 12px;">${sub}</p>
          <p style="margin:0 0 12px;">Was it the pricing? If so, we can almost certainly work something out. ExportKit has volume tiers that kick in above 50k&nbsp;/&nbsp;100k&nbsp;/&nbsp;500k items, and we also set custom rates for high-volume accounts on a case-by-case basis.</p>
          <p style="margin:0 0 4px;">Happy to jump on a quick call if that's easier:</p>
          <p style="margin:0 0 12px;"><a href="${CALENDAR_URL}" style="color:#2563eb;">${CALENDAR_URL}</a></p>
          <p style="margin:0 0 12px;">Or just reply here — we'll come back with a number that makes sense for your volume.</p>
          <p style="margin:0 0 12px;">If it wasn't the pricing (missing feature, bug, something just didn't fit), we'd genuinely love to know. Your feedback shapes what gets built next.</p>
          <p style="margin:0 0 16px;">—<br>ExportKit Support</p>
          <p style="margin:0;font-size:13px;color:#555;border-top:1px solid #e5e7eb;padding-top:12px;">
            If you need any custom GHL work — integrations, automations, custom apps, or AI agents — we can help with that too.
            With 6+ years in tech and 3+ years building on HighLevel, we've seen most use cases.
            Just reply to this email if you'd like to talk.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
    'ExportKit Support',
    '',
    '---',
    'P.S. If you need any custom GHL work — integrations, automations, custom apps,',
    'or AI agents — we can help with that too. 6+ years in tech, 3+ years building',
    'on HighLevel. Just reply to this email.',
  ].join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send win-back email via Brevo with both HTML and plain-text parts.
 * Never throws; call without await from the uninstall handler.
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
      htmlContent: buildHtmlBody({ firstName, locationName }),
      textContent: buildTextBody({ firstName, locationName }),
    }, {
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      }
    });
    logger.info('✉️ Win-back email sent', { to, locationId, source, messageId: response.data?.messageId });
  } catch (err) {
    logger.warn('Win-back email failed (non-blocking):', {
      to,
      locationId,
      error: err.response?.data || err.message,
    });
  }
}

module.exports = { sendUninstallWinBackEmail };
