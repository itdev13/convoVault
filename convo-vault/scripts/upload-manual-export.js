/**
 * Upload a locally-downloaded export CSV to S3 and register it as a COMPLETED ExportJob,
 * so it appears in the UI export history and is downloadable exactly like a normal export.
 *
 * Why: sometimes we produce/repair an export file by hand (e.g. notes.csv) and need to make it
 * available to the customer through the normal "download from history" flow.
 *
 * What it does:
 *   1. Reads locationId / companyId from the CSV rows (falls back to CLI/env if not found).
 *   2. Counts data rows (for totalItems / itemCounts).
 *   3. Creates a $0 BillingTransaction (status 'tested' — no charge).
 *   4. Creates the ExportJob (to mint its _id), uploads the file to
 *      s3://<BUCKET>/exports/<companyId>/<locationId>/<jobId>.csv,
 *      generates a 7-day presigned URL, and marks the job 'completed'.
 *
 * MUST run where AWS credentials + Mongo are reachable (server/deploy env — NOT a laptop
 * without creds). Requires @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (present in the
 * lambda's node_modules; this script resolves them from there).
 *
 * Usage:
 *   node scripts/upload-manual-export.js ./notes.csv notes [notificationEmail]
 *     arg1 = path to the CSV file
 *     arg2 = exportType (default: notes)
 *     arg3 = optional notification email (informational; no email is sent by this script)
 *
 * Env (from .env): MONGODB_URI, plus AWS credentials/region in the environment.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// AWS SDK: resolve from convo-vault's own node_modules (normal require). If the S3 packages
// aren't installed here, print an install hint instead of a cryptic MODULE_NOT_FOUND.
let S3Client, PutObjectCommand, GetObjectCommand, getSignedUrl;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
} catch (e) {
  console.error('Missing AWS S3 SDK. Install it in convo-vault first:');
  console.error('  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner');
  process.exit(1);
}

const ExportJob = require('../src/models/ExportJob');
const BillingTransaction = require('../src/models/BillingTransaction');

// ── Config ────────────────────────────────────────────────────────────────────
const S3_BUCKET = 'convo-vault-exports-1';
const PRESIGN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days, matches the lambda

const FILE_PATH = process.argv[2] || path.resolve(__dirname, '../notes.csv');
const EXPORT_TYPE = process.argv[3] || 'notes';
const NOTIFICATION_EMAIL = process.argv[4] || null;

// ── Helpers ─────────────────────────────────────────────────────────────────
// Read locationId (col 2) + companyId (col 3) from the first data row of the CSV.
// (Header row is: id,location_id,company_id,contact_id,...)
function readIdsFromCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstNewline = content.indexOf('\n');
  const afterHeader = content.slice(firstNewline + 1);
  // Data rows have quoted free-text bodies; the first 3 columns are simple ids with no commas.
  const firstRow = afterHeader.split('\n').find((l) => l.trim().length > 0) || '';
  const cols = firstRow.split(',');
  return { locationId: (cols[1] || '').trim(), companyId: (cols[2] || '').trim() };
}

// Quote-aware CSV parser: handles embedded newlines/commas inside quoted fields.
// A note body spanning several visual lines is still ONE record, so a naive line count
// over-counts badly (e.g. 3802 real notes showed as ~8500 lines).
function parseRows(str) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQ) {
      if (c === '"') {
        if (str[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Accurate record count via the quote-aware parser (excludes the header row).
function countDataRows(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseRows(content);
  return rows.slice(1).filter((r) => r.length > 1 && r[0]).length;
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.error('File not found:', FILE_PATH);
    process.exit(1);
  }

  const { locationId, companyId } = readIdsFromCsv(FILE_PATH);
  if (!locationId || !companyId) {
    console.error('Could not read locationId/companyId from CSV. Aborting.');
    process.exit(1);
  }
  const rowCount = countDataRows(FILE_PATH);

  console.log('Manual export upload');
  console.log('  file        :', FILE_PATH);
  console.log('  exportType  :', EXPORT_TYPE);
  console.log('  locationId  :', locationId);
  console.log('  companyId   :', companyId);
  console.log('  ~rows       :', rowCount, '(line-based; bodies with newlines may inflate this)');
  console.log('  bucket      :', S3_BUCKET);
  console.log('');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to Mongo.');

  // 1) $0 billing transaction (no charge) — satisfies ExportJob.billingTransactionId (required).
  const txn = await BillingTransaction.create({
    locationId,
    companyId,
    type: `export_${EXPORT_TYPE}`,
    itemCounts: { notes: EXPORT_TYPE === 'notes' ? rowCount : 0, total: rowCount },
    pricing: { baseAmount: 0, discountPercent: 0, discountAmount: 0, finalAmount: 0 },
    status: 'tested', // no real charge
  });
  console.log('Created $0 BillingTransaction:', txn._id.toString());

  // 2) ExportJob (created first to mint _id used in the S3 key).
  const job = await ExportJob.create({
    locationId,
    companyId,
    billingTransactionId: txn._id,
    exportType: EXPORT_TYPE,
    format: 'csv',
    totalItems: rowCount,
    processedItems: rowCount,
    currentBatch: 1,
    totalBatches: 1,
    status: 'processing',
    notificationEmail: NOTIFICATION_EMAIL,
    startedAt: new Date(),
  });
  console.log('Created ExportJob:', job._id.toString());

  const jobId = job._id.toString();
  const s3Key = `exports/${companyId}/${locationId}/${jobId}.csv`;

  // 3) Upload to S3.
  const s3 = new S3Client();
  const body = fs.readFileSync(FILE_PATH);
  const exportFilename = `${EXPORT_TYPE}-export-${jobId}.csv`;
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: body,
    ContentType: 'text/csv',
    ContentDisposition: `attachment; filename="${exportFilename}"`,
  }));
  console.log('Uploaded to S3:', `s3://${S3_BUCKET}/${s3Key}`);

  // 4) Presigned URL (7 days) + mark completed.
  const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }), { expiresIn: PRESIGN_TTL_SEC });
  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SEC * 1000);

  job.status = 'completed';
  job.s3Key = s3Key;
  job.s3Bucket = S3_BUCKET;
  job.s3Upload = { bucket: S3_BUCKET, key: s3Key, parts: [] };
  job.downloadUrl = downloadUrl;
  job.downloadUrlExpiresAt = expiresAt;
  job.completedAt = new Date();
  await job.save();

  console.log('\n✅ Done. Job marked completed and downloadable from the UI history.');
  console.log('  jobId       :', jobId);
  console.log('  downloadUrl :', downloadUrl);
  console.log('  expiresAt   :', expiresAt.toISOString());

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Upload failed:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
