import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Input, Checkbox, Tooltip, message as antMessage, Spin } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function NotesTab() {
  const { location } = useAuth();

  // Export modal state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [exportMode, setExportMode] = useState(null); // 'selected' | 'all'

  // Contacts list state
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allLoaded, setAllLoaded] = useState([]);  // full 100-contact list
  const searchTimeout = useRef(null);

  // Active contact (for notes preview)
  const [activeContactId, setActiveContactId] = useState(null);
  const [activeContact, setActiveContact] = useState(null);

  // Checked contacts (for multi-export)
  const [checkedIds, setCheckedIds] = useState([]);

  // Notes preview
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState(null);

  // Load 100 contacts on mount
  useEffect(() => {
    if (!location?.id) return;
    loadInitialContacts();
  }, [location?.id]);

  const loadInitialContacts = async () => {
    setContactsLoading(true);
    try {
      const res = await contactsAPI.search(location.id, '', 100);
      if (res.success) {
        const list = res.data.contacts || [];
        setAllLoaded(list);
        setContacts(list);
        // Default: select first contact
        if (list.length > 0) {
          setActiveContactId(list[0].id);
          setActiveContact(list[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      setContactsLoading(false);
    }
  };

  // Client-side filter on search query; call API if not found locally
  const handleSearch = (query) => {
    setSearchQuery(query);
    clearTimeout(searchTimeout.current);

    if (!query.trim()) {
      setContacts(allLoaded);
      return;
    }

    // Filter locally first
    const q = query.toLowerCase();
    const local = allLoaded.filter(c => {
      const name = getContactName(c).toLowerCase();
      const email = (c.email || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q);
    });
    setContacts(local);

    // If few local results, also call API
    if (local.length < 5) {
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await contactsAPI.search(location.id, query, 20);
          if (res.success) {
            const apiResults = res.data.contacts || [];
            // Merge with local (deduplicate by id)
            const merged = [...local];
            apiResults.forEach(c => {
              if (!merged.find(m => m.id === c.id)) merged.push(c);
            });
            setContacts(merged);
          }
        } catch (err) { /* silent */ }
      }, 400);
    }
  };

  // Fetch notes for active contact
  useEffect(() => {
    if (!activeContactId || !location?.id) return;
    fetchNotes(activeContactId);
  }, [activeContactId, location?.id]);

  const fetchNotes = async (contactId) => {
    setNotesLoading(true);
    setNotesError(null);
    setNotes([]);
    try {
      const res = await contactsAPI.fetchNotes(location.id, contactId);
      if (res.success) {
        setNotes(res.data.notes || []);
      }
    } catch (err) {
      setNotesError('Failed to load notes');
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
          if (res.data.status === 'completed') {
            antMessage.success('Export completed! Click Download to get your file.');
          }
        }
      } catch (err) { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const getContactName = (c) => {
    return c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown';
  };

  const toggleCheck = (contactId) => {
    setCheckedIds(prev =>
      prev.includes(contactId) ? prev.filter(id => id !== contactId) : [...prev, contactId]
    );
  };

  const toggleCheckAll = () => {
    if (checkedIds.length === contacts.length) {
      setCheckedIds([]);
    } else {
      setCheckedIds(contacts.map(c => c.id));
    }
  };

  const buildFilters = (mode) => {
    if (mode === 'all') return {};
    if (checkedIds.length === 1) return { contactId: checkedIds[0] };
    if (checkedIds.length > 1) return { contactIds: checkedIds };
    return {};
  };

  const handleGetEstimate = async (mode) => {
    setExportMode(mode);
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'notes', buildFilters(mode));
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
      const res = await billingAPI.chargeAndExport(
        location.id, 'notes', format, buildFilters(exportMode), notificationEmail
      );
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
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const checkedCount = checkedIds.length;
  const allChecked = contacts.length > 0 && checkedIds.length === contacts.length;
  const indeterminate = checkedIds.length > 0 && checkedIds.length < contacts.length;

  const formatDate = (val) => {
    if (!val) return '—';
    try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  return (
    <div className="space-y-4">
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
            {checkedCount > 0
              ? `${checkedCount} contact${checkedCount > 1 ? 's' : ''} selected`
              : 'Click a contact to preview notes · Check contacts to export selected'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {checkedCount > 0 && (
            <Button
              onClick={() => handleGetEstimate('selected')}
              disabled={isExporting}
              size="large"
              type="primary"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
            >
              Export Selected ({checkedCount})
            </Button>
          )}
          <Button
            onClick={() => handleGetEstimate('all')}
            disabled={isExporting}
            size="large"
            type={checkedCount > 0 ? 'default' : 'primary'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Export All Notes
          </Button>
          <Tooltip title={<div style={{ fontSize: '13px', lineHeight: '1.6' }}><strong>Pay-per-use</strong><br />$0.002 per note. No volume discounts.<br />All Notes estimate is based on sampling.</div>} placement="left">
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

      {/* Two-column layout */}
      <div className="flex gap-4" style={{ minHeight: '520px' }}>

        {/* Left: Contact list */}
        <div className="w-80 flex-shrink-0 border border-gray-200 rounded-xl bg-white flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-gray-100">
            <Input
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              prefix={
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              allowClear
            />
          </div>

          {/* Select all */}
          {contacts.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
              <Checkbox
                checked={allChecked}
                indeterminate={indeterminate}
                onChange={toggleCheckAll}
              />
              <span className="text-xs text-gray-500">
                {allChecked ? 'Deselect all' : `Select all (${contacts.length})`}
              </span>
            </div>
          )}

          {/* Contact rows */}
          <div className="flex-1 overflow-y-auto">
            {contactsLoading ? (
              <div className="flex items-center justify-center h-32">
                <Spin size="small" />
                <span className="ml-2 text-sm text-gray-400">Loading contacts...</span>
              </div>
            ) : contacts.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                No contacts found
              </div>
            ) : (
              contacts.map(contact => {
                const isActive = contact.id === activeContactId;
                const isChecked = checkedIds.includes(contact.id);
                const name = getContactName(contact);
                return (
                  <div
                    key={contact.id}
                    onClick={() => {
                      setActiveContactId(contact.id);
                      setActiveContact(contact);
                    }}
                    className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-50 transition-colors ${
                      isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div onClick={e => { e.stopPropagation(); toggleCheck(contact.id); }}>
                      <Checkbox checked={isChecked} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                        {name}
                      </div>
                      {contact.email && (
                        <div className="text-xs text-gray-400 truncate">{contact.email}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-400">
            Showing {contacts.length} contacts · <strong>$0.002</strong>/note
          </div>
        </div>

        {/* Right: Notes preview */}
        <div className="flex-1 border border-gray-200 rounded-xl bg-white flex flex-col overflow-hidden">
          {/* Notes header */}
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            {activeContact ? (
              <>
                <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-700 font-bold text-xs">
                    {getContactName(activeContact).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800">{getContactName(activeContact)}</span>
                  {activeContact.email && (
                    <span className="text-xs text-gray-400 ml-2">{activeContact.email}</span>
                  )}
                </div>
                {!notesLoading && (
                  <span className="ml-auto text-xs text-gray-400">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
                )}
              </>
            ) : (
              <span className="text-sm text-gray-400">Select a contact to preview notes</span>
            )}
          </div>

          {/* Notes body */}
          <div className="flex-1 overflow-y-auto p-4">
            {!activeContactId ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg className="w-12 h-12 mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">Click a contact on the left to see their notes</p>
              </div>
            ) : notesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Spin />
                <span className="ml-3 text-sm text-gray-400">Loading notes...</span>
              </div>
            ) : notesError ? (
              <div className="flex items-center justify-center h-32 text-sm text-red-500">{notesError}</div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <p className="text-sm">No notes for this contact</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notes.map((note, i) => (
                  <div key={note.id || i} className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.body || '—'}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>{formatDate(note.dateAdded)}</span>
                      {note.createdBy && <span>by {note.createdBy}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Columns footer */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-medium">Export columns:</span>
            {['NoteID', 'ContactID', 'ContactName', 'Body', 'DateAdded', 'CreatedBy'].map(col => (
              <span key={col} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-mono rounded">
                {col}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Export All info */}
      {!checkedCount && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
          <strong>Export All Notes:</strong> Estimate is based on sampling a subset of contacts. The exact count (and charge) is determined after fetching all contact notes during export.
        </div>
      )}
    </div>
  );
}
