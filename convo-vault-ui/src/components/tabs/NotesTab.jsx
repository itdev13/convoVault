import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, Tooltip, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function NotesTab() {
  const { location } = useAuth();
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contact filter
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const searchTimeout = useRef(null);

  // Load initial contacts on mount
  useEffect(() => {
    if (location?.id) loadContacts('');
  }, [location?.id]);

  const loadContacts = async (query) => {
    setContactsLoading(true);
    try {
      const res = await contactsAPI.search(location.id, query, 20);
      if (res.success) setContacts(res.data.contacts || []);
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      setContactsLoading(false);
    }
  };

  const handleContactSearch = (query) => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => loadContacts(query), 400);
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

  const getFilters = () => selectedContactId ? { contactId: selectedContactId } : {};

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);

    try {
      const response = await billingAPI.getEstimate(location.id, 'notes', getFilters());
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

  const handlePayAndExport = async (notificationEmail, format = 'csv') => {
    setProcessing(true);
    setEstimateError(null);

    try {
      const response = await billingAPI.chargeAndExport(
        location.id,
        'notes',
        format,
        getFilters(),
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
        antMessage.success('Export started! We\'ll process it in the background.');
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
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
  };

  const getContactLabel = (contact) => {
    const name = contact.contactName ||
      `${contact.firstName || ''} ${contact.lastName || ''}`.trim() ||
      'Unknown';
    return contact.email ? `${name} (${contact.email})` : name;
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);

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
        exportType="notes"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Notes</h2>
          <p className="text-sm text-gray-500 mt-1">Export contact notes from this sub-account</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleGetEstimate}
            disabled={isExporting}
            size="large"
            type="primary"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Export Notes
          </Button>
          <Tooltip
            title={
              <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Pay-per-use export</strong><br />
                $0.002 per note. No volume discounts.
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

      {/* Contact Filter */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">Filter by Contact</span>
          <span className="text-xs text-gray-400">(optional — leave blank to export all)</span>
        </div>
        <Select
          showSearch
          allowClear
          placeholder="Search contacts by name or email..."
          filterOption={false}
          onSearch={handleContactSearch}
          onChange={setSelectedContactId}
          value={selectedContactId}
          loading={contactsLoading}
          style={{ width: '100%' }}
          size="large"
          notFoundContent={contactsLoading ? 'Searching...' : 'No contacts found'}
        >
          {contacts.map(c => (
            <Select.Option key={c.id} value={c.id}>
              {getContactLabel(c)}
            </Select.Option>
          ))}
        </Select>
        {selectedContactId && (
          <p className="text-xs text-blue-600 mt-2">
            ✓ Only notes for this contact will be exported (exact count available)
          </p>
        )}
        {!selectedContactId && (
          <p className="text-xs text-gray-400 mt-2">
            Exporting all contacts — estimate is based on sampling a subset of contacts
          </p>
        )}
      </div>

      {/* Pricing + Columns */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-6 text-sm text-gray-700">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span><strong>$0.002</strong> per note (0.2 cents)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
            <span>No volume discounts</span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Export Columns</p>
          <div className="flex flex-wrap gap-2">
            {['NoteID', 'ContactID', 'ContactName', 'Body', 'DateAdded', 'CreatedBy'].map((col) => (
              <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
                {col}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
