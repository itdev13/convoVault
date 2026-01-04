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

/**
 * FEATURE 3: Import from CSV/Excel to Conversations
 * Simple controller to import messages from CSV/Excel files
 */

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
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

module.exports = router;

