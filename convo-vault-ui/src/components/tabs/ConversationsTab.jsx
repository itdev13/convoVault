import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { conversationsAPI } from '../../api/conversations';
import { DatePicker, Select, Button, Tooltip, message, Input } from 'antd';
import { useErrorModal } from '../ErrorModal';
import { useInfoModal } from '../InfoModal';
import ExportModal from '../ExportModal';
import { copyToClipboard } from '../../utils/clipboard';
import dayjs from 'dayjs';
import { getMessageTypeDisplay } from '../../utils/messageTypes';

const { RangePicker } = DatePicker;

export default function ConversationsTab({ onSelectConversation }) {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    limit: 20,
    startDate: '',
    endDate: '',
    query: '',  // Universal search across multiple fields
    conversationId: '',
    contactId: '',  // Filter by specific contact
    lastMessageType: '',
    lastMessageDirection: '',
    status: '',
    lastMessageAction: '',
    sortBy: 'last_message_date'
  });
  const [downloading, setDownloading] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState(filters); // Filters actually used for API
  const [shouldFetch, setShouldFetch] = useState(true); // Trigger for initial load
  const [searchTimestamp, setSearchTimestamp] = useState(Date.now()); // Force refetch even with same filters
  const [exportModalVisible, setExportModalVisible] = useState(false);
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

  // Download conversations with date range - NO HARD LIMITS, with chunking
  const handleExport = async (dateRange) => {
    try {
      setDownloading(true);
      setExportModalVisible(false);
      
      const { startDate, endDate } = dateRange;
      
      // Convert date strings to millisecond timestamps for API (start of day to end of day)
      const startDateTimestamp = dayjs(startDate).startOf('day').valueOf(); // Returns milliseconds
      const endDateTimestamp = dayjs(endDate).endOf('day').valueOf(); // Returns milliseconds
      
      const exportLimit = 100; // Batch size for API calls
      const chunkSize = 50000; // Conversations per CSV file (chunk)
      
      let allConversations = [];
      let startAfterId = null;
      let hasMore = true;
      let totalFetched = 0;
      let chunkNumber = 1;
      const downloadedChunks = []; // Track chunk sizes
      let estimatedTotalChunks = 1; // For better naming
      
      // Fetch ALL conversations (no batch limit)
      while (hasMore) {
        const response = await conversationsAPI.download(location.id, {
          limit: exportLimit,
          query: filters.query || undefined,
          startDate: startDateTimestamp,
          endDate: endDateTimestamp,
          conversationId: filters.conversationId || undefined,
          contactId: filters.contactId || undefined,
          lastMessageType: filters.lastMessageType || undefined,
          lastMessageDirection: filters.lastMessageDirection || undefined,
          status: filters.status || undefined,
          lastMessageAction: filters.lastMessageAction || undefined,
          sortBy: filters.sortBy || undefined,
          startAfterId: startAfterId || undefined
        });
        
        const batch = response.data.conversations || [];
        allConversations = [...allConversations, ...batch];
        totalFetched += batch.length;
        
        // Get cursor for next page
        if (batch.length > 0) {
          startAfterId = batch[batch.length - 1].sort?.[0];
        }
        
        hasMore = batch.length === exportLimit;
        
        // Estimate total chunks (update as we fetch more)
        estimatedTotalChunks = Math.ceil(totalFetched / chunkSize);
        
        // If we've accumulated enough for a chunk, save it
        if (allConversations.length >= chunkSize) {
          const chunk = allConversations.splice(0, chunkSize);
          const totalChunks = estimatedTotalChunks + (allConversations.length > 0 ? 1 : 0);
          await downloadChunk(chunk, chunkNumber, totalChunks, startDate, endDate);
          downloadedChunks.push({ number: chunkNumber, size: chunk.length });
          chunkNumber++;
        }
        
        // Download remaining conversations when no more data
        if (!hasMore && allConversations.length > 0) {
          const totalChunks = chunkNumber;
          await downloadChunk(allConversations, chunkNumber, totalChunks, startDate, endDate);
          downloadedChunks.push({ number: chunkNumber, size: allConversations.length });
          allConversations = []; // Clear after download
        }
        
        // Small delay between requests to respect rate limits
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Show success message with chunk info
      if (downloadedChunks.length > 1) {
        showInfo(
          'Export Complete!',
          `Exported ${totalFetched.toLocaleString()} conversations in ${downloadedChunks.length} files:`,
          downloadedChunks.map((chunk, i) => ({
            icon: `${i + 1}️⃣`,
            title: getConversationChunkFileName(chunk.number, downloadedChunks.length, startDate, endDate),
            items: [`${chunk.size.toLocaleString()} conversations`]
          }))
        );
      } else if (downloadedChunks.length === 1) {
        message.success(`Successfully exported ${totalFetched.toLocaleString()} conversations!`);
      } else {
        message.info('No conversations found in the selected date range.');
      }
      
    } catch (error) {
      showError('Export Failed', 'Failed to export conversations. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // Generate descriptive chunk file name for conversations
  const getConversationChunkFileName = (chunkNumber, totalChunks, startDate, endDate) => {
    // startDate and endDate are already in YYYY-MM-DD format from ExportModal
    const chunkSuffix = totalChunks > 1 ? `_chunk_${String(chunkNumber).padStart(3, '0')}_of_${String(totalChunks).padStart(3, '0')}` : '';
    return `conversations_${startDate}_to_${endDate}${chunkSuffix}.csv`;
  };

  // Download a single chunk as CSV
  const downloadChunk = async (conversations, chunkNumber, totalChunks, startDate, endDate) => {
    const csvHeaders = 'Conversation ID,Created Date,Contact Name,email,phone,Contact ID,Last Message Date,Last Message Action,Last Message Direction,Last Message,Unread Count,Last Message Channel\n';
    const csvRows = conversations.map(conv => {
      const lastMessage = (conv.lastMessageBody || '').replace(/"/g, '""').replace(/\n/g, ' ');
      const formattedLastMessageDate = formatDate(conv.lastMessageDate);
      const formattedCreatedDate = formatDate(conv.dateAdded);
      return `"${conv.id}","${formattedCreatedDate}","${conv.contactName || ''}","${conv.email || ''}","${conv.phone || ''}","${conv.contactId || ''}","${formattedLastMessageDate}","${conv.lastOutboundMessageAction || ''}","${conv.lastMessageDirection || ''}","${lastMessage}","${conv.unreadCount || 0}","${getMessageTypeDisplay(conv.lastMessageType) || ''}"`;
    }).join('\n');
    
    const csv = csvHeaders + csvRows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getConversationChunkFileName(chunkNumber, totalChunks, startDate, endDate);
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    // Small delay between downloads
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  return (
    <div className="space-y-6">
      {ErrorModalComponent}
      {InfoModalComponent}
      <ExportModal
        visible={exportModalVisible}
        onCancel={() => setExportModalVisible(false)}
        onExport={handleExport}
        loading={downloading}
      />
      
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Conversations</h2>
          <p className="text-sm text-gray-500 mt-1">View and manage your conversations</p>
        </div>
        <div className="flex items-center gap-3">
        {data?.data && (
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{data?.data?.total}</div>
            <div className="text-xs text-blue-600 font-medium">Total Conversations</div>
          </div>
        )}
          {conversations.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setExportModalVisible(true)}
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
          )}
        </div>
      </div>
      
      {/* Export Progress Indicator */}
      {downloading && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <div className="flex-1">
              <span className="text-blue-700 font-medium block">
                Exporting conversations... This may take a moment for large datasets.
              </span>
              <span className="text-blue-600 text-sm block mt-1">
                Large exports will be split into multiple CSV files (chunks of 50,000 conversations each)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filters Card */}
      <div className="bg-gradient-to-br from-gray-50 to-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-700">Search & Filters</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Search</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Conversation ID</label>
            <Input
              value={filters.conversationId}
              onChange={(e) => setFilters({ ...filters, conversationId: e.target.value })}
              placeholder="Filter by conversation ID"
              size="large"
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Message Type</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Message Direction</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Conversation Status</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Message Action</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Results Limit</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
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
              className="w-full px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 font-medium"
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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
          </div>
          <p className="text-gray-600 font-medium">Loading conversations...</p>
          <p className="text-sm text-gray-500 mt-1">This may take a moment</p>
        </div>
      )}

      {/* No Results State */}
      {error && error.message === 'NO_RESULTS_FOUND' && (
        <div className="text-center py-20 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border-2 border-dashed border-yellow-300">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Conversations Found</h3>
          <p className="text-gray-600 mb-4">No conversations match your current filters</p>
          <div className="text-sm text-gray-500">
            <p>Try adjusting your filters or use different search criteria</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && error.message !== 'NO_RESULTS_FOUND' && (
        <div className="bg-red-50 border-1 border-solid border-red-300 rounded-xl p-6 flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-red-900">Error Loading Conversations</h3>
            <p className="text-sm text-red-700 mt-1">{error.message}</p>
          </div>
        </div>
      )}

      {/* Conversations List */}
      {!isLoading && !error && (
        <div className="space-y-3">
          {conversations.length === 0 ? (
            <div className="text-center py-20 bg-gradient-to-br from-gray-50 to-white rounded-xl border-2 border-dashed border-gray-300">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Conversations Found</h3>
              <p className="text-gray-500">Try adjusting your filters or check back later</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className="group bg-white border-1 border-solid border-gray-200 hover:border-blue-400 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer border-2 border-solid border-blue-100"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
                        {(conv.contactName || conv.contactId || 'U')[0].toUpperCase()}
                      </div>
                      {/* Name */}
                      <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {conv.contactName || conv.contactId || 'Unknown Contact'}
                      </h3>
                      {/* Status Badge */}
                      {conv.status && conv.status !== 'N/A' && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          conv.status === 'open' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {conv.status.charAt(0).toUpperCase() + conv.status.slice(1)}
                        </span>
                      )}
                    </div>
                    {/* Date */}
                    {conv.lastMessageDate && (
                      <span className="text-xs text-gray-500">
                        {new Date(conv.lastMessageDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  
                  {/* Message Preview */}
                  <p className="text-sm text-gray-600 mb-3 line-clamp-1 pl-13">
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
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors group/copy"
                        >
                          <span className="font-mono">ID: {conv.id}</span>
                          <svg className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </Tooltip>
                    </div>
                    <span className="text-sm text-blue-600 group-hover:text-blue-700 font-medium flex items-center gap-1">
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

