import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../api/auth';
import { docsAPI } from '../api/docs';
import { API_DOCS_BASE_URL } from '../constants/api';

export default function Header({ activeTab = 'messages', onNavigate = () => {} }) {
  const { location, ghlContext } = useAuth();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

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

  // Header nav links drive the same view state the Dashboard uses. "Messages" is the
  // default/home view; Export History & Support are secondary destinations reached from here.
  const navLinks = [
    {
      key: 'exports',
      label: 'Export History',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      key: 'support',
      label: 'Support',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
  ];

  return (
    <header className="bg-indigo-700 border-b border-indigo-800/40 shadow-sm">
      <div className="w-full px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
        {/* Brand lockup — single clean line */}
        <button
          onClick={() => onNavigate('messages')}
          className="flex items-center gap-3 group"
        >
          <img
            src="/assets/export-messages-icon.png"
            alt="Export Messages"
            className="w-9 h-9 object-contain rounded-lg ring-1 ring-white/20 bg-white/10"
          />
          <div className="flex items-baseline gap-2 leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-white">Export Messages</span>
            <span className="hidden md:inline text-[11px] text-indigo-200/80 border-l border-white/20 pl-2">
              SMS, WhatsApp &amp; email &rarr; CSV / JSON
            </span>
          </div>
        </button>

        {/* Right side: nav links, API docs, sub-account */}
        <div className="flex items-center gap-1">
          {/* Nav links (not tab cards) */}
          <nav className="flex items-center gap-0.5">
            {navLinks.map((link) => {
              const active = activeTab === link.key;
              return (
                <button
                  key={link.key}
                  onClick={() => onNavigate(link.key)}
                  className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-white/15 text-white'
                      : 'text-indigo-100/90 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {link.icon}
                  <span className="hidden sm:inline">{link.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Sub-Account Name */}
          {location?.name && (
            <div className="ml-2 pl-3 border-l border-white/20 flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-indigo-200/70 font-medium">Account</span>
              <span className="text-white font-semibold text-[13px] max-w-[160px] truncate">
                {location.name}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
