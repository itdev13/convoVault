import React, { useState } from 'react';
import { Progress, Tag, Button, Tooltip, message as antMessage } from 'antd';
import { useAuth } from '../context/AuthContext';
import { billingAPI } from '../api/billing';

export default function ExportProgress({ job, onDownload, onRefresh }) {
  const { location } = useAuth() || {};
  const [downloading, setDownloading] = useState(false);
  if (!job) return null;

  // Get status color and text
  const getStatusConfig = (status) => {
    switch (status) {
      case 'completed':
        return { color: 'green', text: 'Completed', icon: '✓' };
      case 'processing':
        return { color: 'blue', text: 'Processing', icon: '⟳' };
      case 'pending':
        return { color: 'orange', text: 'Pending', icon: '○' };
      case 'failed':
        return { color: 'red', text: 'Failed', icon: '✕' };
      default:
        return { color: 'default', text: status, icon: '?' };
    }
  };

  const statusConfig = getStatusConfig(job.status);

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Handle download click — regenerate a FRESH presigned URL server-side (the stored downloadUrl
  // is signed with short-lived creds and dies within hours), then open it. Mirrors the History tab.
  const handleDownload = async () => {
    const jobId = job.jobId || job._id;
    if (!jobId) return;
    setDownloading(true);
    try {
      const response = await billingAPI.getDownloadUrl(jobId, location?.id);
      if (response.success && response.data?.url) {
        window.open(response.data.url, '_blank');
        if (onDownload) onDownload(response.data.url);
      } else {
        antMessage.error(response.error || 'Could not generate download link. Please try again.');
      }
    } catch (err) {
      const msg = err?.code === 'DOWNLOAD_EXPIRED'
        ? 'This download link has expired (7-day limit). Please run the export again.'
        : (err?.message || 'Could not generate download link. Please try again.');
      antMessage.error(msg);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header — thin indigo-tinted strip so it reads as a distinct card */}
      <div className="flex justify-between items-center px-5 py-3 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4.5 h-4.5 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-slate-800 capitalize truncate">{job.exportType} Export</h4>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">{job.format || 'csv'}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Started {formatDate(job.startedAt || job.createdAt)}</p>
          </div>
        </div>
        <Tag color={statusConfig.color} className="rounded-full">
          {statusConfig.icon} {statusConfig.text}
        </Tag>
      </div>

      <div className="p-5">
      {/* Progress Bar (for processing status) */}
      {job.status === 'processing' && (
        <div className="mb-4">
          <Progress
            percent={job.progress?.percent || 0}
            status="active"
            strokeColor={{ '0%': '#818cf8', '100%': '#4f46e5' }}
            trailColor="#E5E7EB"
          />
          <p className="text-xs text-slate-500 mt-1">
            {job.progress?.processed?.toLocaleString() || 0} / {job.progress?.total?.toLocaleString() || 0} items processed
          </p>
        </div>
      )}

      {/* Completed State — distinct success panel: big count, download as focal CTA */}
      {job.status === 'completed' && job.downloadUrl && (
        <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-5 text-center">
          <div className="text-4xl font-extrabold text-indigo-600 leading-none">
            {job.progress?.processed?.toLocaleString() || job.totalItems?.toLocaleString() || '-'}
          </div>
          <div className="text-xs font-medium uppercase tracking-wide text-indigo-500 mt-1.5">Messages exported</div>

          <Button
            type="primary"
            onClick={handleDownload}
            loading={downloading}
            className="mt-4 w-full h-11 bg-indigo-600 hover:bg-indigo-700 border-indigo-600 hover:border-indigo-700 rounded-lg shadow-sm"
            icon={!downloading && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          >
            {downloading ? 'Preparing…' : 'Download Export'}
          </Button>

          {job.downloadUrlExpiresAt && (
            <p className="text-[11px] text-slate-400 mt-2">
              Link expires {formatDate(job.downloadUrlExpiresAt)}
            </p>
          )}
        </div>
      )}

      {/* Failed State */}
      {job.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-red-800 font-medium">Export Failed</p>
              <p className="text-xs text-red-600 mt-1">
                {job.errorMessage || 'An error occurred during export. Please try again.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pending State */}
      {job.status === 'pending' && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div className="animate-pulse w-2 h-2 bg-orange-400 rounded-full"></div>
          <span>Waiting to start...</span>
        </div>
      )}

      {/* Info message for pending/processing - user can close page */}
      {['pending', 'processing'].includes(job.status) && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-blue-800 font-medium">You can close this page</p>
              <p className="text-xs text-blue-600 mt-1">
                We'll send you an email with the download link when your export is ready.
                You can also check the <span className="font-semibold">Exports</span> tab anytime to view your export history and download files.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Billing Info */}
      {/* {job.billing && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
          <span>Amount Charged</span>
          <span className="font-medium text-gray-700">${job.billing.amount}</span>
        </div>
      )} */}

      {/* Refresh Button (for non-completed jobs) */}
      {onRefresh && ['pending', 'processing'].includes(job.status) && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <Tooltip title="Check for updates">
            <Button
              type="link"
              size="small"
              onClick={onRefresh}
              className="text-xs p-0 h-auto text-gray-500 hover:text-gray-700"
            >
              Refresh Status
            </Button>
          </Tooltip>
        </div>
      )}
      </div>
    </div>
  );
}
