import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { exportAPI } from '../../api/export';
import { billingAPI } from '../../api/billing';
import { Button, Input, DatePicker, message as antMessage, Tooltip } from 'antd';
import { useErrorModal } from '../ErrorModal';
import { useInfoModal } from '../InfoModal';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

const getDefaultDates = () => ({
  startDate: dayjs().subtract(6, 'month').format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD')
});

export default function ExportContactsTab() {
  const { location } = useAuth();
  const defaultDates = getDefaultDates();

  const [filters, setFilters] = useState({
    query: '',
    tag: '',
    startDate: defaultDates.startDate,
    endDate: defaultDates.endDate,
    limit: 50
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [shouldFetch, setShouldFetch] = useState(true);
  const [searchTimestamp, setSearchTimestamp] = useState(Date.now());

  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [usingDefaultDates, setUsingDefaultDates] = useState(false);

  const { showError, ErrorModalComponent } = useErrorModal();
  const { showInfo, InfoModalComponent } = useInfoModal();

  // Load contacts list
  useEffect(() => {
    if (!location?.id || !shouldFetch) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await exportAPI.exportContacts(location.id, {
          query: appliedFilters.query || undefined,
          tag: appliedFilters.tag || undefined,
          startDate: appliedFilters.startDate || undefined,
          endDate: appliedFilters.endDate || undefined,
          limit: appliedFilters.limit
        });
        if (cancelled) return;
        if (res.success) {
          setContacts(res.data?.contacts || []);
          setTotal(res.data?.total || 0);
        } else {
          setErrorMsg(res.error || 'Failed to fetch contacts');
        }
      } catch (err) {
        if (!cancelled) setErrorMsg(err.message || 'Failed to fetch contacts');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location?.id, appliedFilters, searchTimestamp, shouldFetch]);

  // Poll active job
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

  const buildExportFilters = () => {
    const hasUserDates = filters.startDate || filters.endDate;
    setUsingDefaultDates(!hasUserDates);
    const defStart = dayjs().subtract(6, 'month').startOf('day');
    const defEnd = dayjs().endOf('day');
    return {
      query: filters.query || undefined,
      tag: filters.tag || undefined,
      startDate: filters.startDate ? dayjs(filters.startDate).startOf('day').valueOf() : defStart.valueOf(),
      endDate: filters.endDate ? dayjs(filters.endDate).endOf('day').valueOf() : defEnd.valueOf()
    };
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'contacts', buildExportFilters());
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
      const res = await billingAPI.chargeAndExport(location.id, 'contacts', format, exportFilters, notificationEmail);
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

  return (
    <div className="space-y-6">
      {ErrorModalComponent}
      {InfoModalComponent}

      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="contacts"
        usingDefaultDates={usingDefaultDates}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Contacts</h2>
          <p className="text-sm text-gray-500 mt-1">View, filter, and export all contacts from this sub-account</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-green-50 px-4 py-2 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{total.toLocaleString()}</div>
            <div className="text-xs text-green-600 font-medium">Total Contacts</div>
          </div>
          <Button
            onClick={handleGetEstimate}
            disabled={activeJob && ['pending', 'processing'].includes(activeJob.status)}
            size="large"
            type="primary"
            className="bg-green-600 hover:bg-green-700 border-green-600"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Export Contacts
          </Button>
          <Tooltip
            title={
              <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Pay-per-use export</strong>
                <br />
                $0.018 per contact. Volume discounts up to 70%!
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

      {/* Active Export Progress */}
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

      {/* Filters */}
      <div className="bg-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Filter Contacts</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search (name, email, phone)</label>
            <Input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="John, john@…, +1…"
              size="large"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tag</label>
            <Input
              value={filters.tag}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
              placeholder="Tag name"
              size="large"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <DatePicker
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={(d) => setFilters({ ...filters, startDate: d ? d.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Date added from"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <DatePicker
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={(d) => setFilters({ ...filters, endDate: d ? d.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Date added to"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => {
                setAppliedFilters({ ...filters });
                setShouldFetch(true);
                setSearchTimestamp(Date.now());
              }}
              type="primary"
              size="large"
              className="w-full"
              loading={isLoading}
            >
              Search
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading contacts…</p>
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 border-1 border-solid border-red-300 rounded-xl p-6">
          <h4 className="font-semibold text-red-900">Error Loading Contacts</h4>
          <p className="text-sm text-red-700 mt-1">{errorMsg}</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-20 bg-gradient-to-br from-gray-50 to-white rounded-xl border-2 border-dashed border-gray-300">
          <div className="text-5xl mb-4">👤</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Contacts Found</h3>
          <p className="text-gray-500">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="bg-white border-1 border-solid border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-left px-4 py-2 font-semibold">Email</th>
                <th className="text-left px-4 py-2 font-semibold">Phone</th>
                <th className="text-left px-4 py-2 font-semibold">Company</th>
                <th className="text-left px-4 py-2 font-semibold">Tags</th>
                <th className="text-left px-4 py-2 font-semibold">Added</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">{c.name || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{c.email || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{c.phone || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{c.companyName || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{(c.tags || []).join(', ') || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {c.dateAdded ? new Date(c.dateAdded).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
