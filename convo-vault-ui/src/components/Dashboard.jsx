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
import ConversationMessages from './ConversationMessages';
import { billingAPI } from '../api/billing';
import CustomChargeTab from './tabs/CustomChargeTab';

const CUSTOM_CHARGE_LOCATION_ID = 'WHspQgeC5SqFU8i55G7L';

export default function Dashboard() {
  const { location } = useAuth();
  const isCustomChargeLocation = location?.id === CUSTOM_CHARGE_LOCATION_ID;

  // Get saved tab from localStorage or default to 'conversations'
  const savedTab = localStorage.getItem('activeTab') || 'messages';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);
  const [specialTabEnabled, setSpecialTabEnabled] = useState(false);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  // Check if Special Messages tab is enabled for this location
  useEffect(() => {
    if (!location?.id) return;
    billingAPI.getPricing(location.id).then(res => {
      if (res?.data?.specialTabEnabled) setSpecialTabEnabled(true);
      else setSpecialTabEnabled(false);
    }).catch(() => {});
  }, [location?.id]);

  const tabs = [
    { id: 'messages', label: 'Messages', icon: '📊' },
    ...(specialTabEnabled ? [{ id: 'specialTabMessages', label: 'Complete Messages', icon: '💎' }] : []),
    { id: 'conversations', label: 'Conversation Threads', icon: '💬' },
    { id: 'templates', label: 'Templates', icon: '📄' },
    { id: 'notes', label: 'Notes', icon: '📝' },
    { id: 'tasks', label: 'Tasks', icon: '✅' },
    { id: 'opportunities', label: 'Opportunities', icon: '💰' },
    { id: 'formSubmissions', label: 'Forms', icon: '📋' },
    { id: 'links', label: 'Links', icon: '🔗' },
    { id: 'callLogs', label: 'Voice AI', icon: '📞' },
    ...(isCustomChargeLocation ? [{ id: 'customCharge', label: 'Charge', icon: '💳' }] : []),
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

        {/* Facebook Community Banner */}
        <div className="mb-4 bg-gradient-to-r from-[#1877F2] to-[#0C63D4] rounded-xl px-5 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">ExportKit on Facebook</p>
              <p className="text-blue-100 text-xs">Got questions or need help? Reach out to us directly on Facebook for quick support!</p>
            </div>
          </div>
          <a
            href="https://www.facebook.com/groups/exportkit"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-[#1877F2] text-sm font-semibold px-5 py-2 rounded-lg transition-colors flex-shrink-0 shadow-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
            Join Now
          </a>
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
              {activeTab === 'tasks' && <TasksTab />}
              {activeTab === 'opportunities' && <OpportunitiesTab />}
              {activeTab === 'formSubmissions' && <FormSubmissionsTab />}
              {activeTab === 'links' && <LinksTab />}
              {activeTab === 'callLogs' && <CallLogsTab />}
              {activeTab === 'templates' && <TemplatesTab />}
              {activeTab === 'specialTabMessages' && specialTabEnabled && <SpecialMessagesTab />}
              {activeTab === 'exports' && <ExportTab />}
              {activeTab === 'import' && <ImportTab />}
              {activeTab === 'support' && <SupportTab />}
              {activeTab === 'customCharge' && isCustomChargeLocation && <CustomChargeTab />}
            </>
          )}
        </div>

      </div>
    </div>
  );
}

