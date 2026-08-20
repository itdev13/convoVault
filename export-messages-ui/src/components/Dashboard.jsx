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

  // Known views for this single-page app. `disabledTabs` is still fetched (config contract)
  // but with only 'messages' as an export view there's nothing to gate here.
  const knownViews = ['messages', 'exports', 'support'];

  // If the persisted activeTab isn't a known view (or was disabled), snap back to Messages.
  useEffect(() => {
    if (!knownViews.includes(activeTab) || disabledTabs.includes(activeTab)) {
      setActiveTab('messages');
    }
  }, [activeTab, disabledTabs]);

  // Header nav links drive the view. Messages is the default/home page; Export History &
  // Support are secondary destinations. onNavigate is the single entry point for view changes.
  const handleNavigate = (key) => {
    setActiveTab(key);
    setShowConversationView(false);
  };

  // Page heading per view — gives each destination a light, distinct lead-in rather than a tab row.
  const isSecondary = ['exports', 'support'].includes(activeTab);
  const pageMeta = {
    messages: {
      title: 'Export Messages',
      subtitle: 'Pull your SMS, WhatsApp & email conversations out as CSV or JSON.',
    },
    exports: {
      title: 'Export History',
      subtitle: 'Track and re-download your previous exports.',
    },
    support: {
      title: 'Support',
      subtitle: 'Get help and reach the team.',
    },
  };
  const meta = pageMeta[activeTab] || pageMeta.messages;

  return (
    <div className="min-h-screen bg-slate-50">
      <Header activeTab={activeTab} onNavigate={handleNavigate} />

      {/* Single-page shell. Distinct from ExportKit: no top tab-card row — a centered content
          column with a light section heading, then one card holding the active view. */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {!showConversationView && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{meta.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{meta.subtitle}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className={`min-w-0 ${isSecondary ? 'p-6 sm:p-8' : 'p-6 sm:p-8'}`}>
            {showConversationView && (
              <div className="mb-6 flex items-center gap-2 text-sm text-slate-600">
                <button
                  onClick={() => setShowConversationView(false)}
                  className="hover:text-indigo-600 transition-colors font-medium"
                >
                  Conversation Threads
                </button>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-slate-900 font-medium">{selectedConversation?.contactName || 'Messages'}</span>
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
      </main>
    </div>
  );
}

