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

  // Task search results
  const [tasks, setTasks] = useState([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [taskSkip, setTaskSkip] = useState(0);
  const TASK_LIMIT = 25;

  const getContactName = (c) =>
    c?.contactName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unknown';

  // Load 100 contacts on mount + initial task search
  useEffect(() => {
    if (!location?.id) return;
    setContactsLoading(true);
    contactsAPI.search(location.id, '', 100)
      .then(res => {
        if (res.success) setAllContacts(res.data.contacts || []);
      })
      .catch(console.error)
      .finally(() => setContactsLoading(false));

    handleSearch(0);
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

  const handleSearch = async (skip = 0) => {
    setTasksLoading(true);
    setTasksError(null);
    setSearched(true);
    try {
      const res = await billingAPI.searchTasks(location.id, getFilters(), skip, TASK_LIMIT);
      if (res.success) {
        setTasks(res.data.tasks || []);
        setTasksTotal(res.data.total || 0);
        setTaskSkip(skip);
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

  const contactNamesMap = Object.fromEntries(selectedContacts.map(c => [c.id, c.name]));

  const formatDueDate = (dueDate) => {
    if (!dueDate) return null;
    try {
      const d = new Date(dueDate);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return null; }
  };

  const hasPrev = taskSkip > 0;
  const hasNext = taskSkip + TASK_LIMIT < tasksTotal;

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
          {/* Contacts — narrower, 2 of 4 cols */}
          <div className="md:col-span-2">
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
                placeholder="Search contacts..."
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
                        {c.email && <span className="text-gray-400 text-xs truncate max-w-[120px]">{c.email}</span>}
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
            {selectedContacts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                {selectedContacts.map(contact => (
                  <div key={contact.id} className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-full pl-2 pr-1 py-0.5">
                    <div className="w-3.5 h-3.5 bg-green-400 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold" style={{ fontSize: '8px' }}>
                        {contact.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-green-800">{contact.name}</span>
                    <button
                      onClick={() => removeContact(contact.id)}
                      className="w-3.5 h-3.5 rounded-full hover:bg-green-200 flex items-center justify-center transition-colors"
                    >
                      <svg className="w-2.5 h-2.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-600 transition-colors">
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
              placeholder="Search by name..."
              size="large"
              onPressEnter={() => handleSearch(0)}
            />
          </div>

          {/* Status */}
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
              placeholder="From"
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
              placeholder="To"
            />
          </div>

          {/* Search button — spans remaining 2 cols, right-aligned */}
          <div className="md:col-span-2 flex items-center">
            <Button
              onClick={() => handleSearch(0)}
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
          <p className="text-gray-500 text-sm">Try adjusting your filters and search again</p>
        </div>
      )}

      {/* Pagination + Task List */}
      {!tasksLoading && !tasksError && tasks.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {taskSkip + 1}–{Math.min(taskSkip + tasks.length, tasksTotal)} of {tasksTotal.toLocaleString()} tasks
            </span>
            <div className="flex gap-2">
              <Button size="small" disabled={!hasPrev} onClick={() => handleSearch(taskSkip - TASK_LIMIT)}>
                Previous
              </Button>
              <Button size="small" disabled={!hasNext} type="primary" onClick={() => handleSearch(taskSkip + TASK_LIMIT)}>
                Next
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {tasks.map((task) => {
              const dueDateStr = formatDueDate(task.dueDate);
              const isOverdue = task.dueDate && !task.completed && new Date(task.dueDate) < new Date();
              const contactName = task.contactId
                ? (contactNamesMap[task.contactId] || task.contactId)
                : null;

              return (
                <div
                  key={task.id || task._id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    {/* Status indicator */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      task.completed ? 'bg-green-100 border border-green-400' : 'border-2 border-gray-300'
                    }`}>
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
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              isOverdue
                                ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {isOverdue ? 'Overdue · ' : ''}{dueDateStr}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            task.completed
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {task.completed ? 'Done' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      {task.body && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.body}</p>
                      )}

                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {contactName && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span className="font-mono">{contactName}</span>
                          </span>
                        )}
                        {task.assignedTo && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="font-mono">{task.assignedTo}</span>
                          </span>
                        )}
                        {task.dateAdded && (
                          <span>Added {new Date(task.dateAdded).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom pagination */}
          {(hasPrev || hasNext) && (
            <div className="flex justify-center gap-2 pt-2">
              <Button disabled={!hasPrev} onClick={() => handleSearch(taskSkip - TASK_LIMIT)}>
                Previous
              </Button>
              <Button disabled={!hasNext} type="primary" onClick={() => handleSearch(taskSkip + TASK_LIMIT)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* Export Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['TaskID', 'ContactID', 'ContactName', 'Title', 'Body', 'DueDate', 'Completed', 'AssignedTo', 'DateAdded'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
