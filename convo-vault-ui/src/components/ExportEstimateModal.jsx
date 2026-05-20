import React, { useState } from 'react';
import { Modal, Button, Spin, Alert, Input, Collapse, Radio } from 'antd';
import { UNIT_PRICES, OLD_UNIT_PRICES, formatUnitPrice as formatPrice } from '../constants/pricing';
import { useAuth } from '../context/AuthContext';
import PricingRequestModal from './PricingRequestModal';

// Threshold above which we surface the "Request custom rate" link inside this modal.
const PRICING_REQUEST_THRESHOLD = 30;
// Test location — always shows the link regardless of finalAmount, so we can exercise the flow
// on small/free exports during QA. Remove once the feature is broadly rolled out.
const PRICING_REQUEST_TEST_LOCATION_ID = 'WHspQgeC5SqFU8i55G7L';

const { Panel } = Collapse;

export default function ExportEstimateModal({
  visible,
  onCancel,
  onConfirm,
  loading = false,
  estimating = false,
  estimate = null,
  error = null,
  exportType = 'messages',
  usingDefaultDates = false,
  postExportBilling = false,
  estimatingMessage = null,
  // When true, this modal is reused for the Import Notes flow:
  //   - hides email field + format selector
  //   - changes title/button copy
  //   - onConfirm() is invoked with no args (no email/format)
  importMode = false,
}) {
  console.log('estimate modal props', estimate, exportType, postExportBilling);
  const [email, setEmail] = useState('');
  const [exportFormat, setExportFormat] = useState('csv');
  const [pricingRequestOpen, setPricingRequestOpen] = useState(false);
  const { location, ghlContext } = useAuth() || {};
  const currentLocationId = location?.id || location?.locationId || ghlContext?.locationId || null;

  // Format currency (value is in dollars) - use 4 decimal places for sub-cent amounts
  const formatCurrency = (value) => {
    const num = Number(value) || 0;
    if (num > 0 && num < 0.01) return `$${num.toFixed(4)}`;
    return `$${num.toFixed(2)}`;
  };

  // Format large numbers
  const formatNumber = (num) => {
    return (Number(num) || 0).toLocaleString();
  };

  // Format unit price for display (price is in dollars, e.g., 0.05 = $0.02)
  const formatUnitPrice = (price) => {
    const num = Number(price) || 0;
    return `$${num.toFixed(4)}`;
  };

  // Calculate credit multipliers from unit prices (base = lowest price)
  const getCreditMultipliers = () => {
    const unitPrices = estimate?.unitPrices || UNIT_PRICES;
    const basePrice = Math.min(unitPrices.conversations, unitPrices.smsWhatsapp);
    return {
      conversations: Math.round(unitPrices.conversations / basePrice),
      smsWhatsapp: Math.round(unitPrices.smsWhatsapp / basePrice),
      email: Math.round(unitPrices.email / basePrice)
    };
  };

  const CREDIT_MULTIPLIERS = getCreditMultipliers();

  // Calculate credits for a given channel
  const getCredits = (channel, count) => {
    return (Number(count) || 0) * (CREDIT_MULTIPLIERS[channel] || 1);
  };

  // Calculate total credits from estimate.
  // Email uses tiered creditsPerItem from breakdown (2 or 3); every other type is 1 credit per item.
  const getTotalCredits = (est) => {
    if (!est?.breakdown) return 0;
    const flatTypes = ['conversations', 'smsWhatsapp', 'contacts', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs', 'templates', 'customFields', 'customValues', 'tags'];
    const flat = flatTypes.reduce((sum, k) => sum + (Number(est.breakdown[k]?.count) || 0), 0);
    const emailCreditsPerItem = est.breakdown.email?.creditsPerItem || CREDIT_MULTIPLIERS.email;
    return flat + (Number(est.breakdown.email?.count) || 0) * emailCreditsPerItem;
  };

  // Calculate price per credit
  const getPricePerCredit = (est) => {
    const totalCredits = getTotalCredits(est);
    if (totalCredits === 0) return 0;
    return (Number(est.finalAmount) || 0) / totalCredits;
  };

  // Validate email format
  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return email && emailRegex.test(email.trim());
  };

  const handleConfirm = () => {
    if (importMode) {
      onConfirm();
      return;
    }
    if (!isValidEmail(email)) {
      return; // Button should be disabled anyway
    }
    onConfirm(email.trim(), exportFormat);
  };

  return (
    <Modal
      open={visible}
      onCancel={onCancel}
      title={
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{importMode ? 'Import Estimate' : 'Export Estimate'}</h3>
            <p className="text-sm text-gray-500">{importMode ? 'Review your import cost' : 'Review your export cost'}</p>
          </div>
        </div>
      }
      footer={null}
      width={600}
      centered
    >
      {/* Loading State */}
      {estimating && (
        <div className="flex flex-col justify-center items-center py-12">
          <Spin size="large" />
          <span className="mt-4 text-gray-600">{estimatingMessage || 'Calculating estimate...'}</span>
        </div>
      )}

      {/* Error State */}
      {error && !estimating && (() => {
        // Backend "no data" responses are expected outcomes of the user's filter choice,
        // not failures — render them as an info alert instead of a red error.
        const isNoData = /^No (items|notes|billable)/i.test(String(error));
        return (
          <Alert
            type={isNoData ? 'info' : 'error'}
            message={isNoData ? 'No data to export' : 'Error'}
            description={isNoData ? 'We couldn\'t find any data for the selected filters. This can sometimes happen due to system load — please try once more. If it still shows no data, adjust your filters and try again.' : error}
            className="mb-4"
            showIcon
          />
        );
      })()}

      {/* Post-Export Billing State (notes/tasks all-contacts) */}
      {postExportBilling && !estimating && !error && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
            <svg className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">All Contacts Export — Billed After Export</p>
              <p className="text-sm text-blue-800">
                Since no specific contacts are selected, all contacts in the location will be exported.
                The total count is unknown upfront — you will be charged <span className="line-through text-gray-400">${OLD_UNIT_PRICES.notesAndTasks}</span> <strong className="text-green-700">${UNIT_PRICES.notesAndTasks} per {exportType === 'notes' ? 'note' : 'task'}</strong> after the export completes.
              </p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-700">Price per {exportType === 'notes' ? 'note' : 'task'}</span>
              <span className="font-semibold flex items-center gap-2">
                <span className="line-through text-gray-400 text-xs">${OLD_UNIT_PRICES.notesAndTasks}</span>
                <span className="text-green-600">${UNIT_PRICES.notesAndTasks}</span>
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2">
              <span className="text-gray-700">Billing</span>
              <span className="font-semibold text-green-700">After export completes</span>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email Address
              <span className="text-red-500">*</span>
            </label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              size="large"
              className="rounded-lg"
              status={email && !isValidEmail(email) ? 'error' : ''}
              style={{ backgroundColor: 'white', borderColor: email && !isValidEmail(email) ? '#ef4444' : '#d1d5db', fontSize: '14px' }}
            />
            {email && !isValidEmail(email) && (
              <p className="text-xs text-red-500 mt-1">Please enter a valid email address</p>
            )}
            <p className="text-xs text-gray-500 mt-2">We'll send you the download link when your export is ready.</p>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
            <Radio.Group value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
              <Radio value="csv">CSV</Radio>
              <Radio value="json">JSON</Radio>
            </Radio.Group>
          </div>

          <div className="flex gap-3">
            <Button onClick={onCancel} className="flex-1 h-11" disabled={loading}>Cancel</Button>
            <Button
              type="primary"
              onClick={handleConfirm}
              loading={loading}
              disabled={!isValidEmail(email)}
              className="flex-1 h-11 bg-green-600 hover:bg-green-700 border-green-600 hover:border-green-700"
            >
              {loading ? 'Starting...' : 'Start Export'}
            </Button>
          </div>
        </div>
      )}

      {/* No Data State */}
      {!postExportBilling && estimate && !estimating && (!estimate.itemCounts?.total || estimate.itemCounts?.total === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h4 className="text-lg font-semibold text-gray-700 mb-2">No Data Available to Export</h4>
          <p className="text-sm text-gray-500 max-w-xs">
            {['notes', 'tasks'].includes(exportType)
              ? `There are no ${exportType}.`
              : `There are no ${exportType} matching your current filters. Try adjusting your date range or filters.`}
          </p>
          <Button onClick={onCancel} className="mt-6">
            Close
          </Button>
        </div>
      )}

      {/* Estimate Content */}
      {!postExportBilling && estimate && !estimating && estimate.itemCounts?.total > 0 && (
        <div className="space-y-2">
          {/* Dynamic Volume Pricing Callout — celebrates the volume tier the user just unlocked.
              Tier ladder (mirrors getSmsPricing / getEmailPricing in billingService):
                Email  ≤50k → $0.036/email (base)   >50k → $0.020 (44% off)   >100k → $0.002 (94% off, floor)
                SMS    ≤50k → $0.018/msg   (base)   >50k → $0.010 (44% off)   >100k → $0.001 (94% off, floor)
              The >100k tier is the floor price — no further volume discount stacks on top of it.
              Hidden for export types that don't use the volume-discount ladder at all (matches
              the "View Volume Discount Tiers" section's visibility rule). */}
          {!['specialTabMessages', 'callTranscriptions', 'opportunityStageHistory', 'contactBundle'].includes(exportType) && (() => {
            const emailCount = Number(estimate.breakdown?.email?.count) || 0;
            const smsCount = Number(estimate.breakdown?.smsWhatsapp?.count) || 0;
            const tiers = [];
            if (emailCount > 100000)     tiers.push({ pct: 94, label: `${formatNumber(emailCount)} emails`,   detail: 'rate dropped to $0.002/email (floor price)' });
            else if (emailCount > 50000) tiers.push({ pct: 44, label: `${formatNumber(emailCount)} emails`,   detail: 'rate dropped to $0.020/email' });
            if (smsCount > 100000)       tiers.push({ pct: 94, label: `${formatNumber(smsCount)} messages`,   detail: 'rate dropped to $0.001/message (floor price)' });
            else if (smsCount > 50000)   tiers.push({ pct: 44, label: `${formatNumber(smsCount)} messages`,   detail: 'rate dropped to $0.010/message' });
            if (tiers.length === 0) return null;
            const topPct = Math.max(...tiers.map(t => t.pct));
            return (
              <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 p-3 shadow-md">
                <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/15 rounded-full blur-2xl pointer-events-none"></div>
                <div className="absolute -bottom-10 -left-6 w-32 h-32 bg-teal-300/20 rounded-full blur-3xl pointer-events-none"></div>
                <div className="relative flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-xl">
                    🎉
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-bold bg-white text-emerald-700 px-1.5 py-0.5 rounded uppercase tracking-wider">Tier unlocked</span>
                      <span className="text-white font-bold text-sm">You're saving up to {topPct}%</span>
                    </div>
                    <ul className="space-y-0.5">
                      {tiers.map((t, i) => (
                        <li key={i} className="text-emerald-50 text-xs flex items-center gap-1.5">
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          <span><strong className="text-white">{t.label}</strong> — {t.detail} <span className="text-emerald-100">({t.pct}% off)</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Default Date Range Info Banner */}
          {usingDefaultDates && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-800">
                Showing data from the <strong>last 6 months</strong>. To change the time frame, close this modal and adjust the date filters.
              </p>
            </div>
          )}

          {/* Export Summary */}
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-200">
            <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {importMode ? 'Import Summary' : 'Export Summary'}
            </h4>
            <div className="space-y-2 text-sm">
              {/* Conversations */}
              {estimate.breakdown?.conversations?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Conversations</span>
                    <div className="text-xs text-gray-500">{CREDIT_MULTIPLIERS.conversations} credit per conversation</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.conversations.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(getCredits('conversations', estimate.breakdown.conversations.count))} credits</div>
                  </div>
                </div>
              )}

              {/* Text Messages (SMS, WhatsApp, etc.) */}
              {estimate.breakdown?.smsWhatsapp?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Text Messages</span>
                    <div className="text-xs text-gray-500">{CREDIT_MULTIPLIERS.smsWhatsapp} credit per message</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.smsWhatsapp.count)} </span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(getCredits('smsWhatsapp', estimate.breakdown.smsWhatsapp.count))} credits</div>
                  </div>
                </div>
              )}

              {/* Email Messages */}
              {estimate.breakdown?.email?.count > 0 && !importMode && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Email Messages</span>
                    <div className="text-xs text-gray-500">{estimate.breakdown.email.creditsPerItem || CREDIT_MULTIPLIERS.email} credits per email</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.email.count)} emails</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber((Number(estimate.breakdown.email.count) || 0) * (estimate.breakdown.email.creditsPerItem || CREDIT_MULTIPLIERS.email))} credits</div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {estimate.breakdown?.notes?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Notes</span>
                    <div className="text-xs text-gray-500">1 credit per note</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.notes.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.notes.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Tasks */}
              {estimate.breakdown?.tasks?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Tasks</span>
                    <div className="text-xs text-gray-500">1 credit per task</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.tasks.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.tasks.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Opportunities */}
              {estimate.breakdown?.opportunities?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Opportunities</span>
                    <div className="text-xs text-gray-500">1 credit per opportunity</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.opportunities.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.opportunities.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Form Submissions */}
              {estimate.breakdown?.formSubmissions?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Form Submissions</span>
                    <div className="text-xs text-gray-500">1 credit per submission</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.formSubmissions.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.formSubmissions.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Links */}
              {estimate.breakdown?.links?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Links</span>
                    <div className="text-xs text-gray-500">1 credit per link</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.links.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.links.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Social Posts */}
              {estimate.breakdown?.socialPosts?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Social Posts</span>
                    <div className="text-xs text-gray-500">1 credit per post</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.socialPosts.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.socialPosts.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Call Logs */}
              {estimate.breakdown?.callLogs?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Call Logs</span>
                    <div className="text-xs text-gray-500">1 credit per call log</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.callLogs.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.callLogs.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Templates */}
              {estimate.breakdown?.templates?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Templates</span>
                    <div className="text-xs text-gray-500">1 credit per template</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.templates.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.templates.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Contacts */}
              {!importMode && estimate.breakdown?.contacts?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Contacts</span>
                    <div className="text-xs text-gray-500">1 credit per contact</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.contacts.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.contacts.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Custom Fields */}
              {!importMode && estimate.breakdown?.customFields?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Custom Fields</span>
                    <div className="text-xs text-gray-500">1 credit per field</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.customFields.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.customFields.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Custom Values */}
              {!importMode && estimate.breakdown?.customValues?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Custom Values</span>
                    <div className="text-xs text-gray-500">1 credit per item</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.customValues.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.customValues.count)} credits</div>
                  </div>
                </div>
              )}

              {/* Tags */}
              {estimate.breakdown?.tags?.count > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <span className="text-gray-700 font-medium">Tags</span>
                    <div className="text-xs text-gray-500">1 credit per tag</div>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-gray-800">{formatNumber(estimate.breakdown.tags.count)}</span>
                    <div className="text-xs text-indigo-600 font-medium">{formatNumber(estimate.breakdown.tags.count)} credits</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pricing Breakdown */}
          <div className="bg-blue-50 rounded-lg px-4 py-2 border border-blue-200">
            <div className="space-y-2 text-sm">
              {/* Credit-based pricing for every export type. Every $0.018 item = 1 credit; email is tiered (2–3 credits). */}
              {!importMode && ['conversations', 'messages', 'contacts', 'notes', 'tasks', 'opportunities', 'formSubmissions', 'links', 'socialPosts', 'callLogs', 'templates', 'customFields', 'customValues', 'tags'].includes(exportType) && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Credits</span>
                    <span className="font-medium">{formatNumber(getTotalCredits(estimate))}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Price per Credit</span>
                    <span className="font-medium flex items-center gap-2">
                      <span className="line-through text-gray-400 text-xs">{formatUnitPrice(OLD_UNIT_PRICES.conversations)}</span>
                      <span className="text-green-600">{formatUnitPrice(getPricePerCredit(estimate))}</span>
                    </span>
                  </div>
                </>
              )}

              {/* Import mode (notes / contacts / custom fields / custom values) — flat per-row pricing, no discount tiers */}
              {importMode && (() => {
                const importLabels = {
                  contacts: { plural: 'Contacts to import', unit: 'Contact', breakdownKey: 'contacts' },
                  customFields: { plural: 'Custom Fields to import', unit: 'Field', breakdownKey: 'customFields' },
                  customValues: { plural: 'Custom Values to import', unit: 'Value', breakdownKey: 'customValues' },
                  notes: { plural: 'Notes to import', unit: 'Note', breakdownKey: 'notes' },
                };
                const cfg = importLabels[exportType] || importLabels.notes;
                const unitPrice = estimate.breakdown?.[cfg.breakdownKey]?.unitPrice ?? 0;
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-700">{cfg.plural}</span>
                      <span className="font-medium">{formatNumber(estimate.itemCounts?.total)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-700">Price per {cfg.unit}</span>
                      <span className="font-medium text-gray-800">{formatUnitPrice(unitPrice)}</span>
                    </div>
                  </>
                );
              })()}

              {exportType === 'opportunityStageHistory' && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Projected stage rows</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.opportunityStageHistory || estimate.itemCounts?.total)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Price per row</span>
                    <span className="font-medium text-gray-800">${(estimate.breakdown?.opportunityStageHistory?.unitPrice ?? 0.10).toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                    Custom-built export — flat per-row pricing, no volume discounts.
                    Final row count reconciled at export time; you're charged for actual rows delivered.
                  </div>
                </>
              )}

              {exportType === 'specialTabMessages' && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Total Messages</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.total)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Price per Message</span>
                    <span className="font-medium text-gray-800">$0.018</span>
                  </div>
                  <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                    Custom-built export — no volume discounts apply
                  </div>
                </>
              )}

              {exportType === 'callTranscriptions' && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Conversations walked</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.conversationsTraversed || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Call messages scanned</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.callMessagesScanned || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Transcriptions retrieved</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.total)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Price per Transcription</span>
                    <span className="font-medium text-gray-800">$0.05</span>
                  </div>
                  <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                    Heavy task — we walk every conversation in the sub-account, scan every call,
                    and pull each available transcript individually. No volume discounts apply.
                  </div>
                </>
              )}

              {exportType === 'contactBundle' && (
                <>
                  {/* Per-category breakdown — counts × unit prices for the three billed categories.
                      Falls back to the estimate.itemCounts shape that the /estimate endpoint returns. */}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Messages (SMS / WhatsApp / Webchat / FB / IG)</span>
                    <span className="font-medium">
                      {formatNumber(estimate.itemCounts?.contactBundleSms ?? estimate.breakdown?.sms?.count ?? 0)}
                      <span className="text-gray-400 ml-2">× $0.02</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Emails</span>
                    <span className="font-medium">
                      {formatNumber(estimate.itemCounts?.contactBundleEmail ?? estimate.breakdown?.email?.count ?? 0)}
                      <span className="text-gray-400 ml-2">× $0.04</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Call transcriptions</span>
                    <span className="font-medium">
                      {formatNumber(estimate.itemCounts?.contactBundleCall ?? estimate.breakdown?.call?.count ?? 0)}
                      <span className="text-gray-400 ml-2">× $0.05</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-blue-100">
                    <span className="text-gray-700">Total rows</span>
                    <span className="font-medium">{formatNumber(estimate.itemCounts?.total ?? 0)}</span>
                  </div>
                  <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                    Heavy task — we walk every selected contact's conversations, fetch emails in bulk,
                    and pull a transcript for each eligible call. No volume discounts apply.
                  </div>
                </>
              )}

              {estimate.discountPercent > 0 && (
                <div className="flex justify-between items-center text-green-600">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Volume Discount ({estimate.discountPercent}%)
                  </span>
                  <span className="font-medium">-{formatCurrency(estimate.discountAmount)}</span>
                </div>
              )}

              <div className="flex justify-between items-center pt-3 border-t border-blue-200">
                <span className="text-lg font-bold text-gray-800">Total</span>
                <span className="text-xl font-bold text-green-600">{formatCurrency(estimate.finalAmount)}</span>
              </div>
            </div>
          </div>

          {/* Custom-rate request link: surface when bill is meaningful ($30+) OR for the test location, and we have a location to scope the override to. */}
          {/* Hide the "Request a custom rate" prompt once the run is already on the
              high-volume tier (> 100k items). At that point we're already at the floor price
              ($0.001/SMS, $0.002/email, no further discount) — asking for a lower rate
              doesn't make sense and would be misleading. */}
          {currentLocationId
            && (Number(estimate.finalAmount) > PRICING_REQUEST_THRESHOLD || currentLocationId === PRICING_REQUEST_TEST_LOCATION_ID)
            && (Number(estimate.itemCounts?.total) || 0) <= 100000
            && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-sm text-amber-900">💬 Think the price is too high?</span>
              <button
                type="button"
                onClick={() => setPricingRequestOpen(true)}
                className="text-sm font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-2"
              >
                Request a custom rate
              </button>
            </div>
          )}

          {/* Savings Banner - Show prominently when discount applied */}
          {estimate.discountPercent > 0 && (
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg px-4 py-2 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium opacity-90">Volume Discount Applied!</div>
                    <div className="text-2xl font-bold">You're saving {formatCurrency(estimate.discountAmount)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">{estimate.discountPercent}%</div>
                  <div className="text-xs opacity-80">OFF</div>
                </div>
              </div>
            </div>
          )}

          {/* Volume Discount Tiers - Shown when the estimate provides tiers. Hidden for the standalone-billed flows (specialTabMessages/callTranscriptions) which have no volume discounts. */}
          {(estimate.discountTiers?.length > 0) && !['specialTabMessages', 'callTranscriptions', 'opportunityStageHistory', 'contactBundle'].includes(exportType) && (
          <Collapse ghost className="bg-gray-50 rounded-lg" defaultActiveKey={estimate.discountPercent > 0 ? [] : []}>
            <Panel
              header={
                <span className="text-xs text-gray-600 font-medium flex items-center gap-2">
                  {estimate.discountPercent > 0 ? (
                    <>
                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Your Tier: <strong className="text-green-600">{estimate.discountPercent}% Discount</strong></span>
                    </>
                  ) : (
                    'View Volume Discount Tiers'
                  )}
                </span>
              }
              key="1"
            >
              <div className="text-xs space-y-1">
                {(estimate.discountTiers || []).map((tier) => (
                  <div
                    key={tier.discount}
                    className={`flex justify-between p-1.5 rounded ${
                      estimate.discountPercent === tier.discount
                        ? 'bg-green-100 text-green-700 font-medium'
                        : 'text-gray-500'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {estimate.discountPercent === tier.discount && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {tier.range}
                    </span>
                    <span>{tier.discount}% discount</span>
                  </div>
                ))}
              </div>
            </Panel>
          </Collapse>
          )}

          {/* Email Notification - Required (export only) */}
          {!importMode && (
          <div className="bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email Address
              <span className="text-red-500">*</span>
            </label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              size="large"
              className="rounded-lg"
              status={email && !isValidEmail(email) ? 'error' : ''}
              style={{
                backgroundColor: 'white',
                borderColor: email && !isValidEmail(email) ? '#ef4444' : '#d1d5db',
                fontSize: '14px'
              }}
            />
            {email && !isValidEmail(email) && (
              <p className="text-xs text-red-500 mt-1">
                Please enter a valid email address
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              We'll send you the download link when your export is ready. Download links expire after 1 week.
            </p>
          </div>
          )}

          {/* Export Format (export only) */}
          {!importMode && (
          <div className="bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Export Format
            </label>
            <Radio.Group value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
              <Radio value="csv">CSV</Radio>
              <Radio value="json">JSON</Radio>
            </Radio.Group>
            <p className="text-xs text-gray-500 mt-2">
              {exportFormat === 'csv' ? 'Spreadsheet-friendly format. Opens in Excel, Google Sheets, etc.' : 'Structured data format. Ideal for developers and integrations.'}
            </p>
          </div>
          )}

          {/* Payment Info */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm text-yellow-800">
              Payment will be deducted from your <strong>wallet balance</strong>. No card required.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={onCancel}
              className="flex-1 h-11"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={handleConfirm}
              loading={loading}
              disabled={importMode ? false : !isValidEmail(email)}
              className="flex-1 h-11 bg-green-600 hover:bg-green-700 border-green-600 hover:border-green-700 disabled:bg-gray-400 disabled:border-gray-400"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              }
            >
              {loading ? 'Processing...' : (importMode ? 'Charge & Import' : 'Export')}
            </Button>
          </div>
        </div>
      )}
      <PricingRequestModal
        isOpen={pricingRequestOpen}
        onClose={() => setPricingRequestOpen(false)}
        locationId={currentLocationId}
        currentPrice={0.018}
        defaultEmail={email}
      />
    </Modal>
  );
}
