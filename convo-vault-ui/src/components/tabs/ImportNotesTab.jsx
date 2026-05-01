import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button, Table, Alert, Progress, message as antMessage } from 'antd';
import { importAPI } from '../../api/import';
import ExportEstimateModal from '../ExportEstimateModal';

const IMPORT_NOTES_UNIT_PRICE = 0.018; // mirrors backend billingService DEFAULT_UNIT_PRICES.importNotes

// Columns produced by the notes export (lambda/export-handler/index.js notesToCSV)
const REQUIRED_COLS = ['Body']; // BodyText is fallback
const KNOWN_COLS = [
  'NoteID', 'ContactID', 'ContactName', 'ContactEmail', 'ContactPhone',
  'Body', 'BodyText', 'UserID', 'DateAdded', 'Relations'
];

// Minimal RFC-4180 CSV parser — handles quoted fields, escaped quotes, embedded commas/newlines.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ''));
}

function rowsToObjects(rows) {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] || ''; });
    return obj;
  });
  return { headers, records };
}

export default function ImportNotesTab() {
  const { location } = useAuth();
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [missingCols, setMissingCols] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [estimateVisible, setEstimateVisible] = useState(false);

  const handleFile = async (file) => {
    setParseError(null);
    setMissingCols([]);
    setParsedRows([]);
    setActiveJob(null);
    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseError('Only CSV files are supported. If you exported as XLSX, please re-export as CSV.');
      return;
    }

    try {
      const text = await file.text();
      const rawRows = parseCSV(text);
      const { headers, records } = rowsToObjects(rawRows);

      const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
      if (missing.length > 0) {
        setMissingCols(missing);
        setParseError(`File is missing required columns: ${missing.join(', ')}.`);
        return;
      }

      // Filter out empty rows + rows with no body
      const valid = records.filter(r => (r.Body && r.Body.trim()) || (r.BodyText && r.BodyText.trim()));
      if (valid.length === 0) {
        setParseError('No rows with note body found in the file.');
        return;
      }

      setParsedRows(valid);
    } catch (err) {
      setParseError(`Failed to parse file: ${err.message}`);
    }
  };

  const handleSubmit = () => {
    if (!location?.id || parsedRows.length === 0) return;
    setEstimateVisible(true);
  };

  const handleConfirmCharge = async () => {
    if (!location?.id || parsedRows.length === 0) return;
    setSubmitting(true);
    try {
      const rows = parsedRows.map(r => ({
        contactName: r.ContactName,
        contactEmail: r.ContactEmail,
        contactPhone: r.ContactPhone,
        body: r.Body,
        bodyText: r.BodyText
      }));
      const res = await importAPI.importNotes(location.id, rows, fileName);
      if (res.success) {
        setActiveJob({ jobId: res.data.jobId, totalRows: res.data.totalRows, status: 'processing', processed: 0 });
        setEstimateVisible(false);
        antMessage.success(`Charged $${Number(res.data.amountCharged || 0).toFixed(2)}. Import processing in background.`);
      } else {
        antMessage.error(res.error || 'Failed to start import');
      }
    } catch (err) {
      antMessage.error(err.response?.data?.error || err.message || 'Import failed');
    } finally {
      setSubmitting(false);
    }
  };

  const totalAmount = (parsedRows.length * IMPORT_NOTES_UNIT_PRICE);

  // Poll job status
  useEffect(() => {
    if (!activeJob?.jobId || activeJob.status === 'completed' || activeJob.status === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const res = await importAPI.getStatus(activeJob.jobId);
        if (res.success) {
          setActiveJob({ ...activeJob, ...res.data });
          if (res.data.status === 'completed') {
            antMessage.success(`Import done: ${res.data.successful} created, ${res.data.skipped || 0} skipped, ${res.data.failed} failed`);
          }
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status]);

  const columns = [
    { title: 'Contact Name', dataIndex: 'ContactName', key: 'ContactName', width: 160, ellipsis: true },
    { title: 'Email', dataIndex: 'ContactEmail', key: 'ContactEmail', width: 180, ellipsis: true },
    { title: 'Phone', dataIndex: 'ContactPhone', key: 'ContactPhone', width: 140, ellipsis: true },
    {
      title: 'Note (HTML)',
      dataIndex: 'Body',
      key: 'Body',
      ellipsis: true,
      render: (val, row) => {
        const text = val || row.BodyText || '';
        return <span title={text}>{text.length > 120 ? text.slice(0, 120) + '…' : text}</span>;
      }
    }
  ];

  const progressPercent = activeJob && activeJob.totalRows
    ? Math.round(((activeJob.processed || 0) / activeJob.totalRows) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Import Notes</h2>
        <p className="text-gray-600 text-sm mb-2">
          Upload a CSV to bulk-create contacts and attach notes. Contacts are matched by email or phone.
        </p>
        <p className="text-gray-500 text-xs">
          Required columns: <code className="bg-gray-100 px-1.5 py-0.5 rounded">ContactName</code>,
          <code className="bg-gray-100 px-1.5 py-0.5 rounded ml-1">ContactEmail</code> or
          <code className="bg-gray-100 px-1.5 py-0.5 rounded ml-1">ContactPhone</code>, and
          <code className="bg-gray-100 px-1.5 py-0.5 rounded ml-1">Body</code>.
        </p>
      </div>

      {/* File picker */}
      <div className="mb-6 flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Button type="primary" onClick={() => fileInputRef.current?.click()} disabled={submitting}>
          Select CSV file
        </Button>
        {fileName && <span className="text-sm text-gray-700">{fileName}</span>}
      </div>

      {parseError && (
        <Alert
          type="error"
          message="Cannot import this file"
          description={parseError}
          className="mb-4"
          showIcon
        />
      )}

      {parsedRows.length > 0 && !activeJob && (
        <>
          <Alert
            type="info"
            message={`${parsedRows.length} rows ready to import`}
            description="Review the rows below, then click Submit to create contacts and notes in this location."
            className="mb-4"
            showIcon
          />
          <Table
            rowKey={(_, i) => i}
            columns={columns}
            dataSource={parsedRows}
            pagination={{ pageSize: 25, showSizeChanger: false }}
            size="small"
            scroll={{ x: 800 }}
            className="mb-4"
          />
          <div className="flex justify-end">
            <Button type="primary" size="large" onClick={handleSubmit} loading={submitting}>
              Submit & Import {parsedRows.length} Notes
            </Button>
          </div>
        </>
      )}

      <ExportEstimateModal
        visible={estimateVisible}
        onCancel={() => !submitting && setEstimateVisible(false)}
        onConfirm={handleConfirmCharge}
        loading={submitting}
        estimating={false}
        exportType="notes"
        importMode={true}
        estimate={{
          itemCounts: { notes: parsedRows.length, total: parsedRows.length },
          breakdown: {
            notes: {
              count: parsedRows.length,
              unitPrice: IMPORT_NOTES_UNIT_PRICE,
              subtotal: totalAmount
            }
          },
          baseAmount: totalAmount,
          discountPercent: 0,
          discountAmount: 0,
          finalAmount: totalAmount
        }}
      />

      {activeJob && (
        <div className="border border-gray-200 rounded-lg p-5 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-gray-900">
              {activeJob.status === 'completed' ? 'Import complete' : 'Importing...'}
            </span>
            <span className="text-sm text-gray-600">
              {activeJob.processed || 0} / {activeJob.totalRows}
            </span>
          </div>
          <Progress percent={progressPercent} status={activeJob.status === 'completed' ? 'success' : 'active'} />
          {activeJob.status === 'completed' && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <div className="text-green-700 font-semibold text-lg">{activeJob.successful || 0}</div>
                <div className="text-green-700 text-xs">Created</div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <div className="text-yellow-700 font-semibold text-lg">{activeJob.skipped || 0}</div>
                <div className="text-yellow-700 text-xs">Skipped</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <div className="text-red-700 font-semibold text-lg">{activeJob.failed || 0}</div>
                <div className="text-red-700 text-xs">Failed</div>
              </div>
            </div>
          )}
          {activeJob.status === 'completed' && activeJob.errors && activeJob.errors.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-700">View {activeJob.errors.length} error{activeJob.errors.length > 1 ? 's' : ''}</summary>
              <ul className="mt-2 space-y-1 text-xs text-red-700 max-h-48 overflow-y-auto">
                {activeJob.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          {activeJob.status === 'completed' && (
            <div className="mt-4 flex justify-end">
              <Button onClick={() => { setActiveJob(null); setParsedRows([]); setFileName(''); }}>
                Import another file
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
