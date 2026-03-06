import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Tooltip, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

export default function TasksTab() {
  const { location } = useAuth();
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

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

  // Handle get estimate
  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);

    try {
      const response = await billingAPI.getEstimate(location.id, 'tasks', {});
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

  // Handle pay and export
  const handlePayAndExport = async (notificationEmail, format = 'csv') => {
    setProcessing(true);
    setEstimateError(null);

    try {
      const response = await billingAPI.chargeAndExport(
        location.id,
        'tasks',
        format,
        {},
        notificationEmail
      );

      if (response.success) {
        setActiveJob({
          jobId: response.data.jobId,
          status: response.data.status,
          totalItems: response.data.totalItems,
          progress: { total: response.data.totalItems, processed: 0, percent: 0 }
        });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success('Export started! We\'ll process it in the background.');
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
    if (!processing) {
      setExportModalVisible(false);
      setEstimate(null);
      setEstimateError(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Estimate Modal */}
      <ExportEstimateModal
        visible={exportModalVisible}
        onCancel={handleModalClose}
        onConfirm={handlePayAndExport}
        loading={processing}
        estimating={estimating}
        estimate={estimate}
        error={estimateError}
        exportType="tasks"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-1">Export all contact tasks from this sub-account</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleGetEstimate}
            disabled={activeJob && ['pending', 'processing'].includes(activeJob.status)}
            size="large"
            type="primary"
            className="bg-green-600 hover:bg-green-700 border-green-600"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Export Tasks
          </Button>
          <Tooltip
            title={
              <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Pay-per-use export</strong>
                <br />
                $0.002 per task. No volume discounts.
              </div>
            }
            placement="left"
          >
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center cursor-help">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Active Export Job Progress */}
      {activeJob && (
        <ExportProgress
          job={activeJob}
          onRefresh={() => {
            billingAPI.getExportStatus(activeJob.jobId, location?.id)
              .then(res => res.success && setActiveJob(res.data))
              .catch(console.error);
          }}
        />
      )}

      {/* Info Card */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">✅</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">How Tasks Export Works</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">1.</span>
                <span>We scan all contacts in your sub-account</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">2.</span>
                <span>For each contact, we fetch all their tasks</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">3.</span>
                <span>Tasks are exported with contact details, status, and due dates into a CSV or JSON file</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">4.</span>
                <span>You receive an email with a download link when ready</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 bg-white/60 rounded-lg p-4 border border-green-100">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Pricing</h4>
          <div className="flex items-center gap-6 text-sm text-gray-700">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span><strong>$0.002</strong> per task (0.2 cents)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
              <span>No volume discounts</span>
            </div>
          </div>
        </div>

        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-800">
            <strong>Note:</strong> The estimate is based on sampling a subset of contacts. The actual count may vary slightly from the estimate.
          </p>
        </div>
      </div>

      {/* CSV Columns Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['TaskID', 'ContactID', 'ContactName', 'Title', 'Body', 'DueDate', 'Status', 'Completed', 'AssignedTo', 'DateAdded'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
