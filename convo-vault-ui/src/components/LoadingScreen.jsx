import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-200">Loading ExportKit...</h2>
        <p className="text-slate-400 mt-2">Authenticating your session</p>
      </div>
    </div>
  );
}
