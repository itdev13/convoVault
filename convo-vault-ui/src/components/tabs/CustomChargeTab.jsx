import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';

export default function CustomChargeTab() {
  const { location } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleCharge = async () => {
    setError(null);
    setResult(null);

    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      setError('Enter a valid amount greater than 0');
      return;
    }

    setLoading(true);
    try {
      const res = await billingAPI.customCharge(location.id, parsed);
      setResult({ chargeId: res.data?.chargeId, amount: res.data?.amount });
      setAmount('');
    } catch (err) {
      setError(err.response?.data?.error || 'Charge failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-10">
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Custom Charge</h2>
      <p className="text-sm text-gray-500 mb-6">Enter an amount to charge this account directly.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(null); setResult(null); }}
              placeholder="0.00"
              className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
            {error}
          </div>
        )}

        {result && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            Charged <span className="font-semibold">${result.amount}</span> successfully.
            {result.chargeId && <span className="block text-xs text-green-600 mt-0.5">Charge ID: {result.chargeId}</span>}
          </div>
        )}

        <button
          onClick={handleCharge}
          disabled={loading || !amount}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
        >
          {loading ? 'Charging...' : 'Charge Account'}
        </button>
      </div>
    </div>
  );
}
