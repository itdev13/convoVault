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
import ConversationMessages from './ConversationMessages';
import { billingAPI } from '../api/billing';
import CustomChargeTab from './tabs/CustomChargeTab';
import ImportNotesTab from './tabs/ImportNotesTab';

export default function Dashboard() {
  const { location } = useAuth();

  // Get saved tab from localStorage or default to 'conversations'
  const savedTab = localStorage.getItem('activeTab') || 'messages';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);
  const [specialTabEnabled, setSpecialTabEnabled] = useState(false);
  const [customChargeEnabled, setCustomChargeEnabled] = useState(false);
  const [importNotesEnabled, setImportNotesEnabled] = useState(false);
  const [callTranscriptionsEnabled, setCallTranscriptionsEnabled] = useState(false);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  // Check which gated tabs are enabled for this location (driven by AppConfig in Mongo)
  useEffect(() => {
    if (!location?.id) return;
    billingAPI.getPricing(location.id).then(res => {
      setSpecialTabEnabled(!!res?.data?.specialTabEnabled);
      setCustomChargeEnabled(!!res?.data?.customChargeEnabled);
      setImportNotesEnabled(!!res?.data?.importNotesEnabled);
      setCallTranscriptionsEnabled(!!res?.data?.callTranscriptionsEnabled);
    }).catch(() => {});
  }, [location?.id]);

  const tabs = [
    { id: 'messages', label: 'Messages', icon: '📊' },
    ...(specialTabEnabled ? [{ id: 'specialTabMessages', label: 'Complete Messages', icon: '💎' }] : []),
    // { id: 'conversations', label: 'Conversation Threads', icon: '💬' },
    { id: 'templates', label: 'Templates', icon: '📄' },
    { id: 'notes', label: 'Notes', icon: '📝' },
    ...(importNotesEnabled ? [{ id: 'importNotes', label: 'Import Notes', icon: '📥' }] : []),
    { id: 'tasks', label: 'Tasks', icon: '✅' },
    { id: 'opportunities', label: 'Opportunities', icon: '💰' },
    { id: 'formSubmissions', label: 'Forms', icon: '📋' },
    { id: 'links', label: 'Links', icon: '🔗' },
    { id: 'callLogs', label: 'Voice AI', icon: '📞' },
    ...(callTranscriptionsEnabled ? [{ id: 'callTranscriptions', label: 'Call Transcriptions', icon: '🎙️' }] : []),
    ...(customChargeEnabled ? [{ id: 'customCharge', label: 'Charge', icon: '💳' }] : []),
  ];

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

        {/* Tab Navigation */}
        <div className="bg-white rounded-xl shadow-lg mb-6 overflow-x-auto">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px justify-around">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setShowConversationView(false); // Exit conversation view when switching tabs
                  }}
                  className={`
                    relative flex items-center justify-center gap-1 border-b-3 px-1 py-2 font-semibold text-sm transition-all whitespace-nowrap
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
              ))}
            </nav>
          </div>
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
              {activeTab === 'importNotes' && importNotesEnabled && <ImportNotesTab />}
              {activeTab === 'tasks' && <TasksTab />}
              {activeTab === 'opportunities' && <OpportunitiesTab />}
              {activeTab === 'formSubmissions' && <FormSubmissionsTab />}
              {activeTab === 'links' && <LinksTab />}
              {activeTab === 'callLogs' && <CallLogsTab />}
              {activeTab === 'callTranscriptions' && callTranscriptionsEnabled && <CallTranscriptionsTab />}
              {activeTab === 'templates' && <TemplatesTab />}
              {activeTab === 'specialTabMessages' && specialTabEnabled && <SpecialMessagesTab />}
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

