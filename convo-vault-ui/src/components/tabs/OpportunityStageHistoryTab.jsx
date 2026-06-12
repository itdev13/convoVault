import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, DatePicker, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';
import dayjs from 'dayjs';

/**
 * Opportunity Stage History — custom-built export, gated per-location via AppConfig.
 *
 * Each output row = one (opportunity × stage) session, with:
 *   contactId, pipeline/stage names, enteredAt, leftAt, durationSeconds,
 *   inbound/outbound message bodies + timestamps (SMS, Email, Webchat, Voice transcript),
 *   contact custom fields + opportunity custom fields.
 *
 * Billing: flat $0.10 per row (no volume discount — custom build).
 */
export default function OpportunityStageHistoryTab() {
  const { location } = useAuth();

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

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

  const buildFilters = () => {
    const f = {};
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
      const response = await billingAPI.getEstimate(location.id, 'opportunityStageHistory', buildFilters());
      if (response.success) {
        setEstimate(response.data.estimate);
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
        ...buildFilters(),
        estimatedTotal: estimate?.itemCounts?.opportunityStageHistory || estimate?.itemCounts?.total || 0
      };
      const response = await billingAPI.chargeAndExport(location.id, 'opportunityStageHistory', format, filters, notificationEmail);
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
      setEstimateError(err.code === 'INSUFFICIENT_FUNDS' ? err : (err.message || 'Export failed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
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
        exportType="opportunityStageHistory"
        estimatingMessage="Walking your pipeline — this can take a few minutes for large accounts..."
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Opportunity Stage History</h2>
          <p className="text-sm text-gray-500 mt-1">
            Custom export — one row per (opportunity × stage) with all conversations, voice transcripts,
            and custom fields captured during each stage window. <strong className="text-emerald-700">Flat $0.10 per row.</strong>
          </p>
        </div>
      </div>

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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-gray-900">Filters</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date <span className="text-gray-400 text-xs">(optional)</span></label>
            <DatePicker
              value={startDate ? dayjs(startDate) : null}
              onChange={(date) => setStartDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="All time"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date <span className="text-gray-400 text-xs">(optional)</span></label>
            <DatePicker
              value={endDate ? dayjs(endDate) : null}
              onChange={(date) => setEndDate(date ? date.toDate() : null)}
              className="w-full"
              size="large"
              placeholder="Now"
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

        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <p className="text-sm text-emerald-900">
            <strong>What you'll get:</strong> A CSV with one row per opportunity-stage transition.
            Each row includes contact ID, pipeline + stage names, entered/left timestamps, all
            messages exchanged during that window (with channel + direction), Lead Connector Voice
            call transcripts, and both contact + opportunity custom fields.
          </p>
        </div>
      </div>
    </div>
  );
}
