import React from 'react';

export default function ErrorScreen({ error }) {
  const isNotConnected = error && error.includes('not connected');
  const isInstallRequired = error === 'INSTALL_REQUIRED';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
        <div className="text-center">
          <div className="text-5xl mb-4">{isInstallRequired ? '📦' : '⚠️'}</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {isInstallRequired ? 'App Not Installed' : 'Connection Error'}
          </h2>
          <p className="text-gray-600 mb-6">
            {isInstallRequired 
              ? 'ConvoVault is not installed in this sub-account. Please install the app first.'
              : error
            }
          </p>
          
          {(isNotConnected || isInstallRequired) ? (
            <div className="text-left space-y-4">
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-xl p-6">
                <h3 className="font-bold text-purple-900 mb-4 text-lg">📌 Installation Required</h3>
                <ol className="list-decimal list-inside space-y-3 text-sm text-purple-900">
                  <li className="font-medium">
                    <strong>Install ConvoVault via OAuth:</strong>
                    <br />
                    <a 
                      href="https://marketplace.gohighlevel.com/integration/694f93f8a6babf0c821b1356" 
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold"
                    >
                      🔐 Connect Your Sub-Account
                    </a>
                  </li>
                  <li className="mt-3">Login to your account and select a sub-account to connect</li>
                  <li>After successful installation, refresh this page</li>
                  <li>Find "ConvoVault" in your sub-account's left sidebar to access</li>
                </ol>
              </div>

              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 text-sm">
                <p className="font-semibold mb-2 text-yellow-900">⚠️ Important:</p>
                <p className="text-yellow-800">
                  This app must be installed via OAuth before it can be used. 
                  After installation, it will appear as "ConvoVault" in your sub-account navigation menu.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-left bg-gray-50 p-4 rounded">
              <p className="font-semibold">Please ensure:</p>
              <ul className="list-disc list-inside space-y-1 text-gray-600">
                <li>The app is properly installed</li>
              </ul>
            </div>
          )}
          
          <div className="flex gap-3 mt-6">
            {!isInstallRequired && (
            <button
              onClick={() => window.location.reload()}
                className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
                🔄 Retry
            </button>
            )}
            {(isNotConnected || isInstallRequired) && (
              <a
                href="https://convoapi.vaultsuite.store/oauth/authorize"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-center font-medium"
              >
                📦 Install ConvoVault
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

