import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { messagesAPI } from '../api/messages';
import { exportAPI } from '../api/export';
import { Button, Select, Tooltip } from 'antd';
import { useErrorModal } from './ErrorModal';
import { useInfoModal } from './InfoModal';
import { getMessageTypeDisplay, getMessageTypeIcon } from '../utils/messageTypes';

export default function ConversationMessages({ conversation, onBack }) {
  const { location } = useAuth();
  const [pageSize, setPageSize] = useState(20);
  const [lastMessageId, setLastMessageId] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const { showError, ErrorModalComponent } = useErrorModal();
  const { showInfo, InfoModalComponent } = useInfoModal();
  
  // Helper to safely format dates (reused in display and export)
  const formatDate = (dateValue) => {
    if (!dateValue) return 'No date';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return 'Invalid date';
      return date.toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversation-messages', conversation?.id, location?.id, pageSize, lastMessageId],
    queryFn: async () => {
      const response = await messagesAPI.get(conversation.id, location.id, {
        limit: pageSize,
        lastMessageId: lastMessageId
      });
      return response;
    },
    enabled: !!conversation && !!location?.id,
    cacheTime: 0, // Don't cache - always fetch fresh
    staleTime: 0, // Data is immediately stale
    refetchOnMount: 'always' // Always refetch on mount
  });

  const messages = data?.data?.messages || [];
  const hasMore = data?.data?.pagination?.hasMore || false;
  const nextCursor = data?.data?.pagination?.nextCursor;

  // Download ALL messages for this conversation as CSV
  // Calls API twice in parallel: once for regular messages, once for emails
  // Creates two separate CSVs with different headers
  const handleDownload = async () => {
    try {
      setDownloading(true);
      
      const exportLimit = 500;
      const timestamp = Date.now();
      const baseName = conversation.contactName || 'messages';
      
      // Fetch regular messages (without channel parameter) and emails (channel=Email) in parallel
      const fetchMessages = async (channel = null) => {
        let allMessages = [];
        let cursor = null;
        let hasMore = true;
        let batchCount = 0;
        
        while (hasMore && batchCount < 20) {
          const params = {
            conversationId: conversation.id,
            limit: exportLimit,
            cursor: cursor || undefined
          };
          
          if (channel) {
            params.channel = channel;
          }
          
          const response = await exportAPI.exportMessages(location.id, params);
          const batch = response.data.messages || [];
          allMessages = [...allMessages, ...batch];
          
          cursor = response.data.pagination?.nextCursor;
          hasMore = !!cursor && batch.length === exportLimit;
          batchCount++;
          
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        return allMessages;
      };
      
      // Fetch both in parallel
      const [regularMessages, emailMessages] = await Promise.all([
        fetchMessages(), // No channel = all non-email messages
        fetchMessages('Email') // channel=Email = email messages only
      ]);
      
      // Helper to safely format dates for CSV (detailed format)
      const formatDateForCsv = (dateValue) => {
        if (!dateValue) return '';
        try {
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) return '';
          return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          });
        } catch (e) {
          return '';
        }
      };
      
      // Create regular messages CSV
      if (regularMessages.length > 0) {
        const csvHeaders = 'Message Date,Message ID,Conversation ID,Message Type,Direction,Status,Message Body,Contact ID\n';
        const csvRows = regularMessages.map(msg => {
          const formattedDate = formatDateForCsv(msg.dateAdded);
          const message = (msg.body || '').replace(/"/g, '""').replace(/\n/g, ' ');
          return `"${formattedDate}","${msg.id}","${msg.conversationId || ''}","${msg.type || ''}","${msg.direction || ''}","${msg.status || ''}","${message}","${msg.contactId || ''}"`;
        }).join('\n');
        
        const csv = csvHeaders + csvRows;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_messages_${timestamp}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      
      // Create email messages CSV with email-specific fields
      if (emailMessages.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const csvHeaders = 'Message Date,Message ID,Conversation ID,Subject,From,To,CC,BCC,Direction,Status,Message Body,Contact ID\n';
        const csvRows = emailMessages.map(msg => {
          const formattedDate = formatDateForCsv(msg.dateAdded);
          const message = (msg.body || '').replace(/"/g, '""').replace(/\n/g, ' ');
          const subject = (msg.subject || msg.meta?.email?.subject || '').replace(/"/g, '""');
          const from = msg.from || msg.meta?.email?.from || msg.meta?.from || '';
          const to = msg.to ? (Array.isArray(msg.to) ? msg.to.join('; ') : msg.to) : msg.meta?.email?.to || msg.meta?.to || '';
          const cc = msg.cc ? (Array.isArray(msg.cc) ? msg.cc.join('; ') : msg.cc) : msg.meta?.email?.cc || '';
          const bcc = msg.bcc ? (Array.isArray(msg.bcc) ? msg.bcc.join('; ') : msg.bcc) : msg.meta?.email?.bcc || '';
          
          return `"${formattedDate}","${msg.id}","${msg.conversationId || ''}","${subject}","${from}","${to}","${cc}","${bcc}","${msg.direction || ''}","${msg.status || ''}","${message}","${msg.contactId || ''}"`;
        }).join('\n');
        
        const csv = csvHeaders + csvRows;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_emails_${timestamp}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      
      // Show detailed success message
      if (regularMessages.length === 0 && emailMessages.length === 0) {
        showInfo('No Messages', 'No messages found in this conversation.');
        return;
      }
      
      // Build details array for modal
      const exportDetails = [];
      
      if (regularMessages.length > 0 && emailMessages.length > 0) {
        exportDetails.push({
          icon: '1️⃣',
          title: `${baseName}_messages_${timestamp}.csv`,
          items: [
            `${regularMessages.length} messages (SMS, WhatsApp, Calls, etc.)`
          ]
        });
        exportDetails.push({
          icon: '2️⃣',
          title: `${baseName}_emails_${timestamp}.csv`,
          items: [
            `${emailMessages.length} email messages with full metadata`,
            'Includes: Subject, From, To, CC, BCC'
          ]
        });
      } else if (regularMessages.length > 0) {
        exportDetails.push({
          icon: '📄',
          title: `${baseName}_messages_${timestamp}.csv`,
          items: [`${regularMessages.length} messages exported`]
        });
      } else {
        exportDetails.push({
          icon: '📧',
          title: `${baseName}_emails_${timestamp}.csv`,
          items: [`${emailMessages.length} email messages with metadata`]
        });
      }
      
      showInfo(
        'Export Complete!',
        `Downloaded ${exportDetails.length} CSV file${exportDetails.length > 1 ? 's' : ''}:`,
        exportDetails
      );
      
    } catch (err) {
      showError('Export Failed', 'Failed to export messages from this conversation. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
   <div>hi</div>
  );
}

