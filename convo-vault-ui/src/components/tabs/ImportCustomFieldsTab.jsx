import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button, Table, Alert, Progress, message as antMessage } from 'antd';
import { importAPI } from '../../api/import';
import ExportEstimateModal from '../ExportEstimateModal';
import { DISCOUNT_TIERS } from '../../constants/pricing';

const IMPORT_CUSTOM_FIELDS_UNIT_PRICE = 0.018;

const VALID_DATA_TYPES = [
  'TEXT', 'LARGE_TEXT', 'NUMERICAL', 'PHONE', 'MONETORY', 'CHECKBOX',
  'SINGLE_OPTIONS', 'MULTIPLE_OPTIONS', 'FLOAT', 'TIME', 'DATE',
  'TEXTBOX_LIST', 'FILE_UPLOAD', 'SIGNATURE', 'RADIO'
];

const REQUIRED_COLS = ['name', 'dataType'];
const KNOWN_COLS = ['name', 'dataType', 'model', 'placeholder', 'fieldKey', 'description', 'prefill', 'options'];

const getDiscountPercent = (count) => {
  for (const tier of DISCOUNT_TIERS) {
    if (count >= tier.min && count < tier.max) return tier.discount;
  }
  return DISCOUNT_TIERS[DISCOUNT_TIERS.length - 1].discount;
};

const formatTierRange = (tier) =>
  tier.max === Infinity ? `${tier.min}+` : `${tier.min}-${tier.max}`;

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
      } else { field += c; }
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

function lookup(record, ...keys) {
  for (const k of keys) {
    if (record[k] != null && record[k] !== '') return record[k];
    const lower = k.charAt(0).toLowerCase() + k.slice(1);
    if (record[lower] != null && record[lower] !== '') return record[lower];
    const upper = k.charAt(0).toUpperCase() + k.slice(1);
    if (record[upper] != null && record[upper] !== '') return record[upper];
  }
  return '';
}

export default function ImportCustomFieldsTab() {
  const { location } = useAuth();
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [estimateVisible, setEstimateVisible] = useState(false);

  const handleFile = async (file) => {
    setParseError(null);
    setParsedRows([]);
    setActiveJob(null);
    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseError('Only CSV files are supported.');
      return;
    }

    try {
      const text = await file.text();
      const rawRows = parseCSV(text);
      const { records } = rowsToObjects(rawRows);

      const valid = records.filter(r => {
        const name = lookup(r, 'name').toString().trim();
        const dataType = lookup(r, 'dataType', 'data_type').toString().trim().toUpperCase();
        return name && VALID_DATA_TYPES.includes(dataType);
      });

      if (valid.length === 0) {
        setParseError(`No valid rows found. Each row needs a ${REQUIRED_COLS.join(', ')} (dataType must be one of: ${VALID_DATA_TYPES.join(', ')}).`);
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
      const res = await importAPI.importCustomFields(location.id, parsedRows, fileName);
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

  const baseAmount = Number((parsedRows.length * IMPORT_CUSTOM_FIELDS_UNIT_PRICE).toFixed(4));
  const importDiscountPercent = getDiscountPercent(parsedRows.length);
  const importDiscountAmount = Number((baseAmount * (importDiscountPercent / 100)).toFixed(4));
  const finalImportAmount = Number((baseAmount - importDiscountAmount).toFixed(4));

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
    { title: 'Name', dataIndex: 'name', key: 'name', width: 200, ellipsis: true,
      render: (_, r) => lookup(r, 'name') || '—' },
    { title: 'Data Type', key: 'dataType', width: 140,
      render: (_, r) => lookup(r, 'dataType', 'data_type').toUpperCase() || '—' },
    { title: 'Model', key: 'model', width: 110,
      render: (_, r) => (lookup(r, 'model') || 'contact').toLowerCase() },
    { title: 'Field Key', key: 'fieldKey', width: 180, ellipsis: true,
      render: (_, r) => lookup(r, 'fieldKey', 'field_key') || '—' },
    { title: 'Options', key: 'options', width: 200, ellipsis: true,
      render: (_, r) => lookup(r, 'options') || '—' }
  ];

  const progressPercent = activeJob && activeJob.totalRows
    ? Math.round(((activeJob.processed || 0) / activeJob.totalRows) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Import Custom Fields</h2>
        <p className="text-gray-600 text-sm mb-2">
          Upload a CSV to bulk-create custom fields. Required columns:{' '}
          {REQUIRED_COLS.map((c, i) => (
            <code key={i} className="bg-gray-100 px-1.5 py-0.5 rounded mr-1">{c}</code>
          ))}
          .
        </p>
        <p className="text-gray-500 text-xs">
          Optional columns: {KNOWN_COLS.filter(c => !REQUIRED_COLS.includes(c)).map((c, i) => (
            <code key={i} className="bg-gray-100 px-1.5 py-0.5 rounded mr-1">{c}</code>
          ))}.
          {' '}<code className="bg-gray-100 px-1.5 py-0.5 rounded">model</code> is <code>contact</code> or <code>opportunity</code> (default contact).
          {' '}For SINGLE_OPTIONS / MULTIPLE_OPTIONS / RADIO / CHECKBOX, provide{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded">options</code> like{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded">Bronze:bronze; Silver:silver; Gold:gold</code>.
        </p>
      </div>

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
        <Alert type="error" message="Cannot import this file" description={parseError} className="mb-4" showIcon />
      )}

      {parsedRows.length > 0 && !activeJob && (
        <>
          <Alert
            type="info"
            message={`${parsedRows.length} rows ready to import`}
            description="Review the rows below, then click Submit to create the custom fields."
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
              Submit &amp; Import {parsedRows.length} Custom Fields
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
        exportType="customFields"
        importMode={true}
        estimate={{
          itemCounts: { customFields: parsedRows.length, total: parsedRows.length },
          breakdown: {
            customFields: {
              count: parsedRows.length,
              unitPrice: IMPORT_CUSTOM_FIELDS_UNIT_PRICE,
              subtotal: baseAmount
            }
          },
          baseAmount,
          discountPercent: importDiscountPercent,
          discountAmount: importDiscountAmount,
          finalAmount: finalImportAmount,
          discountTiers: DISCOUNT_TIERS.map(t => ({ range: formatTierRange(t), discount: t.discount }))
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
                <div className="text-yellow-700 text-xs">Skipped (duplicates / invalid)</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <div className="text-red-700 font-semibold text-lg">{activeJob.failed || 0}</div>
                <div className="text-red-700 text-xs">Failed</div>
              </div>
            </div>
          )}
          {activeJob.status === 'completed' && activeJob.errors && activeJob.errors.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-700">
                View {activeJob.errors.length} error{activeJob.errors.length > 1 ? 's' : ''}
              </summary>
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
