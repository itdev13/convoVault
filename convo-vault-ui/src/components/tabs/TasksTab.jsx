import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { contactsAPI } from '../../api/contacts';
import { Button, Select, Input, DatePicker, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

function MultiSelectDropdown({ label, items, selectedItems, onSelect, onRemove, onClearAll, loading, searchValue, onSearch, dropdownOpen, onDropdownVisibleChange, keepOpenRef, placeholder, chipColor = 'blue', getItemName, getItemSub }) {
  const dropdownItems = (() => {
    if (!searchValue) return items;
    const q = searchValue.toLowerCase();
    const matching = items.filter(i => getItemName(i).toLowerCase().includes(q) || (getItemSub?.(i) || '').toLowerCase().includes(q));
    const selectedNotMatching = items.filter(i => selectedItems.find(s => s.id === i.id) && !matching.find(m => m.id === i.id));
    return [...matching, ...selectedNotMatching];
  })();

  const colors = {
    blue: { chip: 'bg-blue-50 border-blue-200', dot: 'bg-blue-400', text: 'text-blue-800', x: 'text-blue-500 hover:bg-blue-200', clear: 'text-red-400 hover:text-red-600' },
    green: { chip: 'bg-green-50 border-green-200', dot: 'bg-green-400', text: 'text-green-800', x: 'text-green-500 hover:bg-green-200', clear: 'text-red-400 hover:text-red-600' },
  };
  const c = colors[chipColor] || colors.blue;

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <Select
          showSearch
          open={dropdownOpen}
          onDropdownVisibleChange={(open) => {
            if (!open && keepOpenRef.current) return;
            onDropdownVisibleChange(open);
          }}
          searchValue={searchValue}
          placeholder={placeholder}
          filterOption={false}
          onSearch={onSearch}
          onSelect={onSelect}
          value={null}
          loading={loading}
          style={{ width: '100%' }}
          size="large"
          notFoundContent={loading ? 'Searching...' : 'No results found'}
          dropdownRender={(menu) => (
            <div>
              {menu}
              <div className="px-3 py-2 border-t border-gray-100 bg-white flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {selectedItems.length > 0 ? `${selectedItems.length} selected` : 'Click to select'}
                </span>
                <button
                  onMouseDown={(e) => { e.preventDefault(); onDropdownVisibleChange(false); }}
                  className="text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        >
          {dropdownItems.map(item => {
            const isSelected = !!selectedItems.find(s => s.id === item.id);
            return (
              <Select.Option key={item.id} value={item.id}>
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-500' : 'border border-gray-300'}`}>
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`font-medium ${isSelected ? 'text-blue-700' : ''}`}>{getItemName(item)}</span>
                  {getItemSub?.(item) && <span className="text-gray-400 text-xs truncate max-w-[120px]">{getItemSub(item)}</span>}
                </div>
              </Select.Option>
            );
          })}
        </Select>
      </div>
      {selectedItems.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          {selectedItems.map(item => (
            <div key={item.id} className={`flex items-center gap-1 border rounded-full pl-2 pr-1 py-0.5 ${c.chip}`}>
              <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${c.dot}`}>
                <span className="text-white font-bold" style={{ fontSize: '8px' }}>
                  {item.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className={`text-xs font-medium ${c.text}`}>{item.name}</span>
              <button
                onClick={() => onRemove(item.id)}
                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors ${c.x}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button onClick={onClearAll} className={`text-xs transition-colors ${c.clear}`}>Clear all</button>
        </div>
      )}
    </div>
  );
}

export default function TasksTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Contacts dropdown
  const [allContacts, setAllContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactKeepOpen = useRef(false);
  const contactSearchTimeout = useRef(null);
  const [selectedContacts, setSelectedContacts] = useState([]);

  // Users dropdown
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userKeepOpen = useRef(false);
  const userSearchTimeout = useRef(null);
  const [selectedUsers, setSelectedUsers] = useState([]);

  // Task filters
  const [taskName, setTaskName] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [completed, setCompleted] = useState('');
  const [overdue, setOverdue] = useState('');
  const [unAssigned, setUnAssigned] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('');

  // Task search results (searchAfter cursor pagination)
  const [tasks, setTasks] = useState([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [currentSearchAfter, setCurrentSearchAfter] = useState(null);  // cursor for current page
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);    // stack for back nav
  const [nextSearchAfter, setNextSearchAfter] = useState(null);        // cursor returned by last fetch
  const TASK_LIMIT = 25;

  const getUserName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.name || u?.email || 'Unknown';
  const getContactName = (c) => c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unknown';

  // Load contacts + users on mount, and initial task search
  useEffect(() => {
    if (!location?.id) return;

    // contacts
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => { if (res.success) setAllContacts(res.data.contacts || []); })
      .catch(console.error)
      .finally(() => setContactsLoading(false));

    // users
    setUsersLoading(true);
    billingAPI.searchUsers(location.id, '')
      .then(res => { if (res.success) setAllUsers(res.data.users || []); })
      .catch(console.error)
      .finally(() => setUsersLoading(false));

    handleSearch(null, []);
  }, [location?.id]);

  // Contacts search (debounced)
  const handleContactSearch = (query) => {
    setContactSearch(query);
    clearTimeout(contactSearchTimeout.current);
    if (!query.trim()) return;
    contactSearchTimeout.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const res = await contactsAPI.search(location.id, query, 20);
        if (res.success) {
          const results = res.data.contacts || [];
          setAllContacts(prev => {
            const merged = [...prev];
            results.forEach(c => { if (!merged.find(m => m.id === c.id)) merged.push(c); });
            return merged;
          });
        }
      } catch { /* silent */ } finally { setContactsLoading(false); }
    }, 400);
  };

  const handleContactSelect = (id) => {
    contactKeepOpen.current = true;
    setTimeout(() => { contactKeepOpen.current = false; }, 50);
    const c = allContacts.find(x => x.id === id);
    if (!c) return;
    if (selectedContacts.find(x => x.id === id)) {
      setSelectedContacts(prev => prev.filter(x => x.id !== id));
    } else {
      setSelectedContacts(prev => [...prev, { id: c.id, name: getContactName(c), email: c.email || '', phone: c.phone || '' }]);
    }
  };

  // Users search (debounced)
  const handleUserSearch = (query) => {
    setUserSearch(query);
    clearTimeout(userSearchTimeout.current);
    userSearchTimeout.current = setTimeout(async () => {
      setUsersLoading(true);
      try {
        const res = await billingAPI.searchUsers(location.id, query);
        if (res.success) {
          const results = res.data.users || [];
          setAllUsers(prev => {
            const merged = [...prev];
            results.forEach(u => { if (!merged.find(m => m.id === u.id)) merged.push(u); });
            return merged;
          });
        }
      } catch { /* silent */ } finally { setUsersLoading(false); }
    }, 400);
  };

  const handleUserSelect = (id) => {
    userKeepOpen.current = true;
    setTimeout(() => { userKeepOpen.current = false; }, 50);
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    if (selectedUsers.find(x => x.id === id)) {
      setSelectedUsers(prev => prev.filter(x => x.id !== id));
    } else {
      setSelectedUsers(prev => [...prev, { id: u.id, name: getUserName(u), email: u.email || '', phone: u.phone || '' }]);
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
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const getFilters = () => {
    const contactNames = Object.fromEntries(selectedContacts.map(c => [c.id, c.name]));
    const f = {
      contactIds: selectedContacts.map(c => c.id),
      contactNames,
      assignedTo: selectedUsers.map(u => u.id)
    };
    if (taskName) f.query = taskName;
    if (completed !== '') f.completed = completed === 'true';
    if (overdue !== '') f.overdue = overdue === 'true';
    if (unAssigned !== '') f.unAssigned = unAssigned === 'true';
    if (startDate || endDate) {
      f.dueDate = {};
      if (startDate) f.dueDate.gt = dayjs(startDate).startOf('day').toISOString();
      if (endDate) f.dueDate.lte = dayjs(endDate).endOf('day').toISOString();
    }
    if (sortBy) {
      const [key, dir] = sortBy.split('_');
      f.sortKey = key;
      f.sortDirection = parseInt(dir, 10);
    }
    if(businessId != ''){
      f.businessId = businessId;
    }
    return f;
  };

  // searchAfter = cursor for this page, history = stack of previous cursors
  const handleSearch = async (searchAfter = null, history = null) => {
    setTasksLoading(true);
    setTasksError(null);
    setSearched(true);
    try {
      const res = await billingAPI.searchTasks(location.id, getFilters(), searchAfter, TASK_LIMIT);
      if (res.success) {
        setTasks(res.data.tasks || []);
        setTasksTotal(res.data.total || 0);
        setCurrentSearchAfter(searchAfter);
        setNextSearchAfter(res.data.nextSearchAfter || null);
        if (history !== null) setSearchAfterHistory(history);
      } else {
        setTasksError(res.error || 'Failed to search tasks');
        setTasks([]);
        setTasksTotal(0);
      }
    } catch (err) {
      setTasksError(err.message || 'Failed to search tasks');
      setTasks([]);
      setTasksTotal(0);
    } finally {
      setTasksLoading(false);
    }
  };

  const handleNewSearch = () => {
    setSearchAfterHistory([]);
    setCurrentSearchAfter(null);
    setNextSearchAfter(null);
    handleSearch(null, []);
  };

  const handleNext = () => {
    const newHistory = [...searchAfterHistory, currentSearchAfter];
    handleSearch(nextSearchAfter, newHistory);
  };

  const handlePrev = () => {
    const newHistory = [...searchAfterHistory];
    const prevCursor = newHistory.pop();
    handleSearch(prevCursor, newHistory);
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'tasks', getFilters());
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
      const res = await billingAPI.chargeAndExport(location.id, 'tasks', format, getFilters(), notificationEmail);
      if (res.success) {
        setActiveJob({ jobId: res.data.jobId, status: res.data.status, totalItems: res.data.totalItems, progress: { total: res.data.totalItems, processed: 0, percent: 0 } });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
      } else {
        setEstimateError(res.error || 'Export failed');
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

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const hasPrev = searchAfterHistory.length > 0;
  const hasNext = !!nextSearchAfter && tasks.length >= TASK_LIMIT;
  const contactNamesMap = Object.fromEntries(selectedContacts.map(c => [c.id, c.name]));

  const formatDueDate = (dueDate) => {
    if (!dueDate) return null;
    try {
      const d = new Date(dueDate);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return null; }
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
        exportType="tasks"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-1">
            {searched && tasksTotal > 0
              ? `${tasksTotal.toLocaleString()} task${tasksTotal !== 1 ? 's' : ''} found`
              : 'Search and export tasks from this sub-account'}
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
          Export Tasks
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
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter Tasks
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Contacts */}
          <div className="md:col-span-1">
            <MultiSelectDropdown
              label="Contacts"
              items={allContacts}
              selectedItems={selectedContacts}
              onSelect={handleContactSelect}
              onRemove={(id) => setSelectedContacts(prev => prev.filter(c => c.id !== id))}
              onClearAll={() => setSelectedContacts([])}
              loading={contactsLoading}
              searchValue={contactSearch}
              onSearch={handleContactSearch}
              dropdownOpen={contactDropdownOpen}
              onDropdownVisibleChange={setContactDropdownOpen}
              keepOpenRef={contactKeepOpen}
              placeholder="Search contacts..."
              chipColor="green"
              getItemName={getContactName}
              getItemSub={(c) => c.email || c.phone}
            />
          </div>

          {/* Contact ID (text) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact ID</label>
            <Input
              placeholder="Paste ID + Enter to add..."
              size="large"
              onPressEnter={(e) => {
                const id = e.target.value.trim();
                if (!id) return;
                if (selectedContacts.find(c => c.id === id)) return;
                setSelectedContacts(prev => [...prev, { id, name: id, email: '', phone: '' }]);
                e.target.value = '';
              }}
            />
          </div>

          {/* Assigned To (Users) */}
          <div className="md:col-span-1">
            <MultiSelectDropdown
              label="Assigned To"
              items={allUsers}
              selectedItems={selectedUsers}
              onSelect={handleUserSelect}
              onRemove={(id) => setSelectedUsers(prev => prev.filter(u => u.id !== id))}
              onClearAll={() => setSelectedUsers([])}
              loading={usersLoading}
              searchValue={userSearch}
              onSearch={handleUserSearch}
              dropdownOpen={userDropdownOpen}
              onDropdownVisibleChange={setUserDropdownOpen}
              keepOpenRef={userKeepOpen}
              placeholder="Search users..."
              chipColor="blue"
              getItemName={getUserName}
              getItemSub={(u) => u.email || u.phone}
            />
          </div>

          {/* Assigned To ID (text) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To ID</label>
            <Input
              placeholder="Paste ID + Enter to add..."
              size="large"
              onPressEnter={(e) => {
                const id = e.target.value.trim();
                if (!id) return;
                if (selectedUsers.find(u => u.id === id)) return;
                setSelectedUsers(prev => [...prev, { id, name: id, email: '', phone: '' }]);
                e.target.value = '';
              }}
            />
          </div>

          {/* Task Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Task Name</label>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Search by name..."
              size="large"
              onPressEnter={handleNewSearch}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <Select value={completed || undefined} onChange={(val) => setCompleted(val || '')} placeholder="All Tasks" allowClear style={{ width: '100%' }} size="large">
              <Select.Option value="true">Completed</Select.Option>
              <Select.Option value="false">Pending</Select.Option>
            </Select>
          </div>

          {/* Overdue */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Overdue</label>
            <Select value={overdue || undefined} onChange={(val) => setOverdue(val || '')} placeholder="All" allowClear style={{ width: '100%' }} size="large">
              <Select.Option value="true">Overdue Only</Select.Option>
              <Select.Option value="false">Not Overdue</Select.Option>
            </Select>
          </div>

          {/* Unassigned */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unassigned</label>
            <Select value={unAssigned || undefined} onChange={(val) => setUnAssigned(val || '')} placeholder="All" allowClear style={{ width: '100%' }} size="large">
              <Select.Option value="true">Unassigned Only</Select.Option>
              <Select.Option value="false">Assigned Only</Select.Option>
            </Select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Business Id</label>
            <Input
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="Search by businessId..."
              size="large"
              onPressEnter={handleNewSearch}
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort By</label>
            <Select value={sortBy || undefined} onChange={(val) => setSortBy(val || '')} placeholder="Default" allowClear style={{ width: '100%' }} size="large">
              <Select.Option value="dueDate_1">Due Date (Asc)</Select.Option>
              <Select.Option value="dueDate_-1">Due Date (Desc)</Select.Option>
              <Select.Option value="dateAdded_1">Date Added (Asc)</Select.Option>
              <Select.Option value="dateAdded_-1">Date Added (Desc)</Select.Option>
            </Select>
          </div>

          {/* Due Date From */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date From</label>
            <DatePicker value={startDate ? dayjs(startDate) : null} onChange={(date) => setStartDate(date ? date.format('YYYY-MM-DD') : '')} style={{ width: '100%' }} size="large" placeholder="From" />
          </div>

          {/* Due Date To */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date To</label>
            <DatePicker value={endDate ? dayjs(endDate) : null} onChange={(date) => setEndDate(date ? date.format('YYYY-MM-DD') : '')} style={{ width: '100%' }} size="large" placeholder="To" />
          </div>

          {/* Search button */}
          <div className="flex items-end">
            <Button
              onClick={handleNewSearch}
              loading={tasksLoading}
              size="large"
              type="primary"
              className="px-8"
              icon={!tasksLoading && (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            >
              Search
            </Button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {tasksLoading && (
        <div className="text-center py-14">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Searching tasks...</p>
        </div>
      )}

      {/* Error */}
      {tasksError && !tasksLoading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-red-800 text-sm">Error loading tasks</p>
            <p className="text-red-600 text-xs mt-1">{tasksError}</p>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !tasksLoading && !tasksError && tasks.length === 0 && (
        <div className="text-center py-16 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border-2 border-dashed border-yellow-300">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No Tasks Found</h3>
          <p className="text-gray-500 text-sm mb-4">Try adjusting your filters and search again</p>
          {hasPrev && (
            <Button size="small" onClick={handlePrev}>Previous Page</Button>
          )}
        </div>
      )}

      {/* Task List + Pagination */}
      {!tasksLoading && !tasksError && tasks.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {tasks.length} of {tasksTotal.toLocaleString()} tasks
            </span>
            <div className="flex gap-2">
              <Button size="small" disabled={!hasPrev} onClick={handlePrev}>Previous</Button>
              <Button size="small" disabled={!hasNext} type="primary" onClick={handleNext}>Next</Button>
            </div>
          </div>

          <div className="space-y-2">
            {tasks.map((task) => {
              const dueDateStr = formatDueDate(task.dueDate);
              const isOverdue = task.dueDate && !task.completed && new Date(task.dueDate) < new Date();
              const contactName = task.contactId ? (contactNamesMap[task.contactId] || task.contactId) : null;
              const assignedUser = selectedUsers.find(u => u.id === task.assignedTo);

              return (
                <div
                  key={task.id || task._id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${task.completed ? 'bg-green-100 border border-green-400' : 'border-2 border-gray-300'}`}>
                      {task.completed && (
                        <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-medium text-sm ${task.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                          {task.title || '(No title)'}
                        </p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {dueDateStr && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                              {isOverdue ? 'Overdue · ' : ''}{dueDateStr}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${task.completed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {task.completed ? 'Done' : 'Pending'}
                          </span>
                        </div>
                      </div>
                      {task.body && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.body}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {contactName && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>{contactName}</span>
                          </span>
                        )}
                        {task.assignedTo && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span>{assignedUser ? assignedUser.name : task.assignedTo}</span>
                          </span>
                        )}
                        {task.dateAdded && <span>Added {new Date(task.dateAdded).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(hasPrev || hasNext) && (
            <div className="flex justify-center gap-2 pt-2">
              <Button disabled={!hasPrev} onClick={handlePrev}>Previous</Button>
              <Button disabled={!hasNext} type="primary" onClick={handleNext}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Export Columns */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['TaskID', 'ContactID', 'ContactName', 'Title', 'Body', 'DueDate', 'Completed', 'AssignedTo', 'DateAdded'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
