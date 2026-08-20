import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Header from './Header';
import MessagesTab from './tabs/MessagesTab';
import SupportTab from './tabs/SupportTab';
import ExportTab from './tabs/ExportTab';
import ConversationMessages from './ConversationMessages';
import { billingAPI } from '../api/billing';

export default function Dashboard() {
  const { location } = useAuth();

  // Saved sub-tab — defaults to 'messages'.
  const savedTab = localStorage.getItem('activeTab') || 'messages';
  const [activeTab, setActiveTab] = useState(savedTab);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showConversationView, setShowConversationView] = useState(false);
  // Per-location tab kill-switch (from AppConfig `disabledTabs:<locationId>`). Holds tab ids to
  // hide. Harmless for this single-tab app but kept so the config contract still works.
  const [disabledTabs, setDisabledTabs] = useState([]);

  // Persist sub-tab
  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);

  useEffect(() => {
    if (!location?.id) return;
    billingAPI.getPricing(location.id).then(res => {
      setDisabledTabs(Array.isArray(res?.data?.disabledTabs) ? res.data.disabledTabs : []);
    }).catch(() => {});
  }, [location?.id]);

  // Sidebar groups for Export Data — messages only.
  const exportGroups = [
    {
      label: 'Messages',
      items: [
        { id: 'messages', label: 'Messages', icon: '📊' },
      ]
    },
  ];

  // Apply the per-location disabled-tabs filter: drop any hidden tab id, then drop groups left empty.
  const applyDisabled = (groups) =>
    groups
      .map(g => ({ ...g, items: g.items.filter(it => !disabledTabs.includes(it.id)) }))
      .filter(g => g.items.length > 0);

  const exportGroupsVisible = applyDisabled(exportGroups);
  const exportTabs = exportGroupsVisible.flatMap(g => g.items);

  // If the persisted activeTab isn't a known sub-tab, snap to the first one.
  useEffect(() => {
    if (exportTabs.length === 0) return;
    const standalone = ['exports', 'support'].includes(activeTab);
    if (!standalone && !exportTabs.some(t => t.id === activeTab)) {
      setActiveTab(exportTabs[0].id);
    }
  }, [exportTabs.length]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header />
      
      <div className="max-w-12xl mx-auto px-3 py-3">
        {/* Mode tabs — this lite app is Export-only, so the single "Export Messages" tab plus the
            standalone Export History & Support quick-access tabs make up the top row. */}
        <div className="flex items-end gap-2">
          {[
            { key: 'export', label: 'Export Messages', tagline: 'Pull your messages out as CSV / JSON' },
          ].map(m => {
            // Highlight only when inside the messages sub-tab (not the standalone tabs).
            const active = !['exports', 'support'].includes(activeTab);
            return (
              <button
                key={m.key}
                onClick={() => { setActiveTab('messages'); setShowConversationView(false); }}
                className={`
                  group relative flex items-center gap-3 px-5 pt-3 pb-4 rounded-t-xl transition-all
                  ${active
                    ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white shadow-lg z-10'
                    : 'bg-white/70 hover:bg-white text-gray-600 border border-gray-200 border-b-0'
                  }
                `}
              >
                {/* Icon */}
                <div className={`
                  w-9 h-9 rounded-lg flex items-center justify-center transition-colors
                  ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500 group-hover:text-gray-700'}
                `}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className={`font-bold text-sm leading-tight ${active ? 'text-white' : 'text-gray-700'}`}>
                    {m.label}
                  </div>
                  <div className={`text-xs leading-tight mt-0.5 ${active ? 'text-indigo-100' : 'text-gray-500'}`}>
                    {m.tagline}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Export History & Support — quick-access tabs, same visual style as the mode tab */}
          {[
            { key: 'exports', label: 'Export History', tagline: 'View past exports', icon: '📤' },
            { key: 'support', label: 'Support', tagline: 'Get help', icon: '🆘' },
          ].map(t => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setActiveTab(t.key); setShowConversationView(false); }}
                className={`
                  group relative flex items-center gap-3 px-5 pt-3 pb-4 rounded-t-xl transition-all
                  ${active
                    ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white shadow-lg z-10'
                    : 'bg-white/70 hover:bg-white text-gray-600 border border-gray-200 border-b-0'
                  }
                `}
              >
                <div className={`
                  w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors
                  ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500 group-hover:text-gray-700'}
                `}>
                  {t.icon}
                </div>
                <div className="text-left">
                  <div className={`font-bold text-sm leading-tight ${active ? 'text-white' : 'text-gray-700'}`}>
                    {t.label}
                  </div>
                  <div className={`text-xs leading-tight mt-0.5 ${active ? 'text-indigo-100' : 'text-gray-500'}`}>
                    {t.tagline}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Sidebar nav + content panel.
            Sidebar is hidden for standalone tabs (Export History, Support) where it doesn't apply. */}
        <div className="bg-white rounded-xl shadow-lg flex overflow-hidden border-t border-gray-200">
          {/* Sidebar */}
          {!['exports', 'support'].includes(activeTab) && (
          <aside className="w-65  flex-shrink-0 border-r border-gray-100 py-4 bg-gray-50/60">
            {exportGroupsVisible.map((group, gi) => (
              <div key={group.label || `g-${gi}`} className="mb-1">
                {group.label && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 select-none">
                    {group.label}
                  </div>
                )}
                {group.items.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setShowConversationView(false);
                      }}
                      title={tab.label}
                      className={`
                        w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-all text-left
                        ${isActive
                          ? 'bg-indigo-50 text-indigo-700 border-r-2 border-indigo-600'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800 border-r-2 border-transparent'
                        }
                      `}
                    >
                      <span className="text-base leading-none">{tab.icon}</span>
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0 p-8">
            {showConversationView && (
              <div className="mb-6 flex items-center gap-2 text-sm text-gray-600">
                <button
                  onClick={() => setShowConversationView(false)}
                  className="hover:text-indigo-600 transition-colors font-medium"
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
                {activeTab === 'messages' && <MessagesTab />}
                {activeTab === 'exports' && <ExportTab />}
                {activeTab === 'support' && <SupportTab />}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

