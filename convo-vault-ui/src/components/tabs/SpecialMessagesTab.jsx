import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Select, DatePicker, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

const MESSAGE_TYPES = [
  { value: 'TYPE_CALL', label: 'Call' },
  { value: 'TYPE_SMS', label: 'SMS' },
  { value: 'TYPE_RCS', label: 'RCS' },
  { value: 'TYPE_EMAIL', label: 'Email' },
  { value: 'TYPE_FACEBOOK', label: 'Facebook' },
  { value: 'TYPE_GMB', label: 'Google My Business' },
  { value: 'TYPE_INSTAGRAM', label: 'Instagram' },
  { value: 'TYPE_WHATSAPP', label: 'WhatsApp' },
  { value: 'TYPE_TIKTOK', label: 'TikTok' },
  { value: 'TYPE_LIVE_CHAT', label: 'Live Chat' },
  { value: 'TYPE_INTERNAL_CHAT', label: 'Internal Chat' },
  { value: 'TYPE_INTERNAL_COMMENTS', label: 'Internal Comments' },
  { value: 'TYPE_FORM_SUBMISSION', label: 'Form Submission' },
  { value: 'TYPE_ACTIVITY_APPOINTMENT', label: 'Appointment Activity' },
  { value: 'TYPE_ACTIVITY_CONTACT', label: 'Contact Activity' },
  { value: 'TYPE_ACTIVITY_INVOICE', label: 'Invoice Activity' },
  { value: 'TYPE_ACTIVITY_PAYMENT', label: 'Payment Activity' },
  { value: 'TYPE_ACTIVITY_OPPORTUNITY', label: 'Opportunity Activity' },
  { value: 'TYPE_ACTIVITY_WHATSAPP', label: 'WhatsApp Activity' },
  { value: 'TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG', label: 'Employee Action Log' },
];

export default function SpecialMessagesTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [specialExportId, setSpecialExportId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Filters
  const [chatType, setChatType] = useState('');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  // Poll active job status
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;
    const pollInterval = setInterval(async () => {
      try {
        const response = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (response.success) {
          setActiveJob(response.data);
          if (response.data.status === 'completed') {
            antMessage.success('Export completed! Click Download to get your file.');
          }
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const buildExportFilters = () => {
    const f = {};
    if (chatType) f.type = chatType;
    if (startDate) f.startDate = dayjs(startDate).startOf('day').valueOf();
    if (endDate) f.endDate = dayjs(endDate).endOf('day').valueOf();
    return f;
  };

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const response = await billingAPI.getEstimate(location.id, 'specialTabMessages', buildExportFilters());
      if (response.success) {
        setEstimate(response.data.estimate);
        setSpecialExportId(response.data.specialExportId || null);
      } else {
        setEstimateError(response.error || 'Failed to calculate estimate');
      }
    } catch (err) {
      setEstimateError(err.message || 'Failed to calculate estimate');
    } finally {
      setEstimating(false);
    }
  };

  const handlePayAndExport = async (notificationEmail, format = 'csv') => {
    setProcessing(true);
    setEstimateError(null);
    try {
      const filters = {
        ...buildExportFilters(),
        estimatedTotal: estimate?.itemCounts?.total || undefined,
        specialExportId: specialExportId || undefined
      };
      const response = await billingAPI.chargeAndExport(location.id, 'specialTabMessages', format, filters, notificationEmail);
      if (response.success) {
        setActiveJob({
          jobId: response.data.jobId,
          status: response.data.status,
          totalItems: response.data.totalItems,
          progress: { total: response.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
      } else {
        setEstimateError(response.error || 'Export failed');
      }
    } catch (err) {
      setEstimateError(err.message || 'Export failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (!processing) { setExportModalVisible(false); setEstimate(null); setEstimateError(null); }
  };

  return (
    <div className="space-y-6">
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="specialTabMessages"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Complete Messages</h2>
          <p className="text-sm text-gray-500 mt-1">Most accurate export — we walk every conversation for the selected message type so nothing is missed. Takes a bit longer than the standard Messages export.</p>
        </div>
      </div>

      {/* Active Export Progress */}
      {activeJob && (
        <ExportProgress
          job={activeJob}
          onRefresh={async () => {
            try {
              const response = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
              if (response.success) setActiveJob(response.data);
            } catch {}
          }}
          onDismiss={() => setActiveJob(null)}
        />
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-gray-900">Filters</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Message Type</label>
            <Select
              value={chatType || undefined}
              onChange={(val) => setChatType(val || '')}
              options={MESSAGE_TYPES}
              className="w-full"
              size="large"
              showSearch
              optionFilterProp="label"
              placeholder="Select message type"
              allowClear
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="Select start date"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="Select end date"
            />
          </div>

          <div>
            <Button
              type="primary"
              size="large"
              onClick={handleGetEstimate}
              loading={estimating}
              disabled={!location?.id}
              className="bg-green-600 hover:bg-green-700 border-green-600"
            >
              Get Estimate & Export
            </Button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            This will search all conversations{chatType
              ? <> for <strong>{MESSAGE_TYPES.find(t => t.value === chatType)?.label || chatType}</strong> messages</>
              : <> and fetch <strong>all message types</strong></>
            }, then export as CSV. Slower than the standard Messages export, but the most accurate —
            we walk every conversation so nothing is missed. Pricing: <strong>$0.02 per message</strong> (no volume discount).
          </p>
        </div>
      </div>
    </div>
  );
}
