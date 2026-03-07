import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, message as antMessage, Spin } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function NotesTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [postExportBilling, setPostExportBilling] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contacts pool for dropdown
  const [allContacts, setAllContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [dropdownValue, setDropdownValue] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const keepOpenRef = useRef(false);
  const searchTimeout = useRef(null);

  // Selected contacts chips
  const [selectedContacts, setSelectedContacts] = useState([]);

  // Notes results — flat list with contactName attached
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);

  const getContactName = (c) =>
    c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unknown';

  // Load 100 contacts on mount, auto-select first
  useEffect(() => {
    if (!location?.id) return;
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => {
        if (res.success) {
          const list = res.data.contacts || [];
          setAllContacts(list);
          if (list.length > 0) {
            const first = list[0];
            const firstContact = { id: first.id, name: getContactName(first), email: first.email || '' };
            setSelectedContacts([firstContact]);
            // Auto-fetch notes for first contact
            setNotesLoading(true);
            contactsAPI.fetchNotes(location.id, first.id)
              .then(res2 => {
                if (res2.success) {
                  setNotes((res2.data.notes || []).map(n => ({ ...n, _contactName: firstContact.name, _contactEmail: firstContact.email, _contactId: first.id })));
                  setNotesLoaded(true);
                }
              })
              .catch(console.error)
              .finally(() => setNotesLoading(false));
          }
        }
      })
      .catch(console.error)
      .finally(() => setContactsLoading(false));
  }, [location?.id]);

  const handleContactSearch = (query) => {
    setSearchQuery(query);
    clearTimeout(searchTimeout.current);
    if (!query.trim()) return;
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

  const handleContactSelect = (contactId) => {
    // Prevent dropdown from closing after selection
    keepOpenRef.current = true;
    setTimeout(() => { keepOpenRef.current = false; }, 50);

    const contact = allContacts.find(c => c.id === contactId);
    if (!contact) return;
    if (selectedContacts.find(c => c.id === contactId)) {
      // Toggle off — remove from chips
      removeContact(contactId);
    } else {
      setSelectedContacts(prev => [...prev, {
        id: contact.id,
        name: getContactName(contact),
        email: contact.email || ''
      }]);
      setNotesLoaded(false);
    }
    setDropdownValue(null);
    // Keep search query so user can keep selecting from results
  };

  const clearSearch = () => {
    setSearchQuery('');
    clearTimeout(searchTimeout.current);
  };

  const removeContact = (contactId) => {
    setSelectedContacts(prev => prev.filter(c => c.id !== contactId));
    setNotesLoaded(false);
  };

  const clearAll = () => {
    setSelectedContacts([]);
    setNotes([]);
    setNotesLoaded(false);
  };

  // Search = fetch notes for ALL selected contacts in parallel
  const handleSearch = async () => {
    if (selectedContacts.length === 0) return;
    setNotesLoading(true);
    setNotesLoaded(false);
    setNotes([]);

    try {
      const results = await Promise.all(
        selectedContacts.map(contact =>
          contactsAPI.fetchNotes(location.id, contact.id)
            .then(res => (res.success ? res.data.notes || [] : []).map(n => ({ ...n, _contactName: contact.name, _contactEmail: contact.email, _contactId: contact.id })))
            .catch(() => [])
        )
      );
      setNotes(results.flat());
      setNotesLoaded(true);
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
    if (selectedContacts.length === 0) return {};
    const contactNames = Object.fromEntries(selectedContacts.map(c => [c.id, c.name]));
    if (selectedContacts.length === 1) return { contactId: selectedContacts[0].id, contactNames };
    return { contactIds: selectedContacts.map(c => c.id), contactNames };
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    setPostExportBilling(false);
    try {
      if (selectedContacts.length > 0 && notesLoaded) {
        // Exact count already known from loaded notes — calculate cost locally
        const count = notes.length;
        const unitPrice = 0.002;
        const finalAmount = count * unitPrice;
        setEstimate({
          itemCounts: { notes: count, total: count },
          breakdown: { notes: { count, unitPrice, subtotal: finalAmount } },
          baseAmount: finalAmount,
          discountPercent: 0,
          discountAmount: 0,
          finalAmount,
          finalAmountDollars: finalAmount
        });
      } else {
        // No contacts selected or notes not yet loaded — call API
        const res = await billingAPI.getEstimate(location.id, 'notes', getFilters());
        if (res.success) {
          if (res.data.postExportBilling) {
            setPostExportBilling(true);
          } else {
            setEstimate(res.data.estimate);
          }
        } else {
          setEstimateError(res.error || 'Failed to calculate estimate');
        }
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
    if (!processing) { setExportModalVisible(false); setEstimate(null); setEstimateError(null); setPostExportBilling(false); }
  };

  const formatDate = (val) => {
    if (!val) return '—';
    try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
  };

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const hasSelected = selectedContacts.length > 0;

  // Dropdown: matching contacts first, then selected contacts not matching (so they're always visible)
  const dropdownContacts = (() => {
    if (!searchQuery) return allContacts;
    const q = searchQuery.toLowerCase();
    const matching = allContacts.filter(c => {
      const name = getContactName(c).toLowerCase();
      const email = (c.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    const selectedNotMatching = allContacts.filter(c =>
      selectedContacts.find(s => s.id === c.id) && !matching.find(m => m.id === c.id)
    );
    return [...matching, ...selectedNotMatching];
  })();

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
        postExportBilling={postExportBilling}
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
              <div className="text-xs text-blue-500">Notes Found</div>
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
              ? selectedContacts.length === 1 ? 'Export Notes' : `Export ${selectedContacts.length} Contacts`
              : 'Export All Notes'}
          </Button>
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

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Contact <span className="text-gray-400">(optional — leave blank to export all)</span>
          </label>
          <div className="flex gap-3 items-center">
            <div className="relative" style={{ flex: 1 }}>
              <Select
                showSearch
                open={dropdownOpen}
                onDropdownVisibleChange={(open) => {
                  if (!open && keepOpenRef.current) return; // stay open after selection
                  setDropdownOpen(open);
                  if (!open && selectedContacts.length > 0) handleSearch();
                }}
                searchValue={searchQuery}
                placeholder="Search and add contacts..."
                filterOption={false}
                onSearch={handleContactSearch}
                onSelect={handleContactSelect}
                value={dropdownValue}
                loading={contactsLoading}
                style={{ width: '100%' }}
                size="large"
                notFoundContent={contactsLoading ? 'Searching...' : 'No contacts found'}
                dropdownRender={(menu) => (
                  <div>
                    {menu}
                    <div className="px-3 py-2 border-t border-gray-100 bg-white flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {selectedContacts.length > 0 ? `${selectedContacts.length} selected` : 'Click to select'}
                      </span>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); setDropdownOpen(false); if (selectedContacts.length > 0) handleSearch(); }}
                        className="text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              >
                {dropdownContacts.map(c => {
                  const isChipped = !!selectedContacts.find(s => s.id === c.id);
                  return (
                    <Select.Option key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${isChipped ? 'bg-blue-500' : 'border border-gray-300'}`}>
                          {isChipped && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className={`font-medium ${isChipped ? 'text-blue-700' : ''}`}>{getContactName(c)}</span>
                        {c.email && <span className="text-gray-400 text-xs">{c.email}</span>}
                      </div>
                    </Select.Option>
                  );
                })}
              </Select>
              {searchQuery && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); clearSearch(); }}
                  className="absolute top-1/2 -translate-y-1/2 z-10 text-gray-400 hover:text-gray-600 flex items-center justify-center w-5 h-5 rounded-full hover:bg-gray-200 transition-colors"
                  style={{ right: '32px' }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <Button
              onClick={handleSearch}
              disabled={selectedContacts.length === 0 || notesLoading}
              size="large"
              loading={notesLoading}
              icon={
                !notesLoading && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                )
              }
            >
              Search
            </Button>
          </div>

          {/* Selected chips */}
          {selectedContacts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {selectedContacts.map(contact => (
                <div key={contact.id} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full pl-2 pr-1.5 py-1">
                  <div className="w-4 h-4 bg-blue-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold" style={{ fontSize: '9px' }}>
                      {contact.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-blue-800">{contact.name}</span>
                  {contact.email && <span className="text-xs text-blue-400 hidden sm:inline">{contact.email}</span>}
                  <button
                    onClick={() => removeContact(contact.id)}
                    className="w-4 h-4 rounded-full hover:bg-blue-200 flex items-center justify-center transition-colors"
                  >
                    <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-600 transition-colors ml-1">
                Clear all
              </button>
            </div>
          )}
        </div>

        {!hasSelected && (
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-3">
            <strong>Export All:</strong> No contact selected — will export notes for all contacts. You'll be charged <strong>$0.002 per note</strong> after the export completes.
          </p>
        )}
      </div>

      {/* Notes Results */}
      {notesLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex items-center justify-center gap-3">
          <Spin />
          <span className="text-gray-400 text-sm">
            Loading notes for {selectedContacts.length} contact{selectedContacts.length > 1 ? 's' : ''}...
          </span>
        </div>
      ) : notesLoaded && (
        notes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">No notes found</p>
              <p className="text-xs text-gray-400 mt-1">
                {selectedContacts.length > 0
                  ? `The selected contact${selectedContacts.length > 1 ? 's have' : ' has'} no notes yet`
                  : 'No notes available for this location'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note, i) => (
              <div key={note.id || i} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-200 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-blue-600">{note._contactName}</span>
                        {note._contactEmail && <span className="text-xs text-gray-400">{note._contactEmail}</span>}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.body || note.bodyText || '(empty note)'}</p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                    <div>{formatDate(note.dateAdded)}</div>
                    {note.userId && <div className="mt-1 text-gray-300">by {note.userId}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Info Card */}
      {!notesLoaded && !notesLoading && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-2xl">📝</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">How Notes Export Works</h3>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">1.</span>
                  <span>Select specific contacts above, or leave blank to export all</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">2.</span>
                  <span>For each contact, we fetch all their notes</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">3.</span>
                  <span>Notes are exported with contact details and timestamps into a CSV or JSON file</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">4.</span>
                  <span>You receive an email with a download link when ready</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* CSV Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['NoteID', 'ContactID', 'ContactName', 'Body', 'UserID', 'DateAdded', 'Relations'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
