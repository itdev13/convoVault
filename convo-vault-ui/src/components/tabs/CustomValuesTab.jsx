import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { customValuesAPI } from '../../api/customFields';
import { billingAPI } from '../../api/billing';
import { Select, Button, Input, Alert, message as antMessage, Tooltip } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'document', label: 'Values' },
  { value: 'folder', label: 'Folders' }
];

const CSV_HEADERS = ['ID', 'Name', 'FieldKey', 'Value', 'DocumentType', 'ParentID', 'LocationID'];

export default function CustomValuesTab() {
  const { location } = useAuth();
  const [documentType, setDocumentType] = useState('all');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  useEffect(() => {
    if (!location?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await customValuesAPI.list(location.id, documentType);
        if (cancelled) return;
        if (res.success) setValues(res.data?.customValues || []);
        else setError(res.error || 'Failed to load custom values');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load custom values');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location?.id, documentType]);

  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;
    const t = setInterval(async () => {
      try {
        const res = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (res.success) {
          setActiveJob(res.data);
          if (res.data.status === 'completed') antMessage.success('Export completed! Click Download to get your file.');
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const filtered = search
    ? values.filter(v => {
        const q = search.toLowerCase();
        return (v.name || '').toLowerCase().includes(q)
          || (v.fieldKey || '').toLowerCase().includes(q)
          || (v.value || '').toLowerCase().includes(q);
      })
    : values;

  const buildExportFilters = () => ({ documentType });

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'customValues', buildExportFilters());
      if (res.success) setEstimate(res.data.estimate);
      else setEstimateError(res.error || 'Failed to calculate estimate');
    } catch (err) {
      setEstimateError(err.message || 'Failed to calculate estimate');
    } finally {
      setEstimating(false);
    }
  };

  const handlePayAndExport = async (notificationEmail, format = 'csv') => {
    setProcessing(true);
    setEstimateError(null);
    try {
      const exportFilters = {
        ...buildExportFilters(),
        estimatedTotal: estimate?.itemCounts?.total || undefined
      };
      const res = await billingAPI.chargeAndExport(location.id, 'customValues', format, exportFilters, notificationEmail);
      if (res.success) {
        setActiveJob({
          jobId: res.data.jobId,
          status: res.data.status,
          totalItems: res.data.totalItems,
          progress: { total: res.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
      } else {
        setEstimateError(res.error || 'Export failed');
      }
    } catch (err) {
      setEstimateError(err.message || 'Export failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (!processing) { setExportModalVisible(false); setEstimate(null); setEstimateError(null); }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);

  return (
    <div className="space-y-6">
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="customValues"
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Custom Values</h2>
          <p className="text-sm text-gray-500 mt-1">View and export custom values & folders for this sub-account</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{filtered.length.toLocaleString()}</div>
            <div className="text-xs text-blue-600 font-medium">Items</div>
          </div>
          <Button
            onClick={handleGetEstimate}
            disabled={isExporting || loading || values.length === 0}
            size="large"
            type="primary"
            className="bg-green-600 hover:bg-green-700 border-green-600"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Export Custom Values
          </Button>
          <Tooltip
            title={
              <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Pay-per-use export</strong>
                <br />
                $0.018 per item. Volume discounts up to 70%!
              </div>
            }
            placement="left"
          >
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center cursor-help">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </Tooltip>
        </div>
      </div>

      {activeJob && (
        <ExportProgress
          job={activeJob}
          onRefresh={() => {
            billingAPI.getExportStatus(activeJob.jobId, location?.id)
              .then(r => r.success && setActiveJob(r.data))
              .catch(console.error);
          }}
        />
      )}

      <div className="bg-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Filter Custom Values</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Document Type</label>
            <Select
              value={documentType}
              onChange={setDocumentType}
              options={DOCUMENT_TYPE_OPTIONS}
              size="large"
              className="w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, field key, or value"
              size="large"
            />
          </div>
        </div>
      </div>

      {error && (
        <Alert type="error" message="Error loading custom values" description={error} showIcon />
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading custom values…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-gradient-to-br from-gray-50 to-white rounded-xl border-2 border-dashed border-gray-300">
          <div className="text-5xl mb-4">🔖</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Custom Values Found</h3>
          <p className="text-gray-500">Try a different document type or clear your search</p>
        </div>
      ) : (
        <div className="bg-white border-1 border-solid border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-left px-4 py-2 font-semibold">Field Key</th>
                <th className="text-left px-4 py-2 font-semibold">Value</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">{v.name || '—'}</td>
                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">{v.fieldKey || '—'}</td>
                  <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{v.value || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{v.documentType || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {CSV_HEADERS.map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
