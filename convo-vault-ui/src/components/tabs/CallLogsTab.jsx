import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, DatePicker, message as antMessage } from 'antd';
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

const PAGE_SIZE = 50;

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

  // Agents (for Agent filter)
  const [agentOptions, setAgentOptions] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Filters
  const [callType, setCallType] = useState('');
  const [direction, setDirection] = useState('');
  const [agentId, setAgentId] = useState('');
  const [contactId, setContactId] = useState('');
  const [actionType, setActionType] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('');

  // Preview results
  const [callLogs, setCallLogs] = useState([]);
  const [callLogsTotal, setCallLogsTotal] = useState(0);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [callLogsError, setCallLogsError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

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

  const loadAgents = useCallback(async () => {
    if (!location?.id) return;
    setAgentsLoading(true);
    try {
      const res = await billingAPI.getVoiceAIAgents(location.id);
      if (res.success) {
        setAgentOptions((res.data?.agents || []).map(a => ({
          id: a.id || a._id,
          name: a.name || a.agentName || '(Unnamed Agent)',
        })));
      }
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setAgentsLoading(false);
    }
  }, [location?.id]);

  // Load on mount
  useEffect(() => {
    if (!location?.id) return;
    handleContactSearch('');
    loadAgents();
    handleSearch(1);
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

  const handleSearch = async (targetPage = 1) => {
    setCallLogsLoading(true);
    setCallLogsError(null);
    setSearched(true);
    setPage(targetPage);
    try {
      const res = await billingAPI.searchCallLogs(location.id, buildExportFilters(), targetPage, PAGE_SIZE);
      if (res.success) {
        setCallLogs(res.data.callLogs || []);
        setCallLogsTotal(res.data.total || 0);
      } else {
        setCallLogsError(res.error || 'Failed to load call logs');
        setCallLogs([]);
        setCallLogsTotal(0);
      }
    } catch (err) {
      setCallLogsError(err.message || 'Failed to load call logs');
      setCallLogs([]);
      setCallLogsTotal(0);
    } finally {
      setCallLogsLoading(false);
    }
  };

  const handleNewSearch = () => handleSearch(1);

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

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDate = (val) => {
    if (!val) return null;
    try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return null; }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const totalPages = Math.ceil(callLogsTotal / PAGE_SIZE);
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
        exportType="callLogs"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Voice AI Call Logs</h2>
          <p className="text-sm text-gray-500 mt-1">
            {searched && callLogsTotal > 0
              ? `${callLogsTotal.toLocaleString()} call log${callLogsTotal !== 1 ? 's' : ''} found`
              : 'Export voice AI call logs from this sub-account'}
          </p>
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

          {/* Agent */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Agent</label>
            <Select
              showSearch
              value={agentId || undefined}
              onChange={(val) => setAgentId(val || '')}
              placeholder="Search agents..."
              allowClear
              loading={agentsLoading}
              filterOption={(input, option) =>
                (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
              }
              notFoundContent={agentsLoading ? 'Loading...' : 'No agents found'}
              style={{ width: '100%' }}
              size="large"
            >
              {agentOptions.map(a => (
                <Select.Option key={a.id} value={a.id}>
                  {a.name}
                </Select.Option>
              ))}
            </Select>
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

          {/* Search Button */}
          <div className="flex items-end">
            <Button
              onClick={handleNewSearch}
              loading={callLogsLoading}
              size="large"
              type="primary"
              className="px-8"
              icon={!callLogsLoading && (
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
      {callLogsLoading && (
        <div className="text-center py-14">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-violet-600 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Loading call logs...</p>
        </div>
      )}

      {/* Error */}
      {callLogsError && !callLogsLoading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-red-800 text-sm">Error loading call logs</p>
            <p className="text-red-600 text-xs mt-1">{callLogsError}</p>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !callLogsLoading && !callLogsError && callLogs.length === 0 && (
        <div className="text-center py-16 bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl border-2 border-dashed border-violet-300">
          <div className="text-4xl mb-3">📞</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No Call Logs Found</h3>
          <p className="text-gray-500 text-sm mb-4">Try adjusting your filters and search again</p>
          {hasPrev && (
            <Button size="small" onClick={() => handleSearch(page - 1)}>Previous Page</Button>
          )}
        </div>
      )}

      {/* Results */}
      {!callLogsLoading && !callLogsError && callLogs.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, callLogsTotal)} of {callLogsTotal.toLocaleString()} call logs
            </span>
            <div className="flex gap-2">
              <Button size="small" disabled={!hasPrev} onClick={() => handleSearch(page - 1)}>Previous</Button>
              <Button size="small" disabled={!hasNext} type="primary" onClick={() => handleSearch(page + 1)}>Next</Button>
            </div>
          </div>

          <div className="space-y-2">
            {callLogs.map((log, i) => (
              <div key={log.id || i} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-violet-300 hover:shadow-sm transition-all">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-violet-50 border border-violet-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-medium text-sm text-gray-900">
                        {log.fromNumber || '(No number)'}
                      </p>
                      {log.callType && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 border ${
                          log.callType === 'TRIAL'
                            ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                            : 'bg-green-50 text-green-700 border-green-200'
                        }`}>
                          {log.callType}
                        </span>
                      )}
                      {log.callStatus && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 border ${
                          log.callStatus === 'completed'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-50 text-gray-600 border-gray-200'
                        }`}>
                          {log.callStatus}
                        </span>
                      )}
                      {log.duration != null && (
                        <span className="text-xs text-gray-500 font-medium">{formatDuration(log.duration)}</span>
                      )}
                    </div>
                    {log.summary && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{log.summary}</p>
                    )}

                    {/* Extracted Data */}
                    {log.extractedData && Object.keys(log.extractedData).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(log.extractedData).map(([key, val]) => (
                          <span key={key} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                            {key}: {val}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Executed Actions */}
                    {log.executedCallActions?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {log.executedCallActions.map((a, idx) => (
                          <span key={a.actionId || idx} className="text-xs px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded">
                            {a.actionType}{a.actionName ? `: ${a.actionName}` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                      {log.contactId && <span>Contact: {log.contactId}</span>}
                      {log.agentId && <span>Agent: {agentOptions.find(a => a.id === log.agentId)?.name || log.agentId}</span>}
                      {log.createdAt && <span className="ml-auto">{formatDate(log.createdAt)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
