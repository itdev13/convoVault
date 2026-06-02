const axios = require('axios');
const logger = require('../utils/logger');

// Use the same Brevo transactional setup as the Lambda export-handler so all customer-facing
// emails go out from the same verified sender (support@vaultsuite.store). Requires BREVO_API_KEY
// in env. If it's not set, sending is silently skipped (logged).
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM_NAME = 'ExportKit Team';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';

const CALENDAR_URL = 'https://calendar.app.google/2Z1qcGSxbvDU9e6DA';
const SUPPORT_INBOX = 'support@vaultsuite.store';

function htmlBody({ firstName, locationName }) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const subAccountLine = locationName
    ? `<p style="margin:0 0 16px;color:#374151;">We noticed ExportKit was uninstalled from <strong>${escapeHtml(locationName)}</strong>.</p>`
    : `<p style="margin:0 0 16px;color:#374151;">We noticed ExportKit was just uninstalled from your sub-account.</p>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);max-width:560px;">
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${greeting}</h1>
              ${subAccountLine}
              <p style="margin:0 0 16px;color:#374151;line-height:1.55;">
                If pricing was the reason — that's something we can almost always work out.
                ExportKit has volume tiers built in (rates drop sharply above 50k / 100k / 500k items),
                and on top of that we routinely set custom rates for high-volume customers.
                If the numbers didn't add up for your use case, please give us a chance to fix it.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="background:#2563eb;border-radius:8px;">
                    <a href="${CALENDAR_URL}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">
                      Schedule a quick call →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">
                Prefer email? Just reply to this message — it goes straight to our inbox
                (<a href="mailto:${SUPPORT_INBOX}" style="color:#2563eb;text-decoration:none;">${SUPPORT_INBOX}</a>).
                Tell us the rough volume you were exporting and what felt off, and we'll come back with a price that works.
              </p>
              <p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.5;">
                If you uninstalled for any other reason (a missing feature, a bug, a workflow that didn't fit),
                we'd love to hear about that too. Your feedback genuinely shapes the roadmap.
              </p>
              <p style="margin:24px 0 0;color:#374151;font-size:14px;">— The ExportKit Team</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.5;">
              You're receiving this one-time email because you recently installed and uninstalled ExportKit
              on your sub-account. We won't email you again unless you reply.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textBody({ firstName, locationName }) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const sub = locationName
    ? `We noticed ExportKit was uninstalled from ${locationName}.`
    : 'We noticed ExportKit was just uninstalled from your sub-account.';
  return [
    greeting,
    '',
    sub,
    '',
    'If pricing was the reason — that\'s something we can almost always work out.',
    'ExportKit has volume tiers built in (rates drop sharply above 50k / 100k / 500k items),',
    'and on top of that we routinely set custom rates for high-volume customers.',
    '',
    `Schedule a quick call: ${CALENDAR_URL}`,
    `Or reply to this email — it reaches us at ${SUPPORT_INBOX}.`,
    '',
    'If pricing wasn\'t the reason (missing feature, bug, workflow issue) — we\'d love to hear that too.',
    '',
    '— The ExportKit Team',
    '',
    'You\'re receiving this one-time email because you recently installed and uninstalled ExportKit.',
    'We won\'t email you again unless you reply.'
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
 * Send a one-shot pricing-first win-back email via Brevo (same provider/sender as the Lambda
 * export emails). Never throws — failures are logged. Call without `await` from the uninstall
 * handler so the webhook response isn't delayed.
 */
async function sendUninstallWinBackEmail({ to, name, locationName, locationId }) {
  if (!to) {
    logger.info('Win-back email skipped (no installer email captured)', { locationId });
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
      replyTo: { email: SUPPORT_INBOX, name: EMAIL_FROM_NAME },
      subject: 'Was the pricing the issue? Let\'s talk — ExportKit',
      textContent: textBody({ firstName, locationName }),
      htmlContent: htmlBody({ firstName, locationName })
    }, {
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      }
    });
    logger.info('✉️ Win-back email sent', { to, locationId, messageId: response.data?.messageId });
  } catch (err) {
    logger.warn('Win-back email failed (non-blocking):', {
      to,
      locationId,
      error: err.response?.data || err.message
    });
  }
}

module.exports = { sendUninstallWinBackEmail };
