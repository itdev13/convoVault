import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, DatePicker, Input, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

// Activity messages — these aren't available on the standard Messages tab,
// so the Activity Messages tab is dedicated to them.
const MESSAGE_TYPES = [
  { value: 'TYPE_ACTIVITY_APPOINTMENT', label: 'Appointment Activity' },
  { value: 'TYPE_ACTIVITY_CONTACT', label: 'Contact Activity' },
  { value: 'TYPE_ACTIVITY_INVOICE', label: 'Invoice Activity' },
  { value: 'TYPE_ACTIVITY_PAYMENT', label: 'Payment Activity' },
  { value: 'TYPE_ACTIVITY_OPPORTUNITY', label: 'Opportunity Activity' },
  { value: 'TYPE_ACTIVITY_WHATSAPP', label: 'WhatsApp Activity' },
  { value: 'TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG', label: 'Employee Action Log' },
];

const ALL_ACTIVITY_TYPES = MESSAGE_TYPES.map(t => t.value);

export default function SpecialMessagesTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [specialExportId, setSpecialExportId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Filters
  const [chatType, setChatType] = useState('');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [conversationId, setConversationId] = useState('');

  // Contact picker — at least one of {conversationId, selectedContactIds} is required;
  // walking every conversation in the sub-account was hitting GHL rate limits.
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [contactOptions, setContactOptions] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

  const getContactName = (c) =>
    c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || c?.email || c?.phone || 'Unknown';

  useEffect(() => {
    if (!location?.id) return;
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => {
        if (res.success) {
          const contacts = res.data.contacts || [];
          setContactOptions(contacts.map(c => ({
            value: c.id,
            label: `${getContactName(c)}${c.email ? ` — ${c.email}` : c.phone ? ` — ${c.phone}` : ''}`,
          })));
        }
      })
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, [location?.id]);

  const handleContactSearch = (query) => {
    clearTimeout(searchTimeoutRef.current);
    if (!query || !query.trim()) return;
    searchTimeoutRef.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const res = await contactsAPI.search(location.id, query, 20);
        if (res.success) {
          const apiResults = res.data.contacts || [];
          setContactOptions(prev => {
            const seen = new Set(prev.map(o => o.value));
            const merged = [...prev];
            for (const c of apiResults) {
              if (!seen.has(c.id)) {
                merged.push({
                  value: c.id,
                  label: `${getContactName(c)}${c.email ? ` — ${c.email}` : c.phone ? ` — ${c.phone}` : ''}`,
                });
              }
            }
            return merged;
          });
        }
      } catch {}
      finally { setContactsLoading(false); }
    }, 400);
  };

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
    // Single type → string; "All" (none selected) → array of every activity type
    f.type = chatType ? chatType : ALL_ACTIVITY_TYPES;
    if (startDate) f.startDate = dayjs(startDate).startOf('day').valueOf();
    if (endDate) f.endDate = dayjs(endDate).endOf('day').valueOf();
    const trimmedConvoId = conversationId.trim();
    if (trimmedConvoId) f.conversationId = trimmedConvoId;
    if (selectedContactIds.length > 0) f.contactIds = selectedContactIds;
    return f;
  };

  const handleGetEstimate = async () => {
    const trimmedConvoId = conversationId.trim();
    if (!trimmedConvoId && selectedContactIds.length === 0) {
      antMessage.warning('Enter a conversation ID or pick at least one contact to scope the export.');
      return;
    }
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const response = await billingAPI.getEstimate(location.id, 'specialTabMessages', buildExportFilters());
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
      const response = await billingAPI.chargeAndExport(location.id, 'specialTabMessages', format, filters, notificationEmail);
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
        exportType="specialTabMessages"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Activity Messages</h2>
          <p className="text-sm text-gray-500 mt-1">Export appointment, contact, invoice, payment, opportunity, WhatsApp, and employee-action activity logs — types not available on the standard Messages tab. Scope by conversation ID or contact(s) to avoid hitting GHL rate limits.</p>
        </div>
      </div>

      {/* Active Export Progress */}
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

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-gray-900">Filters</span>
        </div>

        {/* Scope — at least one required. Direct conversationId is fastest; contact picker walks
            only the selected contacts' conversations. The whole-sub-account walk was removed because
            it routinely hit GHL rate limits on large accounts. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Conversation ID <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Input
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="Paste a single conversation ID"
              size="large"
              allowClear
            />
            <p className="text-xs text-gray-500 mt-1">Fastest path — skips conversation discovery entirely.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contacts <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Select
              mode="multiple"
              allowClear
              showSearch
              value={selectedContactIds}
              onChange={setSelectedContactIds}
              onSearch={handleContactSearch}
              optionFilterProp="label"
              loading={contactsLoading}
              placeholder="Search and select contact(s)"
              options={contactOptions}
              style={{ width: '100%' }}
              size="large"
              maxTagCount="responsive"
              notFoundContent={contactsLoading ? 'Searching…' : 'No contacts found — try typing a name or email'}
            />
            <p className="text-xs text-gray-500 mt-1">
              {selectedContactIds.length > 0
                ? <><strong>{selectedContactIds.length}</strong> selected. We'll walk only these contacts' conversations.</>
                : 'Walks only the selected contacts\' conversations.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Message Type</label>
            <Select
              value={chatType || undefined}
              onChange={(val) => setChatType(val || '')}
              options={MESSAGE_TYPES}
              className="w-full"
              size="large"
              showSearch
              optionFilterProp="label"
              placeholder="Select message type"
              allowClear
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="Select start date"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="Select end date"
            />
          </div>

          <div>
            <Button
              type="primary"
              size="large"
              onClick={handleGetEstimate}
              loading={estimating}
              disabled={!location?.id || (!conversationId.trim() && selectedContactIds.length === 0)}
              className="bg-green-600 hover:bg-green-700 border-green-600"
            >
              Get Estimate & Export
            </Button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            {conversationId.trim()
              ? <>Fetching messages from <strong>1 conversation</strong></>
              : selectedContactIds.length > 0
                ? <>Walking conversations for <strong>{selectedContactIds.length}</strong> selected contact{selectedContactIds.length === 1 ? '' : 's'}</>
                : <>Pick a conversation ID <em>or</em> at least one contact to begin</>
            }
            {chatType
              ? <> · filtering to <strong>{MESSAGE_TYPES.find(t => t.value === chatType)?.label || chatType}</strong></>
              : <> · fetching <strong>all {ALL_ACTIVITY_TYPES.length} activity types</strong></>
            }. Export delivered as CSV. Pricing: <strong>$0.018 per message</strong> (no volume discount).
          </p>
        </div>
      </div>
    </div>
  );
}
