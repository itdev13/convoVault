/**
 * One-shot: send the "Your Export is Ready" email for a single, hardcoded export job.
 * NO MongoDB connection — paste the job's fields into the JOB constant below and run.
 *
 * Mirrors the Lambda's sendEmail() function 1:1 (same subject template, same HTML body,
 * same Brevo API). Use when MongoDB is unreachable but you still need to notify a customer.
 *
 * Usage:
 *   node scripts/send-export-email-direct.js
 *
 * Required env (from .env):
 *   BREVO_API_KEY
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
// Paste the export job's fields here. Only these 5 fields are actually used.
// (The rest of the original DB document is informational — feel free to drop it
//  when reusing this script for another job.)
// ─────────────────────────────────────────────────────────────────────────────
const JOB = {
  notificationEmail: 'david@haywardmma.com',
  exportType: 'messages',
  format: 'csv',
  totalItems: 114645,
  downloadUrl: 'https://convo-vault-exports-1.s3.us-east-1.amazonaws.com/exports/R6qkMnIYuhoiBrpeEPPl/QufTHN7dRygscPmKguNZ/6a0e061b702b049631854860.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAQCQ2B72SDHALVQSB%2F20260520%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260520T192150Z&X-Amz-Expires=604800&X-Amz-Security-Token=IQoJb3JpZ2luX2VjECwaCXVzLWVhc3QtMSJHMEUCIGVyLACGTrb5jwr7g0F8q4lbgPc0dB6kkqq%2BRnWUVBc5AiEAzV%2FtT6IOqifgZmFu84HIoP9Q4jJZA4ys57uliCkzKq0q%2BAMI9P%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARAAGgwwMDU0MjMzNjU3OTYiDNlEUrEkK%2BHfIo0x0yrMA%2BLUInNpdbIKm3bSILpXNHeG4MNgTyPwp2c03lzQGQ8o3sMDUJDbbx16aPZDSCvnKU0n5dmWiJTPvtjpC7rtQ8Dz%2BirpggfaIQRDdXu94iDsrFxGniswGNwRfwRcz7OOt1BVVkHISKDxq8%2FrC%2Fw3YwZ5Q7B5S1s4BplgfmVhmPJ%2BFEmNA105VuAU1JNgV4VyYrtuz2x5fBPX58ilAzbgfvMHd6q9wRCzdpooA%2Fu%2Fq%2Fv%2Bjcg6b9uv2HPRJGMAskyTBb0fjq%2BAIZD0A99OBmnMUjk8DWBDADp%2FyapZjYdcM4DQkz8U4VCG2lVgY7zmCz6TNqFaFZvNY3qj0A2iUnIniENzW4ftovZCXJMVL%2BUUylsV8NjZS0WjwJ88S0VqtBq15i%2BP0IMgQvrisdRZOatZvdx4wEGVJojwk9SLaRGzeMXO5sc75rXTzLfQcm%2BPJjjKHVZYzewd865f96bHxU99DNLXqSK%2BvHu3I7LTXz04OwveieKkRI2ACA8BvcAJpStAIoWD6AZV3bvcNm%2BgUHNmAH0c1xhq1iyDo60ALkwGYvY3UUkmxVaa%2BevEe3Tt4x6MEq18sbxGv5vQ2roj71AWjFo6ADOGFQoJnZEql38wm4y40AY6oQGM%2BXJEwCvZmiUqeGjS%2BCWiNf%2BA1IwtTrFadVT%2FlyxnUJ319qy3lJbrifT0QH4%2BBm%2FNVaytAnGF4IKcE7sbXgOp97IsHax%2BtT7ClfbWFACYzgD%2F%2Bh%2Ftj891CviP39U2CQgmMGU9p1IujoidzShhiIxrWWoWjB2OnqpIs1aDocj10vGb2ZECuVb3f%2B2NaoYb05W8KJX1wUEq9L9mIv%2F0ILmUng%3D%3D&X-Amz-Signature=4e4486f12d5ab5bbdbe69f04bf8dcc6cd22dde19a5571177d97894961905d37c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject'
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants — exact copy of the Lambda's email config.
// ─────────────────────────────────────────────────────────────────────────────
const BREVO_API_KEY = "";
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_FROM_NAME = 'VaultSuite';
const EMAIL_FROM_ADDRESS = 'support@vaultsuite.store';

// ─────────────────────────────────────────────────────────────────────────────
// Email payload — 1:1 mirror of Lambda's sendEmail() so the customer gets exactly
// the same template they'd have received from the normal flow.
// ─────────────────────────────────────────────────────────────────────────────
async function sendEmail(email, downloadUrl, jobDetails) {
  if (!BREVO_API_KEY) {
    console.error('BREVO_API_KEY not configured in env, aborting.');
    process.exit(1);
  }

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
      jobDetails.exportType === 'customFields' ? 'Custom Fields' :
      jobDetails.exportType === 'customValues' ? 'Custom Values' :
      jobDetails.exportType === 'tags' ? 'Tags' :
      jobDetails.exportType === 'specialTabMessages' ? 'Special Messages' :
      jobDetails.exportType === 'callTranscriptions' ? 'Call Transcriptions' :
      jobDetails.exportType === 'opportunityStageHistory' ? 'Opportunity Stage History' :
      jobDetails.exportType === 'contactBundle' ? 'Contact Bundle' :
      jobDetails.exportType === 'contacts' ? 'Contacts' : 'Messages'
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

  return response.data;
}

(async () => {
  console.log(`Sending export-ready email to: ${JOB.notificationEmail}`);
  console.log(`  Type: ${JOB.exportType}   Format: ${JOB.format}   Total: ${JOB.totalItems.toLocaleString()}`);
  try {
    const result = await sendEmail(JOB.notificationEmail, JOB.downloadUrl, {
      exportType: JOB.exportType,
      format: JOB.format,
      totalItems: JOB.totalItems
    });
    console.log('✅ Sent. Brevo response:', JSON.stringify(result));
  } catch (err) {
    console.error('❌ Failed:', err.response?.data || err.message);
    process.exit(1);
  }
})();
