import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Header from './Header';
import ConversationsTab from './tabs/ConversationsTab';
import MessagesTab from './tabs/MessagesTab';
import ImportTab from './tabs/ImportTab';
import SupportTab from './tabs/SupportTab';
import ExportTab from './tabs/ExportTab';
import NotesTab from './tabs/NotesTab';
import TasksTab from './tabs/TasksTab';
import OpportunitiesTab from './tabs/OpportunitiesTab';
import FormSubmissionsTab from './tabs/FormSubmissionsTab';
import LinksTab from './tabs/LinksTab';
import CallLogsTab from './tabs/CallLogsTab';
import TemplatesTab from './tabs/TemplatesTab';
import SpecialMessagesTab from './tabs/SpecialMessagesTab';
import CallTranscriptionsTab from './tabs/CallTranscriptionsTab';
import ExportContactsTab from './tabs/ExportContactsTab';
import ConversationMessages from './ConversationMessages';
import { billingAPI } from '../api/billing';
import CustomChargeTab from './tabs/CustomChargeTab';
import ImportNotesTab from './tabs/ImportNotesTab';
import ImportContactsTab from './tabs/ImportContactsTab';
import CustomFieldsTab from './tabs/CustomFieldsTab';
import CustomValuesTab from './tabs/CustomValuesTab';
import TagsTab from './tabs/TagsTab';
import ImportCustomFieldsTab from './tabs/ImportCustomFieldsTab';
import ImportCustomValuesTab from './tabs/ImportCustomValuesTab';

export default function Dashboard() {
  const { location } = useAuth();

  // Top-level mode: 'export' (default) or 'import'
  const savedMode = localStorage.getItem('dataMode') || 'export';
  const [dataMode, setDataMode] = useState(savedMode);

  // Saved sub-tab — defaults to 'messages' under Export, 'importNotes' under Import.
  const savedTab = localStorage.getItem('activeTab') || 'messages';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);
  // Charge and Call Transcriptions stay gated; Complete Messages and Import Notes are now live for everyone.
  const [customChargeEnabled, setCustomChargeEnabled] = useState(false);
  const [callTranscriptionsEnabled, setCallTranscriptionsEnabled] = useState(false);

  // Persist mode + sub-tab
  useEffect(() => { localStorage.setItem('dataMode', dataMode); }, [dataMode]);
  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);

  useEffect(() => {
    if (!location?.id) return;
    billingAPI.getPricing(location.id).then(res => {
      setCustomChargeEnabled(!!res?.data?.customChargeEnabled);
      setCallTranscriptionsEnabled(!!res?.data?.callTranscriptionsEnabled);
    }).catch(() => {});
  }, [location?.id]);

  // Sub-tabs under "Export Data"
  const exportTabs = [
    { id: 'messages', label: 'Messages', icon: '📊' },
    { id: 'specialTabMessages', label: 'Complete Messages', icon: '💎' },
    { id: 'contacts', label: 'Contacts', icon: '👤' },
    { id: 'templates', label: 'Templates', icon: '📄' },
    { id: 'notes', label: 'Notes', icon: '📝' },
    { id: 'tasks', label: 'Tasks', icon: '✅' },
    { id: 'opportunities', label: 'Opportunities', icon: '💰' },
    { id: 'formSubmissions', label: 'Forms', icon: '📋' },
    { id: 'links', label: 'Links', icon: '🔗' },
    { id: 'callLogs', label: 'Voice AI', icon: '📞' },
    { id: 'customFields', label: 'Custom Fields', icon: '🧩' },
    { id: 'customValues', label: 'Custom Values', icon: '🔖' },
    { id: 'tags', label: 'Tags', icon: '🏷️' },
    ...(callTranscriptionsEnabled ? [{ id: 'callTranscriptions', label: 'Call Transcriptions', icon: '🎙️' }] : []),
    ...(customChargeEnabled ? [{ id: 'customCharge', label: 'Charge', icon: '💳' }] : []),
  ];

  // Sub-tabs under "Import Data"
  const importTabs = [
    { id: 'importContacts', label: 'Contacts', icon: '👥' },
    { id: 'importNotes', label: 'Notes', icon: '📥' },
    { id: 'importCustomFields', label: 'Custom Fields', icon: '🧩' },
    { id: 'importCustomValues', label: 'Custom Values', icon: '🔖' },
  ];

  const tabs = dataMode === 'export' ? exportTabs : importTabs;

  // If the persisted activeTab doesn't belong to the current mode (e.g. user switched modes),
  // snap to the first tab in the current group.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some(t => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [dataMode, tabs.length]);

  const switchMode = (mode) => {
    if (mode === dataMode) return;
    setDataMode(mode);
    setShowConversationView(false);
    // Snap activeTab to first sub-tab of new mode immediately so content updates without a frame of mismatch.
    const list = mode === 'export' ? exportTabs : importTabs;
    if (list.length > 0) setActiveTab(list[0].id);
  };

  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
    setShowConversationView(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header
        onExportsClick={() => { setActiveTab('exports'); setShowConversationView(false); }}
        onSupportClick={() => { setActiveTab('support'); setShowConversationView(false); }}
      />
      
      <div className="max-w-12xl mx-auto px-3 py-3">
        {/* Updates Banner */}
        {/* <UpdatesBanner /> */}

        {/* Custom Work / AI Agents Promo Banner */}
        <div className="mb-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-xl px-5 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold text-sm">Hire a former HighLevel developer</p>
                <span className="hidden sm:inline-flex items-center gap-1 bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/30">
                  Ex-HighLevel · 5+ yrs
                </span>
              </div>
              <p className="text-purple-100 text-xs mt-0.5">Custom GHL apps, integrations, automations & AI agents — quality work at low cost. Need something built? Let's talk.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href="mailto:rapiddev21@gmail.com"
              className="flex items-center gap-2 bg-white hover:bg-gray-50 text-indigo-600 text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=61585960844180"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm border border-white/30"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Facebook
            </a>
          </div>
        </div>

        {/* Mode tabs (Export / Import) — connected to the sub-tab card below like browser tabs.
            No horizontal padding here so the leftmost mode tab lines up with the left edge of the
            sub-tabs card underneath. */}
        <div className="flex items-end gap-2">
          {[
            { key: 'export', label: 'Export Data', tagline: 'Pull data out as CSV / JSON' },
            { key: 'import', label: 'Import Data', tagline: 'Bring data in from a CSV' },
          ].map(m => {
            const active = dataMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => switchMode(m.key)}
                className={`
                  group relative flex items-center gap-3 px-5 pt-3 pb-4 rounded-t-xl transition-all
                  ${active
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg z-10'
                    : 'bg-white/70 hover:bg-white text-gray-600 border border-gray-200 border-b-0'
                  }
                `}
              >
                {/* Icon */}
                <div className={`
                  w-9 h-9 rounded-lg flex items-center justify-center transition-colors
                  ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500 group-hover:text-gray-700'}
                `}>
                  {m.key === 'export' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
                    </svg>
                  )}
                </div>
                <div className="text-left">
                  <div className={`font-bold text-sm leading-tight ${active ? 'text-white' : 'text-gray-700'}`}>
                    {m.label}
                  </div>
                  <div className={`text-xs leading-tight mt-0.5 ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                    {m.tagline}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Sub-tabs card — thin neutral border + small top gap keeps the two levels visibly separate. */}
        <div className="bg-white rounded-xl shadow-lg mb-6 overflow-x-auto relative border-t border-gray-200">
          <nav className="flex -mb-px justify-start min-w-max pl-3 gap-4">
            {tabs.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-500">
                No {dataMode === 'export' ? 'export' : 'import'} options available for this sub-account.
              </div>
            ) : (
              tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setShowConversationView(false);
                  }}
                  className={`
                    relative flex items-center justify-center gap-1 border-b-3 px-3 py-3 font-semibold text-sm transition-all whitespace-nowrap
                    ${(activeTab === tab.id || (showConversationView && tab.id === 'conversations'))
                      ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }
                  `}
                >
                  <span className="text-xl">{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  {(activeTab === tab.id || (showConversationView && tab.id === 'conversations')) && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-blue-600 rounded-t-full"></div>
                  )}
                </button>
              ))
            )}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          {/* Breadcrumb for Conversation View */}
          {showConversationView && (
            <div className="mb-6 flex items-center gap-2 text-sm text-gray-600">
              <button 
                onClick={() => setShowConversationView(false)}
                className="hover:text-blue-600 transition-colors font-medium"
              >
                Conversation Threads
              </button>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-gray-900 font-medium">{selectedConversation?.contactName || 'Messages'}</span>
            </div>
          )}

          {showConversationView ? (
            <ConversationMessages 
              conversation={selectedConversation} 
              onBack={() => setShowConversationView(false)}
            />
          ) : (
            <>
              {activeTab === 'conversations' && (
                <ConversationsTab onSelectConversation={handleConversationSelect} />
              )}
              {activeTab === 'messages' && <MessagesTab />}
              {activeTab === 'notes' && <NotesTab />}
              {activeTab === 'importNotes' && <ImportNotesTab />}
              {activeTab === 'importContacts' && <ImportContactsTab />}
              {activeTab === 'importCustomFields' && <ImportCustomFieldsTab />}
              {activeTab === 'importCustomValues' && <ImportCustomValuesTab />}
              {activeTab === 'tasks' && <TasksTab />}
              {activeTab === 'opportunities' && <OpportunitiesTab />}
              {activeTab === 'formSubmissions' && <FormSubmissionsTab />}
              {activeTab === 'links' && <LinksTab />}
              {activeTab === 'callLogs' && <CallLogsTab />}
              {activeTab === 'customFields' && <CustomFieldsTab />}
              {activeTab === 'customValues' && <CustomValuesTab />}
              {activeTab === 'tags' && <TagsTab />}
              {activeTab === 'callTranscriptions' && callTranscriptionsEnabled && <CallTranscriptionsTab />}
              {activeTab === 'contacts' && <ExportContactsTab />}
              {activeTab === 'templates' && <TemplatesTab />}
              {activeTab === 'specialTabMessages' && <SpecialMessagesTab />}
              {activeTab === 'exports' && <ExportTab />}
              {activeTab === 'import' && <ImportTab />}
              {activeTab === 'support' && <SupportTab />}
              {activeTab === 'customCharge' && customChargeEnabled && <CustomChargeTab />}
            </>
          )}
        </div>

      </div>
    </div>
  );
}

