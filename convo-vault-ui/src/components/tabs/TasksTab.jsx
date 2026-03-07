import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, Input, DatePicker, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

export default function TasksTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
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

  // Task filters
  const [taskName, setTaskName] = useState('');
  const [completed, setCompleted] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const getContactName = (c) =>
    c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unknown';

  // Load 100 contacts on mount
  useEffect(() => {
    if (!location?.id) return;
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => {
        if (res.success) setAllContacts(res.data.contacts || []);
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
    keepOpenRef.current = true;
    setTimeout(() => { keepOpenRef.current = false; }, 50);

    const contact = allContacts.find(c => c.id === contactId);
    if (!contact) return;
    if (selectedContacts.find(c => c.id === contactId)) {
      removeContact(contactId);
    } else {
      setSelectedContacts(prev => [...prev, {
        id: contact.id,
        name: getContactName(contact),
        email: contact.email || ''
      }]);
    }
    setDropdownValue(null);
  };

  const clearSearch = () => {
    setSearchQuery('');
    clearTimeout(searchTimeout.current);
  };

  const removeContact = (contactId) => {
    setSelectedContacts(prev => prev.filter(c => c.id !== contactId));
  };

  const clearAll = () => setSelectedContacts([]);

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
    const contactNames = Object.fromEntries(selectedContacts.map(c => [c.id, c.name]));
    const f = {
      contactIds: selectedContacts.map(c => c.id),
      contactNames
    };
    if (taskName) f.query = taskName;
    if (completed !== '') f.completed = completed === 'true';
    if (startDate || endDate) {
      f.dueDate = {};
      if (startDate) f.dueDate.gt = dayjs(startDate).startOf('day').toISOString();
      if (endDate) f.dueDate.lte = dayjs(endDate).endOf('day').toISOString();
    }
    return f;
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'tasks', getFilters());
      if (res.success) {
        setEstimate(res.data.estimate);
      } else {
        setEstimateError(res.error || 'Failed to calculate estimate');
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
      const res = await billingAPI.chargeAndExport(location.id, 'tasks', format, getFilters(), notificationEmail);
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

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);

  // Dropdown: matching contacts first, then selected-not-matching at bottom
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
        exportType="tasks"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-1">
            {selectedContacts.length > 0
              ? `${selectedContacts.length} contact${selectedContacts.length > 1 ? 's' : ''} selected`
              : 'Export tasks from this sub-account'}
          </p>
        </div>
        <Button
          onClick={handleGetEstimate}
          disabled={isExporting}
          size="large"
          type="primary"
          className="bg-green-600 hover:bg-green-700 border-green-600"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          {selectedContacts.length > 1 ? `Export ${selectedContacts.length} Contacts` : 'Export Tasks'}
        </Button>
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

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">Filters</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Contact filter */}
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Contacts</label>
            <div className="relative">
              <Select
                showSearch
                open={dropdownOpen}
                onDropdownVisibleChange={(open) => {
                  if (!open && keepOpenRef.current) return;
                  setDropdownOpen(open);
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
                        onMouseDown={(e) => { e.preventDefault(); setDropdownOpen(false); }}
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

            {/* Selected chips */}
            {selectedContacts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {selectedContacts.map(contact => (
                  <div key={contact.id} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full pl-2 pr-1.5 py-1">
                    <div className="w-4 h-4 bg-green-400 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold" style={{ fontSize: '9px' }}>
                        {contact.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-green-800">{contact.name}</span>
                    {contact.email && <span className="text-xs text-green-400 hidden sm:inline">{contact.email}</span>}
                    <button
                      onClick={() => removeContact(contact.id)}
                      className="w-4 h-4 rounded-full hover:bg-green-200 flex items-center justify-center transition-colors"
                    >
                      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

          {/* Task Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Task Name</label>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Search by task name..."
              size="large"
              allowClear
              onPressEnter={handleGetEstimate}
            />
          </div>

          {/* Completed */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <Select
              value={completed || undefined}
              onChange={(val) => setCompleted(val || '')}
              placeholder="All Tasks"
              allowClear
              style={{ width: '100%' }}
              size="large"
            >
              <Select.Option value="true">Completed</Select.Option>
              <Select.Option value="false">Incomplete</Select.Option>
            </Select>
          </div>

          {/* Due Date From */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date From</label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
              size="large"
              placeholder="From date"
            />
          </div>

          {/* Due Date To */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date To</label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
              size="large"
              placeholder="To date"
            />
          </div>

          {/* Search button */}
          <div className="md:col-span-4 flex justify-end">
            <Button
              onClick={handleGetEstimate}
              disabled={isExporting}
              size="large"
              type="primary"
              className="bg-blue-600 hover:bg-blue-700 border-blue-600 px-8"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
            >
              Search & Export
            </Button>
          </div>
        </div>
      </div>


      {/* CSV Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['TaskID', 'ContactID', 'ContactName', 'Title', 'Body', 'DueDate', 'Completed', 'AssignedTo', 'UserID', 'DateAdded'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
