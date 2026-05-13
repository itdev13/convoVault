import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Header from './Header';
import ConversationsTab from './tabs/ConversationsTab';
import MessagesTab from './tabs/MessagesTab';
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

  // Sidebar groups for Export Data
  const exportGroups = [
    {
      label: 'Conversations',
      items: [
        { id: 'messages', label: 'Messages', icon: '📊' },
        { id: 'specialTabMessages', label: 'Complete Messages', icon: '💎' },
      ]
    },
    {
      label: 'Contacts & CRM',
      items: [
        { id: 'contacts', label: 'Contacts', icon: '👤' },
        { id: 'opportunities', label: 'Opportunities', icon: '💰' },
        { id: 'formSubmissions', label: 'Forms', icon: '📋' },
      ]
    },
    {
      label: 'Content',
      items: [
        { id: 'notes', label: 'Notes', icon: '📝' },
        { id: 'tasks', label: 'Tasks', icon: '✅' },
        { id: 'templates', label: 'Templates', icon: '📄' },
        { id: 'links', label: 'Links', icon: '🔗' },
        { id: 'callLogs', label: 'Voice AI', icon: '📞' },
        { id: 'customFields', label: 'Custom Fields', icon: '🧩' },
        { id: 'customValues', label: 'Custom Values', icon: '🔖' },
        { id: 'tags', label: 'Tags', icon: '🏷️' },
        ...(callTranscriptionsEnabled ? [{ id: 'callTranscriptions', label: 'Call Transcriptions', icon: '🎙️' }] : []),
      ]
    },
    ...(customChargeEnabled ? [{ label: 'Billing', items: [{ id: 'customCharge', label: 'Charge', icon: '💳' }] }] : []),
  ];

  // All export tab ids (flat) — used for tab-switching validation
  const exportTabs = exportGroups.flatMap(g => g.items);

  // Sidebar groups for Import Data
  const importGroups = [
    {
      label: 'Contacts & CRM',
      items: [
        { id: 'importContacts', label: 'Contacts', icon: '👥' },
        { id: 'importNotes', label: 'Notes', icon: '📥' },
      ]
    },
    {
      label: 'Content',
      items: [
        { id: 'importCustomFields', label: 'Custom Fields', icon: '🧩' },
        { id: 'importCustomValues', label: 'Custom Values', icon: '🔖' },
      ]
    },
  ];

  const importTabs = importGroups.flatMap(g => g.items);

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
    const onStandaloneTab = ['exports', 'support'].includes(activeTab);
    // Allow re-clicking the active mode to escape standalone tabs (Export History, Support).
    if (mode === dataMode && !onStandaloneTab) return;
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
      <Header />
      
      <div className="max-w-12xl mx-auto px-3 py-3">
        {/* Updates Banner */}
        {/* <UpdatesBanner /> */}

        {/* Price Drop Promo Strip */}
        <div className="mb-3 rounded-xl overflow-hidden border border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 relative">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-emerald-100/60 to-transparent pointer-events-none"></div>
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-300/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="relative px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <div className="relative flex-shrink-0 flex items-center gap-2">
              <span className="text-xl leading-none">🎉</span>
              <span className="inline-flex items-center text-[10px] font-bold bg-emerald-600 text-white px-2 py-1 rounded-md uppercase tracking-wider shadow-sm">
                Price Drop
              </span>
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full"></span>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm text-gray-800">
                <span className="font-semibold text-emerald-900">Volume tiers just got cheaper.</span>
                <span className="hidden sm:inline text-gray-700 ml-1.5">
                  Up to <strong className="text-emerald-700">63% off</strong> on emails over 50k and <strong className="text-emerald-700">44% off</strong> on messages over 50k — credit rate drops to <strong className="text-emerald-700">$0.01</strong> automatically.
                </span>
              </p>
            </div>
            <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-white px-2 py-1 rounded-md border border-emerald-200">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Auto-applied
              </span>
              <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 bg-white px-2 py-1 rounded-md border border-emerald-200">
                Stacks with vol. discounts
              </span>
            </div>
          </div>
        </div>

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
            // Only highlight the mode tab when the user is actually inside the export/import sub-tabs.
            // Standalone tabs (Export History, Support) take focus away from both mode tabs.
            const active = dataMode === m.key && !['exports', 'support'].includes(activeTab);
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

          {/* Export History & Support — quick-access tabs, same visual style as mode tabs */}
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
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg z-10'
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
                  <div className={`text-xs leading-tight mt-0.5 ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                    {t.tagline}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Sidebar nav + content panel — same layout for Export and Import.
            Sidebar is hidden for standalone tabs (Export History, Support) where it doesn't apply. */}
        <div className="bg-white rounded-xl shadow-lg flex overflow-hidden border-t border-gray-200">
          {/* Sidebar */}
          {!['exports', 'support'].includes(activeTab) && (
          <aside className="w-52 flex-shrink-0 border-r border-gray-100 py-4 bg-gray-50/60">
            {(dataMode === 'export' ? exportGroups : importGroups).map((group, gi) => (
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
                      className={`
                        w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-all text-left
                        ${isActive
                          ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
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
                {activeTab === 'conversations' && <ConversationsTab onSelectConversation={handleConversationSelect} />}
                {activeTab === 'messages' && <MessagesTab />}
                {activeTab === 'specialTabMessages' && <SpecialMessagesTab />}
                {activeTab === 'contacts' && <ExportContactsTab />}
                {activeTab === 'opportunities' && <OpportunitiesTab />}
                {activeTab === 'formSubmissions' && <FormSubmissionsTab />}
                {activeTab === 'notes' && <NotesTab />}
                {activeTab === 'tasks' && <TasksTab />}
                {activeTab === 'templates' && <TemplatesTab />}
                {activeTab === 'links' && <LinksTab />}
                {activeTab === 'callLogs' && <CallLogsTab />}
                {activeTab === 'customFields' && <CustomFieldsTab />}
                {activeTab === 'customValues' && <CustomValuesTab />}
                {activeTab === 'tags' && <TagsTab />}
                {activeTab === 'callTranscriptions' && callTranscriptionsEnabled && <CallTranscriptionsTab />}
                {activeTab === 'customCharge' && customChargeEnabled && <CustomChargeTab />}
                {activeTab === 'importContacts' && <ImportContactsTab />}
                {activeTab === 'importNotes' && <ImportNotesTab />}
                {activeTab === 'importCustomFields' && <ImportCustomFieldsTab />}
                {activeTab === 'importCustomValues' && <ImportCustomValuesTab />}
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

