import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { conversationsAPI } from '../../api/conversations';
import { DatePicker, InputNumber } from 'antd';
import dayjs from 'dayjs';

export default function ConversationsTab({ onSelectConversation }) {
  const { location } = useAuth();
  const [filters, setFilters] = useState({
    limit: 20,
    startDate: '',
    endDate: ''
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['conversations', location?.id, filters],
    queryFn: () => conversationsAPI.download(location.id, filters),
    enabled: !!location?.id
  });

  const conversations = data?.data?.conversations || [];

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Conversations</h2>
          <p className="text-sm text-gray-500 mt-1">View and manage your conversations</p>
        </div>
        {data?.data && (
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{conversations.length}</div>
            <div className="text-xs text-blue-600 font-medium">Total Conversations</div>
          </div>
        )}
      </div>

      {/* Filters Card */}
      <div className="bg-gradient-to-br from-gray-50 to-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-700">Filter Options</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Results Limit</label>
            <InputNumber
              value={filters.limit}
              onChange={(value) => setFilters({ ...filters, limit: value || 20 })}
              min={1}
              max={100}
              className="w-full"
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
          <div className="flex items-end">
            <button
              onClick={() => refetch()}
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

      {/* Error State */}
      {error && (
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
                {console.log(conv)}
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
                    {conv.lastMessage?.body || 'No messages yet'}
                  </p>
                  
                  {/* Footer */}
                  <div className="flex items-center justify-between pl-13">
                    <span className="text-xs text-gray-400">
                      ID: {conv.id.slice(0, 16)}...
                    </span>
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

