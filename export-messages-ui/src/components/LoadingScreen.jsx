import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-700">Loading Export Messages...</h2>
        <p className="text-gray-500 mt-2">Authenticating your session</p>
      </div>
    </div>
  );
}

