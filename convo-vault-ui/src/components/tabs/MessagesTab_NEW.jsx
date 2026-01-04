import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { exportAPI } from '../../api/export';
import { Button, Select, DatePicker, Input, InputNumber } from 'antd';
import dayjs from 'dayjs';

export default function MessagesTab() {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    channel: '',
    startDate: '',
    endDate: '',
    contactId: '',
    limit: 50
  });
  const [cursor, setCursor] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['all-messages', location?.id, filters, cursor],
    queryFn: async () => {
      const response = await exportAPI.exportMessages(location.id, {
        channel: filters.channel || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        contactId: filters.contactId || undefined,
        limit: filters.limit,
        cursor: cursor || undefined
      });
      return response;
    },
    enabled: !!location?.id
  });

  const messages = data?.data?.messages || [];
  const hasMore = !!data?.data?.nextCursor;
  const nextCursorValue = data?.data?.nextCursor;

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">All Messages</h2>
          <p className="text-sm text-gray-500 mt-1">View all messages from this sub-account</p>
        </div>
        {data?.data && (
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{messages.length}</div>
            <div className="text-xs text-blue-600 font-medium">Messages Loaded</div>
          </div>
        )}
      </div>

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
                { value: '', label: 'All Channels' },
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Page Size</label>
            <InputNumber
              value={filters.limit}
              onChange={(value) => setFilters({ ...filters, limit: value || 50 })}
              min={10}
              max={100}
              className="w-full"
              size="large"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => {
                setCursor(null);
                refetch();
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

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border-1 border-solid border-red-300 rounded-xl p-6">
          <p className="text-red-700">Error: {error.message}</p>
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
                        <span>conversationId: {message.conversationId?.slice(0, 12)}...</span>
                        <span>contactId: {message.contactId?.slice(0, 12)}...</span>
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

