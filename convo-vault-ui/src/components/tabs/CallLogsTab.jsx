import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, DatePicker, Input, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

const ACTION_TYPES = [
  { value: 'CALL_TRANSFER', label: 'Call Transfer' },
  { value: 'DATA_EXTRACTION', label: 'Data Extraction' },
  { value: 'IN_CALL_DATA_EXTRACTION', label: 'In-Call Data Extraction' },
  { value: 'WORKFLOW_TRIGGER', label: 'Workflow Trigger' },
  { value: 'SMS', label: 'SMS' },
  { value: 'APPOINTMENT_BOOKING', label: 'Appointment Booking' },
  { value: 'CUSTOM_ACTION', label: 'Custom Action' },
  { value: 'KNOWLEDGE_BASE', label: 'Knowledge Base' },
];

export default function CallLogsTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contacts (for Contact filter)
  const [contactOptions, setContactOptions] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactSearchTimer = useRef(null);

  // Filters
  const [callType, setCallType] = useState('');
  const [direction, setDirection] = useState('');
  const [agentId, setAgentId] = useState('');
  const [contactId, setContactId] = useState('');
  const [actionType, setActionType] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('');

  const handleContactSearch = useCallback((searchText) => {
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current);
    contactSearchTimer.current = setTimeout(async () => {
      if (!location?.id) return;
      setContactsLoading(true);
      try {
        const res = await contactsAPI.search(location.id, searchText || '', 100);
        if (res.success) {
          setContactOptions((res.data?.contacts || res.contacts || []).map(c => ({
            id: c.id,
            name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || '',
            email: c.email || '',
            phone: c.phone || '',
          })));
        }
      } catch (err) {
        console.error('Contact search failed:', err);
      } finally {
        setContactsLoading(false);
      }
    }, 300);
  }, [location?.id]);

  // Load initial contacts on mount
  useEffect(() => {
    if (!location?.id) return;
    handleContactSearch('');
  }, [location?.id]);

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

  const buildExportFilters = () => {
    const f = {};
    if (callType) f.callType = callType;
    if (direction) f.direction = direction;
    if (agentId) f.agentId = agentId;
    if (contactId) f.contactId = contactId;
    if (actionType.length > 0) f.actionType = actionType.join(',');
    if (startDate) f.startDate = dayjs(startDate).startOf('day').valueOf();
    if (endDate) f.endDate = dayjs(endDate).endOf('day').valueOf();
    if (sortBy) {
      const [field, order] = sortBy.split('_');
      f.sortBy = field;
      f.sort = order;
    }
    return f;
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const response = await billingAPI.getEstimate(location.id, 'callLogs', buildExportFilters());
      if (response.success) setEstimate(response.data.estimate);
      else setEstimateError(response.error || 'Failed to calculate estimate');
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
      const response = await billingAPI.chargeAndExport(location.id, 'callLogs', format, buildExportFilters(), notificationEmail);
      if (response.success) {
        setActiveJob({
          jobId: response.data.jobId,
          status: response.data.status,
          totalItems: response.data.totalItems,
          progress: { total: response.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
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
        exportType="callLogs"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Voice AI Call Logs</h2>
          <p className="text-sm text-gray-500 mt-1">Export voice AI call logs from this sub-account</p>
        </div>
        <Button
          onClick={handleGetEstimate}
          disabled={isExporting}
          size="large"
          type="primary"
          className="bg-violet-600 hover:bg-violet-700 border-violet-600"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          Export Call Logs
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
          Filter Call Logs
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Call Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Call Type</label>
            <Select
              value={callType || undefined}
              onChange={(val) => setCallType(val || '')}
              placeholder="All Types"
              allowClear
              style={{ width: '100%' }}
              size="large"
            >
              <Select.Option value="LIVE">Live</Select.Option>
              <Select.Option value="TRIAL">Trial</Select.Option>
            </Select>
          </div>

          {/* Direction */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
            <Select
              value={direction || undefined}
              onChange={(val) => setDirection(val || '')}
              placeholder="All Directions"
              allowClear
              style={{ width: '100%' }}
              size="large"
            >
              <Select.Option value="INBOUND">Inbound</Select.Option>
              <Select.Option value="OUTBOUND">Outbound</Select.Option>
            </Select>
          </div>

          {/* Agent ID */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Agent ID</label>
            <Input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="Filter by agent ID..."
              size="large"
            />
          </div>

          {/* Contact */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact</label>
            <Select
              showSearch
              value={contactId || undefined}
              onChange={(val) => setContactId(val || '')}
              onSearch={handleContactSearch}
              placeholder="Search contacts..."
              allowClear
              loading={contactsLoading}
              filterOption={false}
              notFoundContent={contactsLoading ? 'Searching...' : 'No contacts found'}
              style={{ width: '100%' }}
              size="large"
            >
              {contactOptions.map(c => (
                <Select.Option key={c.id} value={c.id}>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm">{c.name || '(No name)'}</span>
                    {(c.email || c.phone) && (
                      <span className="text-xs text-gray-400">{c.email || c.phone}</span>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select>
          </div>

          {/* Action Type */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
            <Select
              mode="multiple"
              value={actionType}
              onChange={(val) => setActionType(val || [])}
              placeholder="All Action Types"
              allowClear
              style={{ width: '100%' }}
              size="large"
              maxTagCount="responsive"
            >
              {ACTION_TYPES.map(a => (
                <Select.Option key={a.value} value={a.value}>{a.label}</Select.Option>
              ))}
            </Select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
              size="large"
              placeholder="From"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
              size="large"
              placeholder="To"
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort By</label>
            <Select
              value={sortBy || undefined}
              onChange={(val) => setSortBy(val || '')}
              placeholder="Default (Newest)"
              allowClear
              style={{ width: '100%' }}
              size="large"
            >
              <Select.Option value="createdAt_descend">Date (Newest)</Select.Option>
              <Select.Option value="createdAt_ascend">Date (Oldest)</Select.Option>
              <Select.Option value="duration_descend">Duration (Longest)</Select.Option>
              <Select.Option value="duration_ascend">Duration (Shortest)</Select.Option>
            </Select>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-6 text-sm text-gray-700">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span><strong>$0.002</strong> per call log (0.2 cents)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-violet-500 rounded-full"></span>
            <span>Volume discounts: 1K-2K: 20% off | 2K-5K: 40% off | 5K-30K: 50% off | 30K+: 70% off</span>
          </div>
        </div>
      </div>

      {/* Export Columns */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['CallID', 'ContactID', 'AgentID', 'FromNumber', 'CallType', 'CallStatus', 'Duration', 'Summary', 'CreatedAt', 'TrialCall', 'WorkflowID', 'MessageID', 'ExtractedData', 'CallActions', 'Transcript', 'Translation'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
