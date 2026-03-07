import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { billingAPI } from '../../api/billing';
import { Button, Input, message as antMessage } from 'antd';
import ExportEstimateModal from '../ExportEstimateModal';
import ExportProgress from '../ExportProgress';

const LINK_LIMIT = 25;

export default function LinksTab() {
  const { location } = useAuth();

  // Export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  // Filter
  const [query, setQuery] = useState('');

  // Preview results
  const [links, setLinks] = useState([]);
  const [linksTotal, setLinksTotal] = useState(0);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

  // Load on mount
  useEffect(() => {
    if (!location?.id) return;
    handleSearch(1);
  }, [location?.id]);

  // Poll active job
  useEffect(() => {
    if (!activeJob || !['pending', 'processing'].includes(activeJob.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await billingAPI.getExportStatus(activeJob.jobId, location?.id);
        if (res.success) {
          setActiveJob(res.data);
          if (res.data.status === 'completed') antMessage.success('Export completed! Click Download to get your file.');
        }
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, location?.id]);

  const handleSearch = async (targetPage = 1) => {
    setLinksLoading(true);
    setLinksError(null);
    setSearched(true);
    setPage(targetPage);
    try {
      const res = await billingAPI.searchLinks(location.id, query, targetPage, LINK_LIMIT);
      if (res.success) {
        setLinks(res.data.links || []);
        setLinksTotal(res.data.total || 0);
      } else {
        setLinksError(res.error || 'Failed to load links');
        setLinks([]);
        setLinksTotal(0);
      }
    } catch (err) {
      setLinksError(err.message || 'Failed to load links');
      setLinks([]);
      setLinksTotal(0);
    } finally {
      setLinksLoading(false);
    }
  };

  const handleNewSearch = () => handleSearch(1);

  const handleGetEstimate = async () => {
    setExportModalVisible(true);
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await billingAPI.getEstimate(location.id, 'links', query ? { query } : {});
      if (res.success) setEstimate(res.data.estimate);
      else setEstimateError(res.error || 'Failed to calculate estimate');
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
      const res = await billingAPI.chargeAndExport(
        location.id, 'links', format, query ? { query } : {}, notificationEmail
      );
      if (res.success) {
        setActiveJob({ jobId: res.data.jobId, status: res.data.status, totalItems: res.data.totalItems, progress: { total: res.data.totalItems, processed: 0, percent: 0 } });
        setExportModalVisible(false);
        setEstimate(null);
        antMessage.success("Export started! We'll notify you by email when it's ready.");
      } else {
        setEstimateError(res.error || 'Export failed');
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

  const isExporting = activeJob && ['pending', 'processing'].includes(activeJob.status);
  const totalPages = Math.ceil(linksTotal / LINK_LIMIT);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

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
        exportType="links"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Links</h2>
          <p className="text-sm text-gray-500 mt-1">
            {searched && linksTotal > 0
              ? `${linksTotal.toLocaleString()} link${linksTotal !== 1 ? 's' : ''} found`
              : 'Search and export trigger links from this sub-account'}
          </p>
        </div>
        <Button
          onClick={handleGetEstimate}
          disabled={isExporting}
          size="large"
          type="primary"
          className="bg-green-600 hover:bg-green-700 border-green-600"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          Export Links
        </Button>
      </div>

      {/* Active Export Progress */}
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

      {/* Search */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter Links
        </h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search links by name..."
              size="large"
              onPressEnter={handleNewSearch}
              prefix={
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
            />
          </div>
          <Button
            onClick={handleNewSearch}
            loading={linksLoading}
            size="large"
            type="primary"
            icon={!linksLoading && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          >
            Search
          </Button>
        </div>
      </div>

      {/* Loading */}
      {linksLoading && (
        <div className="text-center py-14">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Loading links...</p>
        </div>
      )}

      {/* Error */}
      {linksError && !linksLoading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-red-800 text-sm">Error loading links</p>
            <p className="text-red-600 text-xs mt-1">{linksError}</p>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !linksLoading && !linksError && links.length === 0 && (
        <div className="text-center py-16 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl border-2 border-dashed border-yellow-300">
          <div className="text-4xl mb-3">🔗</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No Links Found</h3>
          <p className="text-gray-500 text-sm mb-4">Try adjusting your search and try again</p>
          {page > 1 && (
            <Button size="small" onClick={() => handleSearch(page - 1)}>Previous Page</Button>
          )}
        </div>
      )}

      {/* Results */}
      {!linksLoading && !linksError && links.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {(page - 1) * LINK_LIMIT + 1}–{Math.min(page * LINK_LIMIT, linksTotal)} of {linksTotal.toLocaleString()} links
            </span>
            <div className="flex gap-2">
              <Button size="small" disabled={!hasPrev} onClick={() => handleSearch(page - 1)}>Previous</Button>
              <Button size="small" disabled={!hasNext} type="primary" onClick={() => handleSearch(page + 1)}>Next</Button>
            </div>
          </div>

          <div className="space-y-2">
            {links.map((link) => (
              <div key={link.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{link.name || '(No name)'}</p>
                      {link.redirectTo && (
                        <p className="text-xs text-blue-600 truncate mt-0.5 max-w-md" title={link.redirectTo}>
                          {link.redirectTo}
                        </p>
                      )}
                      {link.fieldKey && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">{link.fieldKey}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {(hasPrev || hasNext) && (
            <div className="flex justify-center gap-2 pt-2">
              <Button disabled={!hasPrev} onClick={() => handleSearch(page - 1)}>Previous</Button>
              <Button disabled={!hasNext} type="primary" onClick={() => handleSearch(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Export Columns */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Columns</h3>
        <div className="flex flex-wrap gap-2">
          {['LinkID', 'Name', 'RedirectTo', 'FieldKey', 'LocationID'].map((col) => (
            <span key={col} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-full">{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
