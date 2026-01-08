import React, { useState } from 'react';
import { getLiveUpdates, FEATURE_REQUEST_CTA, BADGE_CONFIGS } from '../constants/updates';

export default function UpdatesBanner() {
  const liveUpdates = getLiveUpdates();
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('updatesBannerDismissed') === 'true';
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('updatesBannerDismissed', 'true');
  };

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-4 mb-6 rounded-lg relative">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">NEW</span>
            <h3 className="text-base font-bold text-gray-900">Latest Updates</h3>
          </div>
          
          <div className="space-y-2 text-sm text-gray-700">
            {liveUpdates.map((update, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className={`font-bold ${
                  update.color === 'green' ? 'text-green-600' : 'text-blue-600'
                }`}>
                  {update.icon}
                </span>
                <span>
                  <strong>{update.title}:</strong> {update.description}
                </span>
              </div>
            ))}
            <div className="flex items-start gap-2">
              <span className="text-blue-600 font-bold">{FEATURE_REQUEST_CTA.icon}</span>
              <span>
                <strong>{FEATURE_REQUEST_CTA.title}</strong> {FEATURE_REQUEST_CTA.description}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

