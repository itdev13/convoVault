import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Header from './Header';
import UpdatesBanner from './UpdatesBanner';
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
import SocialPostsTab from './tabs/SocialPostsTab';
import CallLogsTab from './tabs/CallLogsTab';
import TemplatesTab from './tabs/TemplatesTab';
import ConversationMessages from './ConversationMessages';

export default function Dashboard() {
  const { location } = useAuth();
  
  // Get saved tab from localStorage or default to 'conversations'
  const savedTab = localStorage.getItem('activeTab') || 'messages';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  const tabs = [
    { id: 'messages', label: 'Messages', icon: '📊' },
    { id: 'conversations', label: 'Conversations', icon: '💬' },
    { id: 'notes', label: 'Notes', icon: '📝' },
    { id: 'tasks', label: 'Tasks', icon: '✅' },
    { id: 'opportunities', label: 'Opportunities', icon: '💰' },
    { id: 'formSubmissions', label: 'Forms', icon: '📋' },
    { id: 'links', label: 'Links', icon: '🔗' },
    { id: 'socialPosts', label: 'Social Posts', icon: '📱' },
    { id: 'callLogs', label: 'Call Logs', icon: '📞' },
    { id: 'templates', label: 'Templates', icon: '📄' },
    { id: 'exports', label: 'Export History', icon: '📤' },
    // { id: 'import', label: 'Import', icon: '📥' },
  ];

  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
    setShowConversationView(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header onSupportClick={() => { setActiveTab('support'); setShowConversationView(false); }} />
      
      <div className="max-w-12xl mx-auto px-3 py-3">
        {/* Updates Banner */}
        {/* <UpdatesBanner /> */}
        
        {/* Tab Navigation */}
        <div className="bg-white rounded-xl shadow-lg mb-6 overflow-x-auto">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setShowConversationView(false); // Exit conversation view when switching tabs
                  }}
                  className={`
                    relative flex items-center justify-center gap-1 border-b-3 py-2 font-semibold text-sm transition-all flex-1
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
                Conversations
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
              {activeTab === 'socialPosts' && <SocialPostsTab />}
              {activeTab === 'callLogs' && <CallLogsTab />}
              {activeTab === 'templates' && <TemplatesTab />}
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

