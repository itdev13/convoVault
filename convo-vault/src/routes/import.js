const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');
const { logError, logWarning } = require('../utils/errorLogger');
const ImportJob = require('../models/ImportJob');
const { authenticateSession } = require('../middleware/auth');
const ThrottleQueue = require('../utils/throttleQueue');
const billingService = require('../services/billingService');
const BillingTransaction = require('../models/BillingTransaction');

const IMPORT_NOTES_METER_ID = '69864aed1265653fdd7c0620'; // shared meter, same as exports
const IMPORT_CONTACTS_METER_ID = '69864aed1265653fdd7c0620'; // same meter as imports/notes — shared

/**
 * FEATURE 3: Import from CSV/Excel to Conversations
 * Simple controller to import messages from CSV/Excel files
 */

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

// Maximum contacts per import
const MAX_CONTACTS_PER_IMPORT = 2000;

/**
 * @route POST /api/import/upload
 * @desc Upload CSV/Excel file and import to conversations
 * Note: This endpoint returns immediately with job ID
 * Processing happens asynchronously in background
 */
router.post('/upload', authenticateSession, upload.single('file'), async (req, res) => {
  // Increase timeout for this endpoint to handle large file parsing
  req.setTimeout(60000); // 60 seconds for upload + parsing
  
  try {
    const { locationId } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    logger.info('Import file uploaded', { 
      filename: req.file.originalname,
      locationId 
    });

    // Parse file based on extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    let messages = [];

    if (ext === '.csv') {
      messages = await parseCSV(req.file.path);
    } else if (ext === '.xlsx' || ext === '.xls') {
      messages = await parseExcel(req.file.path);
    }

    logger.info(`Parsed ${messages.length} messages from file`);

    // Check maximum contacts limit
    if (messages.length > MAX_CONTACTS_PER_IMPORT) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.status(400).json({
        error: `File contains ${messages.length} contacts, which exceeds the maximum limit of ${MAX_CONTACTS_PER_IMPORT} contacts per import. Please split your file into smaller batches.`
      });
    }

    // Create import job in database
    const job = await ImportJob.create({
      locationId: locationId,
      fileName: req.file.originalname,
      totalRows: messages.length,
      status: 'pending'
    });

    // Start async processing (don't await - return immediately)
    processImportAsync(job._id, locationId, messages, req.file.path);

    // Return job ID immediately
    res.json({
      success: true,
      message: 'Import started - processing in background',
      data: {
        jobId: job._id,
        totalRows: messages.length,
        status: 'processing'
      }
    });

  } catch (error) {
    logError('Import upload error', error, { 
      locationId: req.body?.locationId,
      filename: req.file?.originalname,
      size: req.file?.size 
    });
    
    // Clean up file if exists
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: 'Import failed',
      message: error.message || 'Failed to process import file'
    });
  }
});

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (basic check)
 */
function isValidPhone(phone) {
  if (!phone) return false;
  // Basic validation: should start with + and have digits
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/[\s-()]/g, ''));
}

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const contacts = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Skip completely empty rows
        if (!row.locationId && !row.contactId && !row.name && !row.email && !row.phone) {
          return;
        }
        
        contacts.push({
          locationId: row.locationId || row.location_id || null,
          contactId: row.contactId || row.contact_id || null,
          name: row.name || null,
          email: row.email || null,
          phone: row.phone || null,
          // Optional fields
          companyName: row.companyName || null,
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          postalCode: row.postalCode || null,
          country: row.country || null,
          website: row.website || null,
          timezone: row.timezone || null,
          dateOfBirth: row.dateOfBirth || null,
          gender: row.gender || null,
          tags: row.tags || null
        });
      })
      .on('end', () => {
        logger.info(`Parsed ${contacts.length} valid rows from CSV`);
        resolve(contacts);
      })
      .on('error', reject);
  });
}

/**
 * Parse Excel file
 */
function parseExcel(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    return data.map(row => ({
      locationId: row.locationId || row.location_id || null,
      contactId: row.contactId || row.contact_id || null,
      name: row.name || null,
      email: row.email || null,
      phone: row.phone || null,
      // Optional fields
      companyName: row.companyName || null,
      address1: row.address1 || null,
      city: row.city || null,
      state: row.state || null,
      postalCode: row.postalCode || null,
      country: row.country || null,
      website: row.website || null,
      timezone: row.timezone || null,
      dateOfBirth: row.dateOfBirth || null,
      gender: row.gender || null,
      tags: row.tags || null
    }));
  } catch (error) {
    throw new Error(`Failed to parse Excel: ${error.message}`);
  }
}

/**
 * Process import asynchronously in background
 */
async function processImportAsync(jobId, defaultLocationId, contacts, filePath) {
  try {
    // Update job to processing
    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'processing',
      startedAt: new Date()
    });

    // Process all contacts
    const results = await importConversations(jobId, defaultLocationId, contacts);

    // Update job to completed
    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      successful: results.success,
      failed: results.failed,
      skipped: results.skipped || 0,  // Add skipped count
      importErrors: results.importErrors,
      completedAt: new Date()
    });

    logger.info(`✅ Import job ${jobId} completed: ${results.success} created, ${results.skipped || 0} skipped, ${results.failed} failed`);

  } catch (error) {
    logError(`Import job ${jobId} failed`, error, { 
      jobId, 
      locationId: defaultLocationId,
      totalRows: contacts?.length 
    });
    
    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      importErrors: [{ row: 0, error: error.message || 'Import processing failed' }],
      completedAt: new Date()
    });
  } finally {
    // Clean up file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Import conversations with validations and smart contact creation
 */
async function importConversations(jobId, defaultLocationId, contacts) {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    importErrors: []
  };

  // Cache for validated locations (check once per unique locationId)
  const validatedLocations = new Set();
  
  // Track processed contacts to skip duplicates in the same batch
  const processedContacts = new Set();

  for (let i = 0; i < contacts.length; i++) {
    const row = contacts[i];
    
    // Wrap entire row processing to prevent any error from stopping import
    try {
      // VALIDATION 1: locationId (from row or default)
      const locationId = (row.locationId?.trim()) || defaultLocationId;
      
      if (!locationId) {
        results.failed++;
        results.importErrors.push({
          row: i + 1,
          error: 'locationId is required'
        });
        continue;
      }

      // Validate location exists (only once per unique locationId)
      if (!validatedLocations.has(locationId)) {
        logger.info(`Validating location: ${locationId}`);
        const locationExists = await ghlService.validateLocation(locationId);
        
        if (!locationExists) {
          results.failed++;
          results.importErrors.push({
            row: i + 1,
            error: `Invalid locationId: ${locationId} - Location does not exist`
          });
          continue;
        }
        
        validatedLocations.add(locationId);
        logger.info(`✅ Location ${locationId} validated`);
      }

      // VALIDATION 2: Must have contactId OR (email/phone)
      let contactId = row.contactId?.trim();
      
      if (!contactId && !row.email && !row.phone) {
        results.failed++;
        results.importErrors.push({
          row: i + 1,
          error: 'Must provide either contactId OR (email/phone)'
        });
        continue;
      }

      // VALIDATION 3: Email format (if provided)
      if (row.email && !isValidEmail(row.email)) {
        results.failed++;
        results.importErrors.push({
          row: i + 1,
          error: `Invalid email format: ${row.email}`
        });
        continue;
      }

      // VALIDATION 4: Phone format (if provided)
      if (row.phone && !isValidPhone(row.phone)) {
        results.failed++;
        results.importErrors.push({
          row: i + 1,
          error: `Invalid phone: ${row.phone} (use +countrycode...)`
        });
        continue;
      }

      // Check for duplicates in this batch
      const duplicateKey = contactId || row.email || row.phone;
      const uniqueKey = `${locationId}:${duplicateKey}`;
      
      if (processedContacts.has(uniqueKey)) {
        logger.info(`Row ${i + 1}: ⏭️ Skipping duplicate - ${duplicateKey}`);
        results.skipped++;
        
        // Update job progress
        await ImportJob.findByIdAndUpdate(jobId, {
          processed: i + 1,
          successful: results.success,
          failed: results.failed
        });
        
        continue; // Skip this duplicate row
      }
      
      // Mark as processed
      processedContacts.add(uniqueKey);
      
      // STEP 1: Get or Create Contact
      if (!contactId) {
        logger.info(`Row ${i + 1}: Creating contact - ${row.name || row.email || row.phone}`);
        
        // Build contact data (all fields optional except email/phone for identification)
        const contactData = {};
        
        if (row.name) {
          const nameParts = row.name.trim().split(' ');
          contactData.firstName = nameParts[0];
          if (nameParts.length > 1) {
            contactData.lastName = nameParts.slice(1).join(' ');
          }
        }
        
        if (row.email) contactData.email = row.email.trim();
        if (row.phone) contactData.phone = row.phone.trim();
        
        // Optional fields
        if (row.companyName) contactData.companyName = row.companyName;
        if (row.address1) contactData.address1 = row.address1;
        if (row.city) contactData.city = row.city;
        if (row.state) contactData.state = row.state;
        if (row.postalCode) contactData.postalCode = row.postalCode;
        if (row.country) contactData.country = row.country;
        if (row.website) contactData.website = row.website;
        if (row.timezone) contactData.timezone = row.timezone;
        if (row.dateOfBirth) contactData.dateOfBirth = row.dateOfBirth;
        if (row.gender) contactData.gender = row.gender;
        if (row.tags) {
          // Tags can be semicolon-separated
          contactData.tags = row.tags.split(';').map(t => t.trim()).filter(t => t);
        }

        // Upsert contact
        const contact = await ghlService.upsertContact(locationId, contactData);
        contactId = contact.id;
        
        logger.info(`Row ${i + 1}: ✅ Contact ${contactId}`);
      }

      // STEP 2: Create Conversation (handle if already exists)
      try {
        await ghlService.createConversation(locationId, {
          locationId: locationId,
          contactId: contactId
        });
        
        results.success++;
        logger.info(`Row ${i + 1}: ✅ Conversation created`);
        
      } catch (convError) {
        // Check if conversation already exists
        if (convError.response?.status === 422 || 
            convError.message?.includes('already exists') ||
            convError.message?.includes('duplicate')) {
          logger.info(`Row ${i + 1}: ℹ️ Conversation already exists for contact ${contactId}, skipping`);
          results.skipped++;
        } else {
          // Real error - count as failed
          throw convError;
        }
      }

      // Update job progress
      await ImportJob.findByIdAndUpdate(jobId, {
        processed: i + 1,
        successful: results.success,
        failed: results.failed
      });
      
      // Log progress every 10 rows
      if ((i + 1) % 10 === 0) {
        logger.info(`📈 Progress: ${i + 1}/${contacts.length} rows processed (${results.success} created, ${results.skipped} skipped, ${results.failed} failed)`);
      }

      // Rate limiting - balanced to avoid API throttling while keeping speed reasonable
      // 150ms delay = ~6-7 rows per second = 88 rows in ~13-15 seconds
      await new Promise(resolve => setTimeout(resolve, 150));

    } catch (error) {
      // Catch ANY error to ensure import continues
      logger.error(`Row ${i + 1}: ❌ ${error.message}`, {
        error: error.response?.data || error.message,
        status: error.response?.status
      });
      
      results.failed++;
      results.importErrors.push({
        row: i + 1,
        error: error.response?.data?.message || error.message || 'Unknown error',
        errorType: error.response?.status || 'unknown',
        data: {
          locationId: row.locationId || defaultLocationId,
          contactId: row.contactId || null,
          name: row.name || null,
          email: row.email || null,
          phone: row.phone || null
        }
      });
      
      // Update job with error count (always update progress)
      try {
        await ImportJob.findByIdAndUpdate(jobId, {
          processed: i + 1,
          successful: results.success,
          failed: results.failed
        });
      } catch (dbError) {
        logger.error('Failed to update job progress', dbError);
        // Continue even if DB update fails
      }
    }
  }

  logger.info(`📊 Import complete: ${results.success} created, ${results.skipped} skipped (duplicates), ${results.failed} failed`);
  return results;
}

/**
 * @route GET /api/import/template
 * @desc Download CSV template for imports
 */
router.get('/template', authenticateSession, (req, res) => {
  const template = 'locationId,contactId,name,email,phone,companyName,address1,city,state,postalCode,country,website,timezone,dateOfBirth,gender,tags\n' +
                   'sampleLocationId,sampleContactId,,,,,,,,,,,,,\n' +
                   'sampleLocationId,,John Doe,john@example.com,+1234567890,Tech Corp,123 Main St,New York,NY,10001,US,https://techcorp.com,America/New_York,1990-01-15,male,vip\n' +
                   'sampleLocationId,,Jane Smith,jane@test.com,+9876543210,,,,,,,,,,,customer;lead\n' +
                   'sampleLocationId,,,emily@test.com,,ABC Inc,,,,,,,,,,\n' +
                   'sampleLocationId,,Mike Wilson,,+11234567890,,,,,,,,,,male,';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="conversations_import_template.csv"');
  res.send(template);
});

/**
 * @route GET /api/import/status/:jobId
 * @desc Get import job status
 */
router.get('/status/:jobId', authenticateSession, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ImportJob.findById(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Import job not found'
      });
    }

    res.json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        fileName: job.fileName,
        totalRows: job.totalRows,
        processed: job.processed,
        successful: job.successful,
        failed: job.failed,
        skipped: job.skipped || 0,  // Include skipped count
        errors: job.importErrors,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt
      }
    });

  } catch (error) {
    logger.error('Get import status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get import status'
    });
  }
});

/**
 * @route GET /api/import/jobs
 * @desc Get recent import jobs for location
 */
router.get('/jobs', authenticateSession, async (req, res) => {
  try {
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'locationId is required'
      });
    }

    const jobs = await ImportJob.getRecentJobs(locationId, 20);

    res.json({
      success: true,
      data: {
        total: jobs.length,
        jobs: jobs.map(job => ({
          jobId: job._id,
          fileName: job.fileName,
          status: job.status,
          totalRows: job.totalRows,
          processed: job.processed,
          successful: job.successful,
          failed: job.failed,
          skipped: job.skipped || 0,  // Include skipped count
          createdAt: job.createdAt,
          completedAt: job.completedAt
        }))
      }
    });

  } catch (error) {
    logger.error('Get import jobs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get import jobs'
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// NOTES IMPORT — re-import notes from a previously exported CSV.
// Frontend parses the CSV and POSTs JSON rows to /api/import/notes.
// We upsert each contact (using ContactEmail/ContactPhone for dedup)
// and create the note body against that contact, throttled to avoid 429s.
// ════════════════════════════════════════════════════════════════════════

const MAX_NOTES_PER_IMPORT = 5000;

router.post('/notes', authenticateSession, async (req, res) => {
  try {
    const { locationId, rows } = req.body || {};
    const { companyId, userId } = req.user;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows must be a non-empty array' });
    }
    if (rows.length > MAX_NOTES_PER_IMPORT) {
      return res.status(400).json({
        success: false,
        error: `Too many rows (${rows.length}). Max ${MAX_NOTES_PER_IMPORT} per import — please split the file.`
      });
    }

    // Pricing: flat $0.018 per row, no discounts
    const unitPrices = billingService.getUnitPrices(locationId);
    const unitPrice = unitPrices.importNotes ?? 0.018;
    const totalRows = rows.length;
    const finalAmount = Number((totalRows * unitPrice).toFixed(4));

    // Get OAuth token + verify wallet funds (same pattern as charge-and-export)
    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient wallet balance',
        message: 'Please add funds to your GHL wallet to continue'
      });
    }

    const meterCharges = [{ meterId: IMPORT_NOTES_METER_ID, qty: totalRows, description: 'Notes import' }];

    const transaction = await BillingTransaction.create({
      locationId,
      companyId,
      type: 'import_notes',
      itemCounts: { notes: totalRows, total: totalRows },
      pricing: { baseAmount: finalAmount, discountPercent: 0, discountAmount: 0, finalAmount },
      meterCharges,
      status: 'pending',
      userId
    });

    // Charge wallet before starting work — failure here aborts the import
    try {
      const chargeResult = await billingService.chargeWallet(
        companyId, accessToken, meterCharges, locationId, transaction._id.toString(), finalAmount
      );
      transaction.ghlChargeId = chargeResult?.charges?.map(c => c?.chargeId).join(',');
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
      return res.status(402).json({
        success: false,
        error: 'Payment failed',
        message: chargeError.message
      });
    }

    const job = await ImportJob.create({
      locationId,
      fileName: req.body.fileName || 'notes-import.csv',
      totalRows,
      status: 'pending'
    });

    // Fire-and-forget: process in background, frontend polls /status/:jobId
    processNotesImportAsync(job._id, locationId, rows);

    res.json({
      success: true,
      message: 'Notes import started',
      data: {
        jobId: job._id,
        totalRows,
        status: 'processing',
        amountCharged: finalAmount,
        transactionId: transaction._id
      }
    });
  } catch (error) {
    logError('Notes import error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: error.message || 'Failed to start notes import' });
  }
});

async function processNotesImportAsync(jobId, locationId, rows) {
  await ImportJob.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const importErrors = [];

  // Throttle ~3 req/sec — each row makes 2 GHL calls (upsert + create note),
  // so effective rate is ~6 calls/sec, well under typical GHL rate limits.
  const queue = new ThrottleQueue({ name: `notes-import-${jobId}`, delayMs: 350 });

  let processed = 0;
  const total = rows.length;

  // Wrap each row in a queued job and await all completions
  const jobs = rows.map((row, idx) => new Promise((resolve) => {
    queue.push(async () => {
      try {
        const body = (row.body || row.Body || '').toString();
        const bodyText = (row.bodyText || row.BodyText || '').toString();
        const contactName = (row.contactName || row.ContactName || '').toString().trim();
        const contactEmail = (row.contactEmail || row.ContactEmail || '').toString().trim();
        const contactPhone = (row.contactPhone || row.ContactPhone || '').toString().trim();

        // Skip rows with no usable note content and no contact info
        if (!body && !bodyText) {
          skipped++;
          importErrors.push({ row: idx + 2, error: 'No body content', data: { contactName } });
          return;
        }
        if (!contactEmail && !contactPhone && !contactName) {
          skipped++;
          importErrors.push({ row: idx + 2, error: 'No contact identifier (email/phone/name)', data: {} });
          return;
        }

        // 1) Upsert contact — email/phone are the dedup keys for GHL
        const [firstName, ...rest] = contactName.split(/\s+/);
        const contactPayload = {
          firstName: firstName || undefined,
          lastName: rest.join(' ') || undefined,
          name: contactName || undefined,
          email: contactEmail || undefined,
          phone: contactPhone || undefined
        };
        const contact = await ghlService.upsertContact(locationId, contactPayload);
        const contactId = contact?.id || contact?.contactId;
        if (!contactId) throw new Error('Upsert returned no contactId');

        // 2) Create note (HTML body preferred, falls back to plain text)
        await ghlService.createNote(locationId, contactId, { body: body || bodyText });

        successful++;
      } catch (err) {
        failed++;
        importErrors.push({
          row: idx + 2,
          error: err.message || 'Unknown error',
          data: { contactName: row.contactName || row.ContactName || '' }
        });
        logWarning('Notes import row failed', { row: idx + 2, error: err.message });
      } finally {
        processed++;
        // Persist progress every 10 rows so the UI sees it
        if (processed % 10 === 0 || processed === total) {
          await ImportJob.findByIdAndUpdate(jobId, { processed, successful, failed, skipped }).catch(() => {});
        }
        resolve();
      }
    });
  }));

  await Promise.all(jobs);

  await ImportJob.findByIdAndUpdate(jobId, {
    status: 'completed',
    processed,
    successful,
    failed,
    skipped,
    importErrors: importErrors.slice(0, 100), // cap stored errors
    completedAt: new Date()
  });

  logger.info(`✅ Notes import ${jobId} done: ${successful} succeeded, ${skipped} skipped, ${failed} failed`);
}

// ════════════════════════════════════════════════════════════════════════
// CONTACTS IMPORT — frontend parses the CSV and POSTs JSON rows.
// Each row → POST /contacts/ (always-create), throttled to avoid 429s.
// Pricing: $0.018/row, no discounts, charged upfront.
// ════════════════════════════════════════════════════════════════════════

const MAX_CONTACTS_ROWS_PER_IMPORT = 5000;

router.post('/contacts', authenticateSession, async (req, res) => {
  try {
    const { locationId, rows } = req.body || {};
    const { companyId, userId } = req.user;

    if (!locationId) {
      return res.status(400).json({ success: false, error: 'locationId is required' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows must be a non-empty array' });
    }
    if (rows.length > MAX_CONTACTS_ROWS_PER_IMPORT) {
      return res.status(400).json({
        success: false,
        error: `Too many rows (${rows.length}). Max ${MAX_CONTACTS_ROWS_PER_IMPORT} per import — please split the file.`
      });
    }

    const unitPrices = billingService.getUnitPrices(locationId);
    const unitPrice = unitPrices.importContacts ?? 0.018;
    const totalRows = rows.length;
    const baseAmount = Number((totalRows * unitPrice).toFixed(4));
    const discountPercent = billingService.getDiscountPercent(totalRows);
    const discountAmount = Number((baseAmount * (discountPercent / 100)).toFixed(4));
    const finalAmount = Number((baseAmount - discountAmount).toFixed(4));

    const tokenData = await ghlService.getValidToken(locationId);
    const accessToken = tokenData.accessToken || tokenData;

    const hasFunds = await billingService.hasFunds(companyId, accessToken);
    if (!hasFunds) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient wallet balance',
        message: 'Please add funds to your GHL wallet to continue'
      });
    }

    const meterCharges = [{ meterId: IMPORT_CONTACTS_METER_ID, qty: totalRows, description: 'Contacts import' }];

    const transaction = await BillingTransaction.create({
      locationId,
      companyId,
      type: 'import_contacts',
      itemCounts: { contacts: totalRows, total: totalRows },
      pricing: { baseAmount, discountPercent, discountAmount, finalAmount },
      meterCharges,
      status: 'pending',
      userId
    });

    try {
      const chargeResult = await billingService.chargeWallet(
        companyId, accessToken, meterCharges, locationId, transaction._id.toString(), finalAmount
      );
      transaction.ghlChargeId = chargeResult?.charges?.map(c => c?.chargeId).join(',');
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
      return res.status(402).json({
        success: false,
        error: 'Payment failed',
        message: chargeError.message
      });
    }

    const job = await ImportJob.create({
      locationId,
      fileName: req.body.fileName || 'contacts-import.csv',
      totalRows,
      status: 'pending'
    });

    processContactsImportAsync(job._id, locationId, rows);

    res.json({
      success: true,
      message: 'Contacts import started',
      data: {
        jobId: job._id,
        totalRows,
        status: 'processing',
        amountCharged: finalAmount,
        transactionId: transaction._id
      }
    });
  } catch (error) {
    logError('Contacts import error', error, { locationId: req.body?.locationId });
    res.status(500).json({ success: false, error: error.message || 'Failed to start contacts import' });
  }
});

async function processContactsImportAsync(jobId, locationId, rows) {
  await ImportJob.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const importErrors = [];

  // Throttle ~3 req/sec — single GHL call per row, well under typical rate limits.
  const queue = new ThrottleQueue({ name: `contacts-import-${jobId}`, delayMs: 350 });

  let processed = 0;
  const total = rows.length;

  // CSV columns are read case-insensitively for the common fields the user is likely to provide.
  const get = (row, ...keys) => {
    for (const k of keys) {
      if (row[k] != null && row[k] !== '') return row[k];
      const lower = k.charAt(0).toLowerCase() + k.slice(1);
      if (row[lower] != null && row[lower] !== '') return row[lower];
      const upper = k.charAt(0).toUpperCase() + k.slice(1);
      if (row[upper] != null && row[upper] !== '') return row[upper];
    }
    return undefined;
  };

  // tags column is split on `;` or `,`
  const parseTags = (val) => {
    if (Array.isArray(val)) return val;
    if (!val) return undefined;
    return String(val).split(/[;,]/).map(t => t.trim()).filter(Boolean);
  };

  const jobs = rows.map((row, idx) => new Promise((resolve) => {
    queue.push(async () => {
      try {
        const firstName = (get(row, 'firstName', 'first_name', 'FirstName') || '').toString().trim();
        const lastName = (get(row, 'lastName', 'last_name', 'LastName') || '').toString().trim();
        const fullName = (get(row, 'name', 'fullName', 'Name') || '').toString().trim();
        const email = (get(row, 'email', 'Email') || '').toString().trim();
        const phone = (get(row, 'phone', 'Phone') || '').toString().trim();

        // Need at least an email or phone — GHL rejects contacts with neither.
        if (!email && !phone) {
          skipped++;
          importErrors.push({ row: idx + 2, error: 'No email or phone provided', data: { firstName, lastName, fullName } });
          return;
        }

        const payload = {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          name: fullName || (firstName || lastName ? `${firstName} ${lastName}`.trim() : undefined),
          email: email || undefined,
          phone: phone || undefined,
          companyName: get(row, 'companyName', 'company_name', 'CompanyName') || undefined,
          website: get(row, 'website', 'Website') || undefined,
          source: get(row, 'source', 'Source') || undefined,
          address1: get(row, 'address1', 'address', 'Address') || undefined,
          city: get(row, 'city', 'City') || undefined,
          state: get(row, 'state', 'State') || undefined,
          country: get(row, 'country', 'Country') || undefined,
          postalCode: get(row, 'postalCode', 'postal_code', 'PostalCode', 'zip') || undefined,
          timezone: get(row, 'timezone', 'Timezone') || undefined,
          dateOfBirth: get(row, 'dateOfBirth', 'date_of_birth', 'DateOfBirth') || undefined,
          gender: get(row, 'gender', 'Gender') || undefined,
          tags: parseTags(get(row, 'tags', 'Tags')),
          assignedTo: get(row, 'assignedTo', 'assigned_to', 'AssignedTo') || undefined
        };

        await ghlService.createContact(locationId, payload);
        successful++;
      } catch (err) {
        const ghlMsg = err.response?.data?.message || err.message || 'Unknown error';
        // Treat dedup conflicts as skipped, not failed (e.g. "Contact already exists").
        const status = err.response?.status;
        if (status === 409 || /duplicate|already exists/i.test(ghlMsg)) {
          skipped++;
          importErrors.push({ row: idx + 2, error: 'Contact already exists', data: { email: row.email, phone: row.phone } });
        } else {
          failed++;
          importErrors.push({ row: idx + 2, error: ghlMsg, data: { email: row.email, phone: row.phone } });
          logWarning('Contacts import row failed', { row: idx + 2, error: ghlMsg });
        }
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === total) {
          await ImportJob.findByIdAndUpdate(jobId, { processed, successful, failed, skipped }).catch(() => {});
        }
        resolve();
      }
    });
  }));

  await Promise.all(jobs);

  await ImportJob.findByIdAndUpdate(jobId, {
    status: 'completed',
    processed,
    successful,
    failed,
    skipped,
    importErrors: importErrors.slice(0, 100),
    completedAt: new Date()
  });

  logger.info(`✅ Contacts import ${jobId} done: ${successful} succeeded, ${skipped} skipped, ${failed} failed`);
}

module.exports = router;

