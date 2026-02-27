import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { conversationsAPI } from '../../api/conversations';
import { billingAPI } from '../../api/billing';
import { DatePicker, Select, Button, Tooltip, message, Input } from 'antd';
import { useErrorModal } from '../ErrorModal';
import { useInfoModal } from '../InfoModal';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import { copyToClipboard } from '../../utils/clipboard';
import dayjs from 'dayjs';
import { getMessageTypeDisplay } from '../../utils/messageTypes';

// Default date range: 6 months
const getDefaultDates = () => ({
  startDate: dayjs().subtract(6, 'month').format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD')
});

export default function ConversationsTab({ onSelectConversation }) {
  const { location } = useAuth();
  const defaultDates = getDefaultDates();
  const [filters, setFilters] = useState({
    limit: 20,
    startDate: defaultDates.startDate,
    endDate: defaultDates.endDate,
    query: '',  // Universal search across multiple fields
    id: '',
    contactId: '',  // Filter by specific contact
    lastMessageType: '',
    lastMessageDirection: '',
    status: '',
    lastMessageAction: '',
    sortBy: 'last_message_date'
  });
  const [appliedFilters, setAppliedFilters] = useState({
    limit: 20,
    startDate: defaultDates.startDate,
    endDate: defaultDates.endDate,
    query: '',
    id: '',
    contactId: '',
    lastMessageType: '',
    lastMessageDirection: '',
    status: '',
    lastMessageAction: '',
    sortBy: 'last_message_date'
  }); // Filters actually used for API
  const [shouldFetch, setShouldFetch] = useState(true); // Trigger for initial load
  const [searchTimestamp, setSearchTimestamp] = useState(Date.now()); // Force refetch even with same filters
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const { showError, ErrorModalComponent } = useErrorModal();
  const { showInfo, InfoModalComponent } = useInfoModal();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['conversations', location?.id, appliedFilters, shouldFetch, searchTimestamp],
    queryFn: async () => {
      try {
        return await conversationsAPI.download(location.id, appliedFilters);
      } catch (error) {
        // Handle 400 errors as "no results"
        if (error.message?.includes('400') || error.message?.includes('Bad Request')) {
          throw new Error('NO_RESULTS_FOUND');
        }
        throw error;
      }
    },
    enabled: !!location?.id && shouldFetch, // Load on tab open or when search is clicked
    cacheTime: 0, // Don't cache - always fetch fresh
    staleTime: 0, // Data is immediately stale
    refetchOnMount: 'always', // Always refetch on mount
    refetchOnWindowFocus: false, // Don't refetch on window focus
    retry: false // Don't retry on error
  });

  // When appliedFilters changes, enable fetch
  useEffect(() => {
    if (JSON.stringify(appliedFilters) !== JSON.stringify(filters)) {
      // Filters were applied via Search button
      setShouldFetch(true);
    }
  }, [appliedFilters]);

  const conversations = data?.data?.conversations || [];

  // Helper to safely format dates
  const formatDate = (dateValue) => {
    if (!dateValue) return '';
    
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) {
        return '';
      }
      
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return '';
    }
  };

  // Poll active job status
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (response.success) {
          setActiveJob(response.data);
          if (['completed', 'failed'].includes(response.data.status)) {
            if (response.data.status === 'completed') {
              message.success('Export completed! Click Download to get your file.');
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  // Track if using default dates for export
  const [usingDefaultDates, setUsingDefaultDates] = useState(false);

  // Handle get estimate - opens modal and fetches estimate
  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);

    // Check if user selected dates - if not, use last 31 days
    const hasUserDates = filters.startDate || filters.endDate;
    setUsingDefaultDates(!hasUserDates);

    // Calculate default dates (last 31 days) if user didn't select any
    const defaultEndDate = dayjs().endOf('day');
    const defaultStartDate = dayjs().subtract(6, 'month').startOf('day');

    try {
      // Build export filters with all conversation filter options
      const exportFilters = {
        startDate: filters.startDate
          ? dayjs(filters.startDate).startOf('day').valueOf()
          : defaultStartDate.valueOf(),
        endDate: filters.endDate
          ? dayjs(filters.endDate).endOf('day').valueOf()
          : defaultEndDate.valueOf(),
        contactId: filters.contactId || undefined,
        id: filters.id || undefined,
        query: filters.query || undefined,
        lastMessageType: filters.lastMessageType || undefined,
        lastMessageDirection: filters.lastMessageDirection || undefined,
        status: filters.status || undefined,
        lastMessageAction: filters.lastMessageAction || undefined,
        sortBy: filters.sortBy || undefined
      };

      const response = await billingAPI.getEstimate(location.id, 'conversations', exportFilters);
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

    // Calculate default dates (last 31 days) if user didn't select any
    const defaultEndDate = dayjs().endOf('day');
    const defaultStartDate = dayjs().subtract(6, 'month').startOf('day');

    try {
      // Build export filters with all conversation filter options
      const exportFilters = {
        startDate: filters.startDate
          ? dayjs(filters.startDate).startOf('day').valueOf()
          : defaultStartDate.valueOf(),
        endDate: filters.endDate
          ? dayjs(filters.endDate).endOf('day').valueOf()
          : defaultEndDate.valueOf(),
        contactId: filters.contactId || undefined,
        id: filters.id || undefined,
        query: filters.query || undefined,
        lastMessageType: filters.lastMessageType || undefined,
        lastMessageDirection: filters.lastMessageDirection || undefined,
        status: filters.status || undefined,
        lastMessageAction: filters.lastMessageAction || undefined,
        sortBy: filters.sortBy || undefined
      };

      const response = await billingAPI.chargeAndExport(
        location.id,
        'conversations',
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
        message.success('Export started! We\'ll process it in the background.');
      } else {
        setEstimateError(response.error || 'Export failed');
      }
    } catch (err) {
      setEstimateError(err.message || 'Export failed');
    } finally {
      setProcessing(false);
    }
  };

  // Handle modal close
  const handleModalClose = () => {
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
  };

  return (
    <div className="space-y-6">
      {ErrorModalComponent}
      {InfoModalComponent}

      {/* Export Estimate Modal */}
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="conversations"
        usingDefaultDates={usingDefaultDates}
      />

      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Conversations</h2>
          <p className="text-sm text-slate-400 mt-1">View and manage your conversations</p>
        </div>
        <div className="flex items-center gap-3">
        {data?.data && (
          <div className="bg-blue-900/20 px-4 py-2 rounded-lg border border-blue-800">
              <div className="text-2xl font-bold text-blue-400">{data?.data?.total}</div>
            <div className="text-xs text-blue-400 font-medium">Total Conversations</div>
          </div>
        )}
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
              Export Conversations
            </Button>
            <Tooltip
              title={
                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                  <strong>Pay-per-use export</strong>
                  <br />
                  1 cent per conversation. Volume discounts up to 70%!
                </div>
              }
              placement="left"
            >
              <div className="w-6 h-6 bg-blue-900/30 rounded-full flex items-center justify-center cursor-help">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </Tooltip>
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

      {/* Filters Card */}
      <div className="bg-slate-700/50 border border-slate-600 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <h3 className="text-sm font-semibold text-slate-300">Search & Filters</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium text-slate-300">Search</label>
              <Tooltip title="Searches across: Contact Name, Email, Company Name, Tags, Last Message Body, Subject, and Reviewer Name">
                <svg className="w-4 h-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Tooltip>
            </div>
            <Input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="Search conversations..."
              size="large"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Conversation ID</label>
            <Input
              value={filters.id}
              onChange={(e) => setFilters({ ...filters, id: e.target.value })}
              placeholder="Filter by conversation ID"
              size="large"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Contact ID</label>
            <Input
              value={filters.contactId}
              onChange={(e) => setFilters({ ...filters, contactId: e.target.value })}
              placeholder="Filter by contact ID"
              size="large"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
            <DatePicker
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={(date) => setFilters({ ...filters, startDate: date ? date.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Select start date"
              format="YYYY-MM-DD"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
            <DatePicker
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={(date) => setFilters({ ...filters, endDate: date ? date.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Select end date"
              format="YYYY-MM-DD"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Last Message Type</label>
            <Select
              value={filters.lastMessageType}
              onChange={(value) => setFilters({ ...filters, lastMessageType: value })}
              className="w-full"
              size="large"
              placeholder="All Types"
              options={[
                { value: '', label: 'All Types' },
                { value: 'TYPE_SMS', label: 'SMS' },
                { value: 'TYPE_EMAIL', label: 'Email' },
                { value: 'TYPE_CALL', label: 'Call' },
                { value: 'TYPE_WHATSAPP', label: 'WhatsApp' },
                { value: 'TYPE_FACEBOOK', label: 'Facebook' },
                { value: 'TYPE_INSTAGRAM', label: 'Instagram' },
                { value: 'TYPE_GMB', label: 'Google My Business' },
                { value: 'TYPE_LIVE_CHAT', label: 'Live Chat' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Last Message Direction</label>
            <Select
              value={filters.lastMessageDirection}
              onChange={(value) => setFilters({ ...filters, lastMessageDirection: value })}
              className="w-full"
              size="large"
              placeholder="All Directions"
              options={[
                { value: '', label: 'All Directions' },
                { value: 'inbound', label: 'Inbound' },
                { value: 'outbound', label: 'Outbound' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Conversation Status</label>
            <Select
              value={filters.status}
              onChange={(value) => setFilters({ ...filters, status: value })}
              className="w-full"
              size="large"
              placeholder="All Status"
              options={[
                { value: '', label: 'All' },
                { value: 'read', label: 'Read' },
                { value: 'unread', label: 'Unread' },
                { value: 'starred', label: 'Starred' },
                { value: 'recents', label: 'Recents' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Last Message Action</label>
            <Select
              value={filters.lastMessageAction}
              onChange={(value) => setFilters({ ...filters, lastMessageAction: value })}
              className="w-full"
              size="large"
              placeholder="All Actions"
              options={[
                { value: '', label: 'All' },
                { value: 'manual', label: 'Manual' },
                { value: 'automated', label: 'Automated' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Results Limit</label>
            <Select
              value={filters.limit}
              onChange={(value) => setFilters({ ...filters, limit: value })}
              className="w-full"
              size="large"
              options={[
                { value: 20, label: '20' },
                { value: 50, label: '50' },
                { value: 100, label: '100' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Sort By</label>
            <Select
              value={filters.sortBy}
              onChange={(value) => setFilters({ ...filters, sortBy: value })}
              className="w-full"
              size="large"
              options={[
                { value: 'last_message_date', label: 'Last Message Date' },
                { value: 'last_manual_message_date', label: 'Last Manual Message' }
              ]}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setAppliedFilters({...filters}); // Apply current filters (create new object)
                setShouldFetch(true); // Enable fetch
                setSearchTimestamp(Date.now()); // Force refetch even if filters unchanged
              }}
              disabled={isLoading}
              className="w-full px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-50 font-medium"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Searching...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-900/30 mb-4">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
          </div>
          <p className="text-slate-300 font-medium">Loading conversations...</p>
          <p className="text-sm text-slate-400 mt-1">This may take a moment</p>
        </div>
      )}

      {/* No Results State */}
      {error && error.message === 'NO_RESULTS_FOUND' && (
        <div className="text-center py-20 bg-yellow-900/10 rounded-xl border-2 border-dashed border-yellow-800">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-white mb-2">No Conversations Found</h3>
          <p className="text-slate-400 mb-4">No conversations match your current filters</p>
          <div className="text-sm text-slate-500">
            <p>Try adjusting your filters or use different search criteria</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && error.message !== 'NO_RESULTS_FOUND' && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-red-900/30 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-red-300">Error Loading Conversations</h3>
            <p className="text-sm text-red-400 mt-1">{error.message}</p>
          </div>
        </div>
      )}

      {/* Conversations List */}
      {!isLoading && !error && (
        <div className="space-y-3">
          {conversations.length === 0 ? (
            <div className="text-center py-20 bg-slate-700/30 rounded-xl border-2 border-dashed border-slate-600">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-slate-700 rounded-full mb-4">
                <svg className="w-10 h-10 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">No Conversations Found</h3>
              <p className="text-slate-400">Try adjusting your filters or check back later</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className="group bg-slate-700/50 border border-slate-600 hover:border-blue-500 rounded-lg transition-all cursor-pointer"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
                        {(conv.contactName || conv.contactId || 'U')[0].toUpperCase()}
                      </div>
                      {/* Name */}
                      <h3 className="text-base font-semibold text-white group-hover:text-blue-400 transition-colors">
                        {conv.contactName || conv.contactId || 'Unknown Contact'}
                      </h3>
                      {/* Status Badge */}
                      {conv.status && conv.status !== 'N/A' && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          conv.status === 'open'
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-slate-600 text-slate-300'
                        }`}>
                          {conv.status.charAt(0).toUpperCase() + conv.status.slice(1)}
                        </span>
                      )}
                    </div>
                    {/* Date */}
                    {conv.lastMessageDate && (
                      <span className="text-xs text-slate-400">
                        {new Date(conv.lastMessageDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  
                  {/* Message Preview */}
                  <p className="text-sm text-slate-400 mb-3 line-clamp-1 pl-13">
                    {conv.lastMessageBody || 'No messages yet'}
                  </p>
                  
                  {/* Footer */}
                  <div className="flex items-center justify-between pl-13">
                    <div className="flex items-center gap-2">
                      <Tooltip title="Click to copy full ID">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            console.log('Copying ID:', conv.id);
                            const success = await copyToClipboard(conv.id);
                            console.log('Copy result:', success);
                            if (success) {
                              message.success('Conversation ID copied to clipboard!');
                            } else {
                              message.error('Failed to copy. Please select and copy manually.');
                            }
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors group/copy"
                        >
                          <span className="font-mono">ID: {conv.id}</span>
                          <svg className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </Tooltip>
                    </div>
                    <span className="text-sm text-blue-400 group-hover:text-blue-300 font-medium flex items-center gap-1">
                      View
                      <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

