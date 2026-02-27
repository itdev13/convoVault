import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Header from './Header';
import UpdatesBanner from './UpdatesBanner';
import ConversationsTab from './tabs/ConversationsTab';
import MessagesTab from './tabs/MessagesTab';
import ImportTab from './tabs/ImportTab';
import SupportTab from './tabs/SupportTab';
import ExportTab from './tabs/ExportTab';
import ConversationMessages from './ConversationMessages';

export default function Dashboard() {
  const { location } = useAuth();

  // Get saved tab from localStorage or default to 'conversations'
  const savedTab = localStorage.getItem('activeTab') || 'conversations';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  const tabs = [
    { id: 'conversations', label: 'Conversations', icon: '💬' },
    { id: 'messages', label: 'Messages', icon: '📊' },
    { id: 'exports', label: 'Export History', icon: '📤' },
    // { id: 'import', label: 'Import', icon: '📥' },
    { id: 'support', label: 'Support', icon: '🆘' }
  ];

  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
    setShowConversationView(true);
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <Header />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Updates Banner */}
        {/* <UpdatesBanner /> */}

        {/* Tab Navigation */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 mb-6 overflow-hidden">
          <div className="border-b border-slate-700">
            <nav className="flex -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setShowConversationView(false);
                  }}
                  className={`
                    relative flex items-center justify-center gap-3 px-8 py-4 border-b-3 font-semibold text-sm transition-all flex-1
                    ${(activeTab === tab.id || (showConversationView && tab.id === 'conversations'))
                      ? 'border-blue-500 text-blue-400 bg-blue-900/20'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                    }
                  `}
                >
                  <span className="text-xl">{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  {(activeTab === tab.id || (showConversationView && tab.id === 'conversations')) && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-sky-500 rounded-t-full"></div>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-8">
          {/* Breadcrumb for Conversation View */}
          {showConversationView && (
            <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
              <button
                onClick={() => setShowConversationView(false)}
                className="hover:text-blue-400 transition-colors font-medium"
              >
                Conversations
              </button>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-white font-medium">{selectedConversation?.contactName || 'Messages'}</span>
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
              {activeTab === 'exports' && <ExportTab />}
              {activeTab === 'import' && <ImportTab />}
              {activeTab === 'support' && <SupportTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
