import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, Tooltip, message as antMessage, Spin } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function NotesTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contacts dropdown pool
  const [allContacts, setAllContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [dropdownValue, setDropdownValue] = useState(null); // controlled select value
  const searchTimeout = useRef(null);

  // Selected contacts list (chips)
  const [selectedContacts, setSelectedContacts] = useState([]); // [{ id, name, email }]

  // Notes results
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [notesForContact, setNotesForContact] = useState(null); // which contact's notes are showing

  // Load 100 contacts on mount
  useEffect(() => {
    if (!location?.id) return;
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => { if (res.success) setAllContacts(res.data.contacts || []); })
      .catch(console.error)
      .finally(() => setContactsLoading(false));
  }, [location?.id]);

  const handleContactSearch = (query) => {
    clearTimeout(searchTimeout.current);
    if (!query) return;
    searchTimeout.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const res = await contactsAPI.search(location.id, query, 20);
        if (res.success) {
          const apiResults = res.data.contacts || [];
          setAllContacts(prev => {
            const merged = [...prev];
            apiResults.forEach(c => { if (!merged.find(m => m.id === c.id)) merged.push(c); });
            return merged;
          });
        }
      } catch (err) { /* silent */ }
      finally { setContactsLoading(false); }
    }, 400);
  };

  // When user picks a contact from the dropdown — add to chips list
  const handleContactSelect = (contactId) => {
    const contact = allContacts.find(c => c.id === contactId);
    if (!contact) return;
    if (!selectedContacts.find(c => c.id === contactId)) {
      setSelectedContacts(prev => [...prev, {
        id: contact.id,
        name: getContactName(contact),
        email: contact.email || ''
      }]);
      setNotes([]);
      setNotesLoaded(false);
    }
    // Clear the select so the user can pick another
    setDropdownValue(null);
  };

  const removeContact = (contactId) => {
    setSelectedContacts(prev => prev.filter(c => c.id !== contactId));
    setNotes([]);
    setNotesLoaded(false);
    setNotesForContact(null);
  };

  const clearAll = () => {
    setSelectedContacts([]);
    setNotes([]);
    setNotesLoaded(false);
    setNotesForContact(null);
  };

  // Load notes for a single chip contact (preview)
  const handleLoadNotes = async (contactId) => {
    const contact = selectedContacts.find(c => c.id === contactId);
    setNotesLoading(true);
    setNotesLoaded(false);
    setNotesForContact(contact);
    try {
      const res = await contactsAPI.fetchNotes(location.id, contactId);
      if (res.success) {
        setNotes(res.data.notes || []);
        setNotesLoaded(true);
      }
    } catch (err) {
      antMessage.error('Failed to load notes');
    } finally {
      setNotesLoading(false);
    }
  };

  // Poll active job
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (res.success) {
          setActiveJob(res.data);
          if (res.data.status === 'completed') antMessage.success('Export completed! Click Download to get your file.');
        }
      } catch (err) { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const getFilters = () => {
    if (selectedContacts.length === 1) return { contactId: selectedContacts[0].id };
    if (selectedContacts.length > 1) return { contactIds: selectedContacts.map(c => c.id) };
    return {};
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'notes', getFilters());
      if (res.success) setEstimate(res.data.estimate);
      else setEstimateError(res.error || 'Failed to calculate estimate');
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
      const res = await billingAPI.chargeAndExport(location.id, 'notes', format, getFilters(), notificationEmail);
      if (res.success) {
        setActiveJob({
          jobId: res.data.jobId,
          status: res.data.status,
          totalItems: res.data.totalItems,
          progress: { total: res.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
      } else {
        setEstimateError(res.error || 'Export failed');
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

  const getContactName = (c) => c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unknown';

  const formatDate = (val) => {
    if (!val) return '—';
    try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const hasSelected = selectedContacts.length > 0;

  // Contacts available in dropdown = not yet added to chips
  const availableContacts = allContacts.filter(c => !selectedContacts.find(s => s.id === c.id));

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
          <p className="text-sm text-gray-500 mt-1">
            {hasSelected
              ? `${selectedContacts.length} contact${selectedContacts.length > 1 ? 's' : ''} selected`
              : 'Export all contact notes from this sub-account'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notesLoaded && notes.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-center mr-1">
              <div className="text-xl font-bold text-blue-700">{notes.length}</div>
              <div className="text-xs text-blue-500">Notes</div>
            </div>
          )}
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
            {hasSelected
              ? selectedContacts.length === 1
                ? 'Export Notes'
                : `Export ${selectedContacts.length} Contacts`
              : 'Export All Notes'}
          </Button>
          <Tooltip
            title={<div style={{ fontSize: '13px', lineHeight: '1.6' }}><strong>Pay-per-use</strong><br />$0.002 per note. No volume discounts.<br />All-contacts estimate is based on sampling.</div>}
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

      {/* Active Export Progress */}
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

      {/* Search & Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">Search & Filters</span>
        </div>

        {/* Contact dropdown */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Contact <span className="text-gray-400">(optional — leave blank to export all)</span>
          </label>
          <Select
            showSearch
            placeholder="Search and select contacts..."
            filterOption={false}
            onSearch={handleContactSearch}
            onSelect={handleContactSelect}
            value={dropdownValue}
            loading={contactsLoading}
            style={{ width: '100%' }}
            size="large"
            notFoundContent={contactsLoading ? 'Searching...' : 'No contacts found'}
          >
            {availableContacts.map(c => (
              <Select.Option key={c.id} value={c.id}>
                <span className="font-medium">{getContactName(c)}</span>
                {c.email && <span className="text-gray-400 text-xs ml-2">{c.email}</span>}
              </Select.Option>
            ))}
          </Select>

          {/* Selected contacts chips */}
          {selectedContacts.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-500">Selected contacts:</span>
                <button
                  onClick={clearAll}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedContacts.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full pl-3 pr-1.5 py-1 group"
                  >
                    <div className="w-4 h-4 bg-blue-400 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold" style={{ fontSize: '9px' }}>
                        {contact.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-blue-800">{contact.name}</span>
                    {contact.email && (
                      <span className="text-xs text-blue-400 hidden sm:inline">{contact.email}</span>
                    )}
                    <button
                      onClick={() => removeContact(contact.id)}
                      className="w-4 h-4 rounded-full hover:bg-blue-200 flex items-center justify-center transition-colors ml-0.5"
                    >
                      <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleLoadNotes(contact.id)}
                      className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-full px-2 py-0.5 ml-1 transition-colors"
                    >
                      View notes
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!hasSelected && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
            <strong>Export All:</strong> No contact selected — will export notes for all contacts. Estimate is based on sampling a subset.
          </p>
        )}
      </div>

      {/* Notes Results */}
      {notesLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex items-center justify-center gap-3">
          <Spin />
          <span className="text-gray-400 text-sm">Loading notes...</span>
        </div>
      ) : notesLoaded ? (
        <div>
          {/* Notes header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-700 font-bold text-xs">
                {notesForContact?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-sm font-semibold text-gray-700">{notesForContact?.name}</span>
            {notesForContact?.email && <span className="text-xs text-gray-400">{notesForContact.email}</span>}
            <span className="ml-auto text-xs text-gray-400">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
          </div>

          {notes.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
              <p className="text-sm">No notes for this contact</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note, i) => (
                <div key={note.id || i} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-200 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{note.body || '(empty note)'}</p>
                    </div>
                    <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                      <div>{formatDate(note.dateAdded)}</div>
                      {note.createdBy && <div className="mt-1 text-gray-300">by {note.createdBy}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Initial state */
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 text-2xl">📝</div>
            <div className="flex-1 text-sm text-gray-600">
              Search and select contacts above to preview their notes.
              Click <strong>View notes</strong> on a selected contact chip to preview.
              Or click <strong>Export All Notes</strong> to export all contacts at once.
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span><strong>$0.002</strong> per note</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
              <span>No volume discounts</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-1">
              {['NoteID', 'ContactID', 'ContactName', 'Body', 'DateAdded', 'CreatedBy'].map(col => (
                <span key={col} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-mono rounded">{col}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
