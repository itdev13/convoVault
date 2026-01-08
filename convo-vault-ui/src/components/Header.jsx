import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../api/auth';
import { docsAPI } from '../api/docs';
import { APP_UPDATES, FEATURE_REQUEST_CTA, BADGE_CONFIGS } from '../constants/updates';

export default function Header() {
  const { location, ghlContext } = useAuth();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showApiTooltip, setShowApiTooltip] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      setLoading(true);
      const response = await authAPI.getLocations();
      setLocations(response.locations || []);
    } catch (error) {
      console.error('Failed to load locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLocationChange = (e) => {
    const newLocationId = e.target.value;
    window.location.href = `${window.location.pathname}?location_id=${newLocationId}&company_id=${ghlContext.companyId}&user_id=${ghlContext.userId}`;
  };

  const openApiDocs = async () => {
    try {
      // Request temporary docs access token from backend
      const { docsToken, userToken } = await docsAPI.getAccess();
      
      // Open docs with short-lived docs token (t) and user's API token (ut)
      // The docs token expires in 5 minutes, user token is for API testing
      const docsUrl = `https://convoapi.vaultsuite.store/api/docs?t=${docsToken}&ut=${encodeURIComponent(userToken)}`;
      window.open(docsUrl, '_blank');
      
    } catch (error) {
      console.error('Error opening API docs:', error);
      alert('Failed to access API documentation. Please try again.');
    }
  };

  return (
    <header className="bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg">
      <div className="max-w-full px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
              <img 
                src="/assets/app-icon-marketplace.svg" 
                alt="ConvoVault" 
                className="w-12 h-12 object-contain rounded-full"
              />
            <div>
              <h1 className="text-2xl font-bold text-white">ConvoVault</h1>
              <p className="text-sm text-blue-100">Conversation Management Dashboard</p>
            </div>
          </div>

          {/* Updates, API Docs & Sub-Account */}
          <div className="flex items-center gap-4">
            {/* Updates Button with Popover */}
            <div className="relative">
              <button
                onMouseEnter={() => setShowUpdates(true)}
                onMouseLeave={() => setShowUpdates(false)}
                className="group bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg px-3 py-2 border border-white/20 transition-all flex items-center gap-2 relative"
              >
                <span className="text-lg">⚡</span>
                <span className="text-white font-semibold text-sm hidden sm:inline">Updates</span>
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
              </button>
              
              {/* Updates Popover */}
              {showUpdates && (
                <div 
                  onMouseEnter={() => setShowUpdates(true)}
                  onMouseLeave={() => setShowUpdates(false)}
                  className="absolute top-full right-0 mt-2 w-96 bg-white text-gray-900 rounded-lg shadow-2xl z-50 animate-fade-in border-2 border-blue-200"
                >
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200">
                      <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">UPDATES</span>
                      <h3 className="text-lg font-bold text-gray-900">Latest & Upcoming</h3>
                    </div>
                    
                    <div className="space-y-3">
                      {APP_UPDATES.map((update, index) => (
                        <div key={index} className="flex items-start gap-2 text-sm">
                          <span className={`font-bold flex-shrink-0 ${
                            update.color === 'green' ? 'text-green-600' : 'text-blue-600'
                          }`}>
                            {update.icon}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <strong className="text-gray-900">{update.title}</strong>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                update.badge === 'live' 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {BADGE_CONFIGS[update.badge].label}
                              </span>
                            </div>
                            <p className="text-gray-600 text-xs mt-1">{update.description}</p>
                          </div>
                        </div>
                      ))}
                      
                      <div className="bg-blue-50 rounded-lg p-3 mt-3 border border-blue-200">
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-blue-600 font-bold flex-shrink-0">{FEATURE_REQUEST_CTA.icon}</span>
                          <div>
                            <strong className="text-blue-900">{FEATURE_REQUEST_CTA.title}</strong>
                            <p className="text-blue-700 text-xs mt-1">{FEATURE_REQUEST_CTA.description}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -top-1 right-4 w-2 h-2 bg-white border-t-2 border-r-2 border-blue-200 transform rotate-45"></div>
                </div>
              )}
            </div>
            
            {/* API Docs Button with Tooltip */}
            <div className="relative">
              <button
                onClick={openApiDocs}
                onMouseEnter={() => setShowApiTooltip(true)}
                onMouseLeave={() => setShowApiTooltip(false)}
                className="group bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg px-4 py-2 border border-white/20 transition-all flex items-center gap-2"
              >
                <span className="text-lg">📚</span>
                <span className="text-white font-semibold text-sm hidden sm:inline">API Docs</span>
                <svg className="w-4 h-4 text-white/70 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              
              {/* Tooltip */}
              {showApiTooltip && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl z-50 animate-fade-in">
                  <div className="font-semibold mb-1">📖 API Documentation</div>
                  <div className="text-gray-300">
                    Access complete API reference with your personal token. Use these APIs to integrate ConvoVault with your website or other applications.
                  </div>
                  <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                </div>
              )}
            </div>

            {/* Sub-Account Name */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg px-6 py-3 border border-white/20 flex items-baseline gap-2">
              <div className="text-lg text-blue-100 font-medium mb-1">Sub Account -</div>
              <div className="text-white font-bold text-lg">
                {location?.name || 'Loading...'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

