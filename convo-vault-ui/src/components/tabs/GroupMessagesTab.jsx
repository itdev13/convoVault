import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { conversationsAPI } from '../../api/conversations';
import { Button, Select, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

/**
 * Group Messages — exports every GROUP SMS thread in the sub-account (conversationType=5).
 *
 * Group SMS is invisible to the normal message export: GHL excludes it from the default
 * conversation search, so it must be discovered explicitly. This tab discovers every group
 * thread, gathers each thread's messages, and exports them as one CSV/JSON.
 * Same per-message pricing as Activity Messages ($0.018/message, no volume discount).
 */
export default function GroupMessagesTab() {
  const { location } = useAuth();

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [specialExportId, setSpecialExportId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Group-conversation multi-select. Empty selection = export ALL group conversations.
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState([]);

  // Fetch group conversations (conversationType=5). `query` searches server-side across subject,
  // participant names/emails/phones and last message body. Empty query = most recent 100 threads.
  const fetchConversations = (query = '') => {
    if (!location?.id) return;
    setConversationsLoading(true);
    const filters = { conversationType: 5, limit: 100 };
    if (query) filters.query = query;
    conversationsAPI.search(location.id, filters)
      .then(res => {
        const list = res?.data?.conversations || res?.conversations || [];
        setConversations(list);
      })
      .catch(() => {})
      .finally(() => setConversationsLoading(false));
  };

  // Initial load.
  useEffect(() => { fetchConversations(''); }, [location?.id]);

  // Debounce the type-to-search so we hit the API at most every 400ms.
  const searchTimer = React.useRef(null);
  const handleSearch = (value) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchConversations(value.trim()), 400);
  };

  const conversationOptions = conversations.map(c => ({
    value: c.id,
    label: c.fullName || c.contactName || c.lastMessageBody?.slice(0, 40) || c.id
  }));

  // Poll active job
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
      } catch (err) { /* silent */ }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const buildExportFilters = () => ({
    conversationIds: selectedConversationIds.length > 0 ? selectedConversationIds : undefined
  });

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const response = await billingAPI.getEstimate(location.id, 'groupMessages', buildExportFilters());
      if (response.success) {
        setEstimate(response.data.estimate);
        setSpecialExportId(response.data.specialExportId || null);
      } else {
        setEstimateError(response.error || 'Failed to calculate estimate');
      }
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
      const filters = {
        ...buildExportFilters(),
        estimatedTotal: estimate?.itemCounts?.total || undefined,
        specialExportId: specialExportId || undefined
      };
      const response = await billingAPI.chargeAndExport(location.id, 'groupMessages', format, filters, notificationEmail);
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
      setEstimateError(err.code === 'INSUFFICIENT_FUNDS' ? err : (err.message || 'Export failed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (!processing) { setExportModalVisible(false); setEstimate(null); setEstimateError(null); }
  };

  return (
    <div className="space-y-6">
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimatingMessage="Finding group threads and gathering messages…"
        estimate={estimate}
        error={estimateError}
        exportType="groupMessages"
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Group Messages</h2>
          <p className="text-sm text-gray-500 mt-1">
            Export every group-SMS thread in this sub-account. Group texts are excluded from the normal
            Messages export — this tab pulls them in.
          </p>
        </div>
      </div>

      {activeJob && (
        <ExportProgress
          job={activeJob}
          onRefresh={async () => {
            try {
              const response = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
              if (response.success) setActiveJob(response.data);
            } catch {}
          }}
          onDismiss={() => setActiveJob(null)}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {/* Group conversation picker — leave empty to export ALL group conversations. */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Group Conversation</label>
          <Select
            mode="multiple"
            allowClear
            showSearch
            value={selectedConversationIds}
            onChange={setSelectedConversationIds}
            onSearch={handleSearch}
            filterOption={false}
            loading={conversationsLoading}
            placeholder="All group conversations"
            options={conversationOptions}
            style={{ width: '100%' }}
            size="large"
            maxTagCount="responsive"
            notFoundContent={conversationsLoading ? 'Loading conversations…' : 'No group conversations found'}
          />
          <p className="text-xs text-gray-500 mt-2">
            {selectedConversationIds.length > 0
              ? <>Exporting <strong>{selectedConversationIds.length}</strong> selected group conversation{selectedConversationIds.length === 1 ? '' : 's'}.</>
              : 'Type to search. Leave empty to export every group conversation in this sub-account.'}
          </p>
        </div>

        <Button
          type="primary"
          size="large"
          onClick={handleGetEstimate}
          loading={estimating}
          disabled={!location?.id}
          className="bg-green-600 hover:bg-green-700 border-green-600"
        >
          Get Estimate & Export
        </Button>

        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">
            <strong>How it works:</strong> we find every group conversation in this sub-account and gather
            all of their messages. Pricing: <strong>$0.018 / message</strong> — no volume discount.
          </p>
        </div>
      </div>
    </div>
  );
}
