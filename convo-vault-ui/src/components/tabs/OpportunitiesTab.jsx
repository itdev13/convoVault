import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Select, DatePicker, Input, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

export default function OpportunitiesTab() {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    pipelineId: '',
    pipelineStageId: '',
    status: '',
    query: '',
    startDate: '',
    endDate: ''
  });
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Fetch pipelines on mount
  useEffect(() => {
    if (!location?.id) return;
    const fetchPipelines = async () => {
      setLoadingPipelines(true);
      try {
        const response = await billingAPI.getPipelines(location.id);
        if (response.success) {
          setPipelines(response.data.pipelines || []);
        }
      } catch (err) {
        console.error('Failed to fetch pipelines:', err);
      } finally {
        setLoadingPipelines(false);
      }
    };
    fetchPipelines();
  }, [location?.id]);

  // Update stages when pipeline changes
  useEffect(() => {
    if (filters.pipelineId) {
      const pipeline = pipelines.find(p => p.id === filters.pipelineId);
      setStages(pipeline?.stages || []);
    } else {
      setStages([]);
    }
    setFilters(prev => ({ ...prev, pipelineStageId: '' }));
  }, [filters.pipelineId, pipelines]);

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
    if (filters.pipelineId) exportFilters.pipelineId = filters.pipelineId;
    if (filters.pipelineStageId) exportFilters.pipelineStageId = filters.pipelineStageId;
    if (filters.status) exportFilters.status = filters.status;
    if (filters.query) exportFilters.query = filters.query;
    if (filters.startDate) {
      exportFilters.startDate = dayjs(filters.startDate).startOf('day').valueOf();
    }
    if (filters.endDate) {
      exportFilters.endDate = dayjs(filters.endDate).endOf('day').valueOf();
    }
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
      const response = await billingAPI.getEstimate(location.id, 'opportunities', exportFilters);
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
        'opportunities',
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
        exportType="opportunities"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Opportunities</h2>
          <p className="text-sm text-gray-500 mt-1">Export opportunities from this sub-account</p>
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
            Export Opportunities
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pipeline */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Pipeline</label>
            <Select
              value={filters.pipelineId || undefined}
              onChange={(value) => setFilters(prev => ({ ...prev, pipelineId: value || '' }))}
              placeholder="All Pipelines"
              allowClear
              loading={loadingPipelines}
              className="w-full"
              size="middle"
            >
              {pipelines.map(p => (
                <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
              ))}
            </Select>
          </div>

          {/* Stage */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stage</label>
            <Select
              value={filters.pipelineStageId || undefined}
              onChange={(value) => setFilters(prev => ({ ...prev, pipelineStageId: value || '' }))}
              placeholder="All Stages"
              allowClear
              disabled={!filters.pipelineId}
              className="w-full"
              size="middle"
            >
              {stages.map(s => (
                <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>
              ))}
            </Select>
          </div>

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
              <Select.Option value="open">Open</Select.Option>
              <Select.Option value="won">Won</Select.Option>
              <Select.Option value="lost">Lost</Select.Option>
              <Select.Option value="abandoned">Abandoned</Select.Option>
            </Select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <DatePicker
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={(date) => setFilters(prev => ({ ...prev, startDate: date ? date.format('YYYY-MM-DD') : '' }))}
              className="w-full"
              size="middle"
              placeholder="From date"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <DatePicker
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={(date) => setFilters(prev => ({ ...prev, endDate: date ? date.format('YYYY-MM-DD') : '' }))}
              className="w-full"
              size="middle"
              placeholder="To date"
            />
          </div>

          {/* Search Query */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <Input
              value={filters.query}
              onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
              placeholder="Search opportunities..."
              size="middle"
              allowClear
            />
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
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">💰</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">How Opportunities Export Works</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">1.</span>
                <span>We search all opportunities in your sub-account matching your filters</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">2.</span>
                <span>Each opportunity is exported with pipeline, stage, monetary value, contact details, and status</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">3.</span>
                <span>Data is exported into a CSV or JSON file</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">4.</span>
                <span>You receive an email with a download link when ready</span>
              </li>
            </ul>
          </div>
        </div>

      </div>

      {/* CSV Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['OpportunityID', 'Name', 'MonetaryValue', 'PipelineId', 'PipelineStageId', 'Status', 'Source', 'ContactId', 'ContactName', 'ContactEmail', 'ContactPhone', 'AssignedTo', 'LostReasonId', 'CreatedAt', 'UpdatedAt', 'LastStatusChangeAt', 'LastStageChangeAt'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
