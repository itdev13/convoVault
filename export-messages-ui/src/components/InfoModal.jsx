import React, { useState } from 'react';

/**
 * Reusable Info Modal Component
 * Used for success messages, export confirmations, etc.
 */
export default function InfoModal({ isOpen, onClose, title, message, details }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white">{title || 'Success'}</h3>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {message && (
            <p className="text-gray-700 text-base mb-4 leading-relaxed">
              {message}
            </p>
          )}

          {details && details.length > 0 && (
            <div className="space-y-3">
              {details.map((detail, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  {detail.icon && (
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0">{detail.icon}</span>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 mb-1">{detail.title}</div>
                        <div className="text-sm text-gray-600">{detail.description}</div>
                        {detail.items && detail.items.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {detail.items.map((item, idx) => (
                              <li key={idx} className="text-sm text-gray-600 flex items-start gap-2">
                                <span className="text-gray-400">•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  {!detail.icon && (
                    <div>
                      {detail.title && <div className="font-semibold text-gray-900 mb-1">{detail.title}</div>}
                      {detail.description && <div className="text-sm text-gray-600">{detail.description}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors shadow-md"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage Info Modal state
 */
export function useInfoModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState([]);

  const showInfo = (infoTitle, infoMessage, infoDetails = []) => {
    setTitle(infoTitle);
    setMessage(infoMessage);
    setDetails(infoDetails);
    setIsOpen(true);
  };

  const closeInfo = () => {
    setIsOpen(false);
    setTimeout(() => {
      setTitle('');
      setMessage('');
      setDetails([]);
    }, 300);
  };

  const InfoModalComponent = isOpen ? (
    <InfoModal
      isOpen={isOpen}
      onClose={closeInfo}
      title={title}
      message={message}
      details={details}
    />
  ) : null;

  return { showInfo, closeInfo, InfoModalComponent };
}

