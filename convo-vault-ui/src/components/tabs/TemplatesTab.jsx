import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Select, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

const TEMPLATE_LIMIT = 25;

const TYPE_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' }
];

const TYPE_COLORS = {
  email: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  sms: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  whatsapp: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' }
};

export default function TemplatesTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Filters
  const [type, setType] = useState('');

  // Preview results
  const [templates, setTemplates] = useState([]);
  const [templatesTotal, setTemplatesTotal] = useState(0);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

  // Load on mount
  useEffect(() => {
    if (!location?.id) return;
    handleSearch(1);
  }, [location?.id]);

  // Poll active job
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (res.success) {
          setActiveJob(res.data);
          if (res.data.status === 'completed') antMessage.success('Export completed! Click Download to get your file.');
        }
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const getFilters = () => {
    const f = {};
    if (type) f.type = type;
    return f;
  };

  const handleSearch = async (targetPage = 1) => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    setSearched(true);
    setPage(targetPage);
    try {
      const res = await billingAPI.searchTemplates(location.id, getFilters(), targetPage, TEMPLATE_LIMIT);
      if (res.success) {
        setTemplates(res.data.templates || []);
        setTemplatesTotal(res.data.total || 0);
      } else {
        setTemplatesError(res.error || 'Failed to load templates');
        setTemplates([]);
        setTemplatesTotal(0);
      }
    } catch (err) {
      setTemplatesError(err.message || 'Failed to load templates');
      setTemplates([]);
      setTemplatesTotal(0);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleNewSearch = () => handleSearch(1);

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'templates', getFilters());
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
      const res = await billingAPI.chargeAndExport(location.id, 'templates', format, getFilters(), notificationEmail);
      if (res.success) {
        setActiveJob({ jobId: res.data.jobId, status: res.data.status, totalItems: res.data.totalItems, progress: { total: res.data.totalItems, processed: 0, percent: 0 } });
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

  const formatDate = (val) => {
    if (!val) return null;
    try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return null; }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const totalPages = Math.ceil(templatesTotal / TEMPLATE_LIMIT);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

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
        exportType="templates"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Templates</h2>
          <p className="text-sm text-gray-500 mt-1">
            {searched && templatesTotal > 0
              ? `${templatesTotal.toLocaleString()} template${templatesTotal !== 1 ? 's' : ''} found`
              : 'Export email, SMS, and WhatsApp templates from this sub-account'}
          </p>
        </div>
        <Button
          onClick={handleGetEstimate}
          disabled={isExporting}
          size="large"
          type="primary"
          className="bg-indigo-600 hover:bg-indigo-700 border-indigo-600"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          Export Templates
        </Button>
      </div>

      {/* Active Export Progress */}
      {activeJob && (
        <ExportProgress
          job={activeJob}
          onRefresh={() => {
            billingAPI.getExportStatus(activeJob.jobId, location?.id)
              .then(res => res.success && setActiveJob(res.data))
              .catch(console.error);
          }}
        />
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter Templates
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          {/* Channel/Type */}
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Channel</label>
            <Select
              value={type || undefined}
              onChange={(val) => setType(val || '')}
              placeholder="All Channels"
              allowClear
              style={{ width: '100%' }}
              size="large"
            >
              {TYPE_OPTIONS.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
              ))}
            </Select>
          </div>

          {/* Search Button */}
          <div className="flex items-end">
            <Button
              onClick={handleNewSearch}
              loading={templatesLoading}
              size="large"
              type="primary"
              className="px-8"
              icon={!templatesLoading && (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            >
              Search
            </Button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {templatesLoading && (
        <div className="text-center py-14">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Loading templates...</p>
        </div>
      )}

      {/* Error */}
      {templatesError && !templatesLoading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-red-800 text-sm">Error loading templates</p>
            <p className="text-red-600 text-xs mt-1">{templatesError}</p>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !templatesLoading && !templatesError && templates.length === 0 && (
        <div className="text-center py-16 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border-2 border-dashed border-indigo-300">
          <div className="text-4xl mb-3">📄</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No Templates Found</h3>
          <p className="text-gray-500 text-sm mb-4">Try selecting a different channel or clear the filter</p>
          {hasPrev && (
            <Button size="small" onClick={() => handleSearch(page - 1)}>Previous Page</Button>
          )}
        </div>
      )}

      {/* Results */}
      {!templatesLoading && !templatesError && templates.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {(page - 1) * TEMPLATE_LIMIT + 1}–{Math.min(page * TEMPLATE_LIMIT, templatesTotal)} of {templatesTotal.toLocaleString()} templates
            </span>
            <div className="flex gap-2">
              <Button size="small" disabled={!hasPrev} onClick={() => handleSearch(page - 1)}>Previous</Button>
              <Button size="small" disabled={!hasNext} type="primary" onClick={() => handleSearch(page + 1)}>Next</Button>
            </div>
          </div>

          <div className="space-y-2">
            {templates.map((tpl, i) => {
              const tplType = (tpl.type || '').toLowerCase();
              const colors = TYPE_COLORS[tplType] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };

              return (
                <div key={tpl._id || i} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-medium text-sm text-gray-900">{tpl.name || '(Unnamed)'}</p>
                        {tplType && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 border ${colors.bg} ${colors.text} ${colors.border}`}>
                            {tplType.charAt(0).toUpperCase() + tplType.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        {tpl.originId && (
                          <span className="text-gray-400">Origin: {tpl.originId}</span>
                        )}
                        {tpl.dateAdded && <span>Added: {formatDate(tpl.dateAdded)}</span>}
                        {tpl.dateUpdated && <span className="ml-auto">Updated: {formatDate(tpl.dateUpdated)}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(hasPrev || hasNext) && (
            <div className="flex justify-center gap-2 pt-2">
              <Button disabled={!hasPrev} onClick={() => handleSearch(page - 1)}>Previous</Button>
              <Button disabled={!hasNext} type="primary" onClick={() => handleSearch(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Export Columns */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['TemplateID', 'Name', 'Type', 'LocationID', 'OriginID', 'DateAdded', 'DateUpdated'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
