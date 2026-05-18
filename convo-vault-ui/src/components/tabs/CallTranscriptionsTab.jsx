import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function CallTranscriptionsTab() {
  const { location } = useAuth();

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [specialExportId, setSpecialExportId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contact filter — when non-empty, the backend scopes the conversation walk to just these
  // contacts; empty = whole sub-account (existing behavior).
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [contactOptions, setContactOptions] = useState([]); // [{ value, label, contact }]
  const [contactsLoading, setContactsLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

  const getContactName = (c) =>
    c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || c?.email || c?.phone || 'Unknown';

  // Load an initial pool of 100 contacts on mount, then refresh via debounced search.
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
            contact: c
          })));
        }
      })
      .catch(() => { /* silent — dropdown stays empty, user can search */ })
      .finally(() => setContactsLoading(false));
  }, [location?.id]);

  // Debounced server-side search — Select's onSearch callback. Fires while the user types.
  const handleContactSearch = (query) => {
    clearTimeout(searchTimeoutRef.current);
    if (!query || !query.trim()) return;
    searchTimeoutRef.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const res = await contactsAPI.search(location.id, query, 20);
        if (res.success) {
          const apiResults = res.data.contacts || [];
          // Merge into options, deduping by id. Keeps already-selected entries visible even when
          // the new search results don't include them.
          setContactOptions(prev => {
            const seen = new Set(prev.map(o => o.value));
            const merged = [...prev];
            for (const c of apiResults) {
              if (!seen.has(c.id)) {
                merged.push({
                  value: c.id,
                  label: `${getContactName(c)}${c.email ? ` — ${c.email}` : c.phone ? ` — ${c.phone}` : ''}`,
                  contact: c
                });
              }
            }
            return merged;
          });
        }
      } catch { /* silent */ }
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

  const buildExportFilters = () => (
    selectedContactIds.length > 0 ? { contactIds: selectedContactIds } : {}
  );

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const response = await billingAPI.getEstimate(location.id, 'callTranscriptions', buildExportFilters());
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
      const response = await billingAPI.chargeAndExport(location.id, 'callTranscriptions', format, filters, notificationEmail);
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
        exportType="callTranscriptions"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Call Transcriptions</h2>
          <p className="text-sm text-gray-500 mt-1">
            Export transcripts for completed calls in this sub-account.
          </p>
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

      {/* Action card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {/* Optional contact filter — leave empty to walk the whole sub-account (the original
            behavior); pick one or more contacts to scope the walk and shrink the bill. */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter by contacts <span className="text-gray-400 font-normal">(optional — leave empty for all)</span>
          </label>
          <Select
            mode="multiple"
            allowClear
            showSearch
            value={selectedContactIds}
            onChange={setSelectedContactIds}
            onSearch={handleContactSearch}
            filterOption={false}
            loading={contactsLoading}
            placeholder="Search and select contacts..."
            options={contactOptions}
            style={{ width: '100%' }}
            maxTagCount="responsive"
            notFoundContent={contactsLoading ? 'Searching…' : 'No contacts found — try typing a name or email'}
          />
          {selectedContactIds.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Walk will be scoped to <strong>{selectedContactIds.length}</strong> contact{selectedContactIds.length === 1 ? '' : 's'}.
            </p>
          )}
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
            <strong>Heavy task:</strong> {selectedContactIds.length > 0
              ? <>we walk conversations for the <strong>{selectedContactIds.length}</strong> selected contact{selectedContactIds.length === 1 ? '' : 's'},</>
              : <>we walk every conversation in this sub-account,</>} find call &amp; voicemail
            messages, and fetch a transcription for each one that has a recording. Depending on volume this can take a while.
            Pricing: <strong>$0.05 per transcription</strong> (no volume discount).
          </p>
        </div>
      </div>
    </div>
  );
}
