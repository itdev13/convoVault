import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { exportAPI } from '../../api/export';
import { Button, Select, DatePicker, Input, Tooltip } from 'antd';
import { useErrorModal } from '../ErrorModal';
import dayjs from 'dayjs';

export default function MessagesTab() {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    channel: '',
    startDate: '',
    endDate: '',
    contactId: '',
    conversationId: '',
    limit: 50
  });
  const [cursor, setCursor] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState(filters); // Filters actually used for API
  const [shouldFetch, setShouldFetch] = useState(true); // Trigger for initial load
  const [searchTimestamp, setSearchTimestamp] = useState(Date.now()); // Force refetch even with same filters
  const { showError, ErrorModalComponent } = useErrorModal();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['all-messages', location?.id, appliedFilters, cursor, shouldFetch, searchTimestamp],
    queryFn: async () => {
      const response = await exportAPI.exportMessages(location.id, {
        channel: appliedFilters.channel || undefined,
        startDate: appliedFilters.startDate || undefined,
        endDate: appliedFilters.endDate || undefined,
        contactId: appliedFilters.contactId || undefined,
        conversationId: appliedFilters.conversationId || undefined,
        limit: appliedFilters.limit,
        cursor: cursor || undefined
      });
      
      // Check if response has no messages
      if (!response.data?.messages || response.data.messages.length === 0) {
        throw new Error('NO_RESULTS_FOUND');
      }
      
      return response;
    },
    enabled: !!location?.id && shouldFetch, // Load on tab open or when search is clicked
    cacheTime: 0, // Don't cache - always fetch fresh
    staleTime: 0, // Data is immediately stale
    refetchOnMount: 'always', // Always refetch on mount
    refetchOnWindowFocus: false, // Don't refetch on window focus
    retry: false, // Don't retry on error
    onError: (error) => {
      // Transform 400 errors to friendly message
      if (error.message?.includes('Failed to export') || 
          error.message?.includes('400') || 
          error.message?.includes('Bad Request') ||
          error.message?.includes('Internal server error')) {
        // This is likely an invalid filter, not a real error
        return;
      }
    }
  });

  // When appliedFilters changes, enable fetch
  useEffect(() => {
    if (JSON.stringify(appliedFilters) !== JSON.stringify(filters)) {
      setShouldFetch(true);
    }
  }, [appliedFilters]);

  const messages = data?.data?.messages || [];
  const hasMore = data?.data?.pagination?.hasMore || false;
  const nextCursorValue = data?.data?.pagination?.nextCursor;
  const [downloading, setDownloading] = useState(false);

  // Check if this is a "no results" situation
  const isNoResults = error && (
    error.message === 'NO_RESULTS_FOUND' ||
    error.message?.includes('Failed to export') ||
    error.message?.includes('400') ||
    error.message?.includes('Internal server error')
  );

  // Download ALL messages as CSV (fetch in batches with cursor, limit 500)
  // Note: UI shows user's selected limit, but export uses max limit (500)
  const handleDownloadCSV = async () => {
    try {
      setDownloading(true);
      
      let allMessages = [];
      let cursor = null;
      let hasMore = true;
      const exportLimit = 500; // Always use max limit for export
      let batchCount = 0;
      
      // Fetch all messages in batches using cursor pagination (ignoring UI limit filter)
      while (hasMore && batchCount < 20) { // Max 10,000 messages
        const response = await exportAPI.exportMessages(location.id, {
        channel: filters.channel || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
          contactId: filters.contactId || undefined,
          conversationId: filters.conversationId || undefined,
          limit: exportLimit, // Use 500 for export, not user's filter limit
          cursor: cursor || undefined
        });
        
        const batch = response.data.messages || [];
        allMessages = [...allMessages, ...batch];
        
        // Check for next cursor
        cursor = response.data.pagination?.nextCursor;
        hasMore = !!cursor && batch.length === batchLimit;
        batchCount++;
        
        // Small delay between requests
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Convert to CSV
      const csvHeaders = 'Date,Conversation ID,Contact ID,Type,Direction,Status,Message\n';
      const csvRows = allMessages.map(msg => {
        const formattedDate = msg.dateAdded 
          ? new Date(msg.dateAdded).toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            })
          : '';
        const message = (msg.body || '').replace(/"/g, '""').replace(/\n/g, ' ');
        return `"${formattedDate}","${msg.conversationId || ''}","${msg.contactId || ''}","${msg.type || ''}","${msg.direction || ''}","${msg.status || ''}","${message}"`;
      }).join('\n');
      
      const csv = csvHeaders + csvRows;
      
      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `messages_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
    } catch (err) {
      showError('Export Failed', 'Failed to export messages. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Messages & Export</h2>
          <p className="text-sm text-gray-500 mt-1">View, filter, and export all messages from this sub-account</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.data && (
            <div className="bg-blue-50 px-4 py-2 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{messages.length}</div>
              <div className="text-xs text-blue-600 font-medium">Messages Loaded</div>
            </div>
          )}
          <div className="flex items-center gap-2">
          <Button
            onClick={handleDownloadCSV}
            loading={downloading}
            size="large"
            type="primary"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
              {downloading ? 'Exporting...' : 'Export CSV'}
          </Button>
            <Tooltip 
              title={
                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                  <strong>Need additional fields?</strong>
                  <br />
                  Raise a request in the Support tab and we'll add them within 24 hours.
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
      </div>
      
      {/* Export Progress */}
      {downloading && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span className="text-blue-700 font-medium">
              Fetching all messages with filters... This may take a moment.
            </span>
          </div>
        </div>
      )}

      {/* Filters Card */}
      <div className="bg-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter Messages
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channel</label>
            <Select
              value={filters.channel}
              onChange={(value) => setFilters({ ...filters, channel: value })}
              className="w-full"
              size="large"
              placeholder="All Channels"
              options={[
                { value: '', label: 'All Channels Except Email' },
                { value: 'SMS', label: 'SMS' },
                { value: 'Email', label: 'Email' },
                { value: 'WhatsApp', label: 'WhatsApp' },
                { value: 'FB', label: 'Facebook' },
                { value: 'GMB', label: 'Google My Business' },
                { value: 'Call', label: 'Call' }
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <DatePicker
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={(date) => setFilters({ ...filters, startDate: date ? date.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Select start date"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <DatePicker
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={(date) => setFilters({ ...filters, endDate: date ? date.format('YYYY-MM-DD') : '' })}
              className="w-full"
              size="large"
              placeholder="Select end date"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Contact ID</label>
            <Input
              value={filters.contactId}
              onChange={(e) => setFilters({ ...filters, contactId: e.target.value })}
              placeholder="Filter by contact ID"
              size="large"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Conversation ID</label>
            <Input
              value={filters.conversationId}
              onChange={(e) => setFilters({ ...filters, conversationId: e.target.value })}
              placeholder="Filter by conversation ID"
              size="large"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Page Size</label>
            <Select
              value={filters.limit}
              onChange={(value) => setFilters({ ...filters, limit: value })}
              className="w-full"
              size="large"
              options={[
                { value: 20, label: '20' },
                { value: 50, label: '50' },
                { value: 100, label: '100' },
                { value: 200, label: '200' },
                { value: 500, label: '500' }
              ]}
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => {
                setAppliedFilters({...filters}); // Apply current filters (create new object)
                setCursor(null); // Reset pagination
                setShouldFetch(true); // Enable fetch
                setSearchTimestamp(Date.now()); // Force refetch even if filters unchanged
              }}
              type="primary"
              size="large"
              className="w-full"
              loading={isLoading}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
            >
              Search
            </Button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading messages...</p>
        </div>
      )}

      {/* No Results State */}
      {isNoResults && (
        <div className="text-center py-20 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border-2 border-dashed border-yellow-300">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Messages Found</h3>
          <p className="text-gray-600 mb-4">No messages match your current filters</p>
          <div className="text-sm text-gray-500 space-y-2">
            <p className="font-medium">Try adjusting:</p>
            <ul className="list-none space-y-1">
              {appliedFilters.conversationId && <li>• Conversation ID (check if it's correct)</li>}
              {appliedFilters.contactId && <li>• Contact ID</li>}
              {appliedFilters.channel && <li>• Channel filter</li>}
              {(appliedFilters.startDate || appliedFilters.endDate) && <li>• Date range</li>}
            </ul>
            <p className="mt-3 text-xs text-gray-400">Or clear all filters and try again</p>
          </div>
        </div>
      )}
      
      {/* Real Error State */}
      {error && !isNoResults && (
        <div className="bg-red-50 border-1 border-solid border-red-300 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-semibold text-red-900">Error Loading Messages</h4>
              <p className="text-sm text-red-700 mt-1">{error.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && !error && messages.length > 0 && (
        <div className="flex items-center justify-between bg-white border-1 border-solid border-gray-200 rounded-xl p-4">
          <span className="text-sm text-gray-600">Showing {messages.length} messages</span>
          <div className="flex gap-2">
            <Button onClick={() => setCursor(null)} disabled={!cursor} size="large">
              First Page
            </Button>
            <Button onClick={() => setCursor(nextCursorValue)} disabled={!hasMore} type="primary" size="large">
              Next Page
            </Button>
          </div>
        </div>
      )}

      {/* Messages List */}
      {!isLoading && !error && (
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="text-center py-20 bg-gradient-to-br from-gray-50 to-white rounded-xl border-2 border-dashed border-gray-300">
              <div className="text-5xl mb-4">💬</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Messages Found</h3>
              <p className="text-gray-500">Try adjusting your filters</p>
            </div>
          ) : (
            messages.map((message) => {
              const isOutbound = message.direction === 'outbound';
              return (
                <div
                  key={message.id}
                  className="bg-white border-1 border-solid border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                      isOutbound ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gray-400'
                    }`}>
                      {isOutbound ? 'You' : (message.contactId || 'C')[0].toUpperCase()}
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">
                            {isOutbound ? 'Outbound' : 'Inbound'}
                          </span>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                            {message.type || 'SMS'}
                          </span>
                          {message.status && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              message.status === 'delivered' || message.status === 'sent'
                                ? 'bg-green-100 text-green-700'
                                : message.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {message.status}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(message.dateAdded).toLocaleString()}
                        </span>
                      </div>

                      <p className="text-sm text-gray-700 mb-2">{message.body}</p>

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Conv: {message.conversationId?.slice(0, 12)}...</span>
                        <span>Contact: {message.contactId?.slice(0, 12)}...</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Footer Stats */}
      {messages.length > 0 && (
        <div className="bg-gray-50 border-1 border-solid border-gray-200 rounded-xl p-4">
          <div className="text-sm text-gray-600">
            💬 {messages.length} messages displayed • 
            {messages.filter(m => m.direction === 'inbound').length} received • 
            {messages.filter(m => m.direction === 'outbound').length} sent
            {hasMore && <span className="ml-4 text-blue-600 font-medium">• More pages available</span>}
          </div>
        </div>
      )}
    </div>
  );
}

