import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Select, Tooltip, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function SocialPostsTab() {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    status: '',
    type: ''
  });
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Poll active job status
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (response.success) {
          setActiveJob(response.data);
          if (response.data.status === 'completed') {
            antMessage.success('Export completed! Click Download to get your file.');
          }
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  // Build export filters
  const buildExportFilters = () => {
    const exportFilters = {};
    if (filters.status) exportFilters.status = filters.status;
    if (filters.type) exportFilters.type = filters.type;
    return exportFilters;
  };

  // Handle get estimate
  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);

    try {
      const exportFilters = buildExportFilters();
      const response = await billingAPI.getEstimate(location.id, 'socialPosts', exportFilters);
      if (response.success) {
        setEstimate(response.data.estimate);
      } else {
        setEstimateError(response.error || 'Failed to calculate estimate');
      }
    } catch (err) {
      setEstimateError(err.message || 'Failed to calculate estimate');
    } finally {
      setEstimating(false);
    }
  };

  // Handle pay and export
  const handlePayAndExport = async (notificationEmail, format = 'csv') => {
    setProcessing(true);
    setEstimateError(null);

    try {
      const exportFilters = buildExportFilters();
      const response = await billingAPI.chargeAndExport(
        location.id,
        'socialPosts',
        format,
        exportFilters,
        notificationEmail
      );

      if (response.success) {
        setActiveJob({
          jobId: response.data.jobId,
          status: response.data.status,
          totalItems: response.data.totalItems,
          progress: { total: response.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success('Export started! We\'ll process it in the background.');
      } else {
        setEstimateError(response.error || 'Export failed');
      }
    } catch (err) {
      setEstimateError(err.message || 'Export failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Estimate Modal */}
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="socialPosts"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Social Planner Posts</h2>
          <p className="text-sm text-gray-500 mt-1">Export social media posts from this sub-account</p>
        </div>
        <div className="flex items-center gap-2">
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
            Export Social Posts
          </Button>
          <Tooltip
            title={
              <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Pay-per-use export</strong>
                <br />
                $0.002 per post. Volume discounts apply.
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

      {/* Filters */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <Select
              value={filters.status || undefined}
              onChange={(value) => setFilters(prev => ({ ...prev, status: value || '' }))}
              placeholder="All Statuses"
              allowClear
              className="w-full"
              size="middle"
            >
              <Select.Option value="published">Published</Select.Option>
              <Select.Option value="scheduled">Scheduled</Select.Option>
              <Select.Option value="draft">Draft</Select.Option>
              <Select.Option value="failed">Failed</Select.Option>
            </Select>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <Select
              value={filters.type || undefined}
              onChange={(value) => setFilters(prev => ({ ...prev, type: value || '' }))}
              placeholder="All Types"
              allowClear
              className="w-full"
              size="middle"
            >
              <Select.Option value="post">Post</Select.Option>
              <Select.Option value="story">Story</Select.Option>
              <Select.Option value="reel">Reel</Select.Option>
            </Select>
          </div>
        </div>
      </div>

      {/* Active Export Job Progress */}
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

      {/* Info Card */}
      <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">📱</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">How Social Posts Export Works</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-pink-500 mt-0.5">1.</span>
                <span>We fetch all social media posts from your sub-account matching your filters</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-pink-500 mt-0.5">2.</span>
                <span>Each post is exported with content, status, platforms, and scheduling details</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-pink-500 mt-0.5">3.</span>
                <span>Data is exported into a CSV or JSON file</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-pink-500 mt-0.5">4.</span>
                <span>You receive an email with a download link when ready</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 bg-white/60 rounded-lg p-4 border border-pink-100">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Pricing</h4>
          <div className="flex items-center gap-6 text-sm text-gray-700">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span><strong>$0.002</strong> per post (0.2 cents)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
              <span>Volume discounts apply</span>
            </div>
          </div>
        </div>

        <div className="mt-3 bg-pink-50 border border-pink-200 rounded-lg p-3">
          <p className="text-xs text-pink-800">
            <strong>Volume Discounts:</strong> 1,000-2,000: 20% off | 2,000-5,000: 40% off | 5,000-30,000: 50% off | 30,000+: 70% off
          </p>
        </div>
      </div>

      {/* CSV Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['PostID', 'Summary', 'Type', 'Status', 'Platforms', 'ScheduledAt', 'PublishedAt', 'CreatedAt', 'UpdatedAt'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
