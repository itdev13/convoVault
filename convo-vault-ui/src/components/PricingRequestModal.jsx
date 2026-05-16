import React, { useState } from 'react';
import { billingAPI } from '../api/billing';

const AUTO_APPROVE_THRESHOLD = 10000;

export default function PricingRequestModal({ isOpen, onClose, locationId, currentPrice = 0.018, defaultEmail = '' }) {
  const [proposedPrice, setProposedPrice] = useState('0.012');
  const [expectedVolume, setExpectedVolume] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const volumeNum = parseInt(expectedVolume, 10);
  const priceNum = parseFloat(proposedPrice);
  const willAutoApprove = Number.isFinite(volumeNum) && volumeNum >= AUTO_APPROVE_THRESHOLD;
  const canSubmit = Number.isFinite(priceNum) && priceNum > 0
                 && Number.isFinite(volumeNum) && volumeNum > 0
                 && /\S+@\S+\.\S+/.test(email)
                 && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await billingAPI.submitPricingRequest({
        locationId,
        proposedCreditPrice: priceNum,
        expectedVolume: volumeNum,
        email,
        reason
      });
      setResult(res?.data || res);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const isApproved = result?.status === 'approved';
  const isPending  = result?.status === 'pending';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-fade-in">
        {/* Header */}
        <div className={`px-6 py-4 ${isApproved ? 'bg-gradient-to-r from-green-500 to-green-600' : isPending ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-indigo-500 to-purple-600'}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-white">
              {isApproved ? '✓ Approved' : isPending ? 'Request Received' : 'Request a Custom Rate'}
            </h3>
            <button onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {!result && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                Current rate: <strong>${currentPrice.toFixed(4)} per credit</strong>. Tell us your volume and we'll work out a price that fits.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected total records to download <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={expectedVolume}
                  onChange={(e) => setExpectedVolume(e.target.value)}
                  placeholder="e.g., 15000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {willAutoApprove
                    ? '✓ Above 10,000 — will be approved instantly at your proposed rate.'
                    : 'Below 10,000 — request goes to manual review (1-2 hour response).'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Proposed credit price ($) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={proposedPrice}
                  onChange={(e) => setProposedPrice(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email for response <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason (optional)
                </label>
                <textarea
                  rows="2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Anything we should know about this request"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          )}

          {result && (
            <div className="space-y-3">
              <p className="text-gray-700 leading-relaxed">{result.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className={`px-5 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${isApproved ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isApproved ? 'Close & refresh estimate' : 'Got it'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
