import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { importAPI } from '../../api/import';
import { useQuery } from '@tanstack/react-query';
import { Progress, Button, Modal } from 'antd';

export default function ImportTab() {
  const { location } = useAuth();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(Date.now());
  const [modalVisible, setModalVisible] = useState(false);
  const [modalJobDetails, setModalJobDetails] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [parsing, setParsing] = useState(false);

  // Fetch import history
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['import-history', location?.id],
    queryFn: () => importAPI.getJobs(location.id),
    enabled: !!location?.id,
    refetchInterval: jobId ? 3000 : false, // Refresh while import is running
    cacheTime: 0, // Don't cache - always fetch fresh
    staleTime: 0 // Data is immediately stale
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (20MB limit)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      setJobStatus({
        status: 'failed',
        error: `File size exceeds 20MB limit. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB. Please contact support to increase your limit.`
      });
      setFileInputKey(Date.now()); // Reset file input
      return;
    }

    setSelectedFile(file);
    setJobStatus(null);
    setJobId(null);
    setParsing(true);
    setPreviewData(null);

    try {
      // Parse file to show preview
      const text = await file.text();
      const lines = text.trim().split('\n');
      
      if (lines.length > 0) {
        // Get headers
        const headers = lines[0].split(',').map(h => h.trim());
        
        // Get first 5 data rows
        const dataRows = lines.slice(1, 6).map(line => {
          const values = line.split(',').map(v => v.trim());
          const row = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });
          return row;
        });

        setPreviewData({
          headers,
          rows: dataRows,
          totalRows: lines.length - 1 // Exclude header
        });
      }
    } catch (error) {
      console.error('Failed to parse file:', error);
    } finally {
      setParsing(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setJobStatus(null);

      const response = await importAPI.upload(selectedFile, location.id);
      
      // Start polling for status
      setJobId(response.data.jobId);
      setSelectedFile(null);
      setFileInputKey(Date.now());
      
      // Refresh history
      refetchHistory();
    } catch (error) {
      setJobStatus({
        status: 'failed',
        error: error.message
      });
    } finally {
      setUploading(false);
    }
  };

  // Poll for job status
  useEffect(() => {
    if (!jobId) return;

    const pollStatus = async () => {
      try {
        const response = await importAPI.getStatus(jobId);
        setJobStatus(response.data);

        // Stop polling if completed or failed
        if (response.data.status === 'completed' || response.data.status === 'failed') {
          setJobId(null); // Stop polling
          refetchHistory(); // Refresh history when job completes
        }
      } catch (error) {
        console.error('Failed to get status:', error);
      }
    };

    // Poll immediately
    pollStatus();

    // Then poll every 2 seconds
    const interval = setInterval(pollStatus, 2000);

    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Import Conversations</h2>
          <p className="text-sm text-gray-500">Upload CSV with contacts to create conversations</p>
        </div>
      </div>

      {/* Download Template */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-1 border-solid border-blue-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center shadow-md">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-blue-900 text-lg mb-1">Download CSV Template</h3>
            <p className="text-sm text-blue-700 mb-3">
              Get the CSV template with sample data. Just 4 columns: contactId, name, email, phone
            </p>
            <button
              onClick={() => importAPI.downloadTemplate()}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all font-semibold shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Template
            </button>
          </div>
        </div>
      </div>

      {/* File Upload */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Select File to Import
        </label>
        <label className="block cursor-pointer">
          <div className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
            selectedFile
              ? 'border-green-400 bg-gradient-to-br from-green-50 to-emerald-50'
              : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/30'
          }`}>
            {selectedFile ? (
              <div>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="font-bold text-lg text-gray-900">{selectedFile.name}</div>
                <div className="text-sm text-gray-600 mt-2 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedFile(null);
                    setPreviewData(null);  // Reset preview
                    setJobStatus(null);    // Reset job status
                    setJobId(null);        // Reset job ID
                    setFileInputKey(Date.now()); // Reset file input
                  }}
                  className="mt-4 text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Remove file
                </button>
              </div>
            ) : (
              <div>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="text-lg font-semibold text-gray-700 mb-2">
                  Click to upload or drag and drop
                </div>
                <div className="text-sm text-gray-500">
                  CSV, XLSX, XLS files supported
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Maximum file size: 20MB
                </div>
                <div className="text-xs text-purple-600 mt-2 font-medium">
                  💡 Need larger limits? Contact our Support team to request an increase
                </div>
              </div>
            )}
          </div>
          <input
            key={fileInputKey}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>
      </div>

      {/* File Preview */}
      {previewData && !parsing && (
        <div className="bg-white border-2 border-solid border-green-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">📊 File Preview</h3>
              <p className="text-sm text-gray-600">
                Showing first 5 rows • Total rows in file: <span className="font-semibold text-green-600">{previewData.totalRows}</span>
              </p>
            </div>
            <div className="bg-green-100 px-3 py-1 rounded-full">
              <span className="text-sm font-semibold text-green-700">✓ File Parsed</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gradient-to-r from-purple-50 to-blue-50">
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase border-1 border-solid border-gray-200">#</th>
                  {previewData.headers.map((header, idx) => (
                    <th key={idx} className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase border-1 border-solid border-gray-200">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-600 font-semibold border-1 border-solid border-gray-200">{rowIdx + 1}</td>
                    {previewData.headers.map((header, cellIdx) => (
                      <td key={cellIdx} className="px-4 py-3 text-gray-700 border-1 border-solid border-gray-200 max-w-xs truncate" title={row[header]}>
                        {row[header] || <span className="text-gray-400 italic">empty</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {previewData.totalRows > 5 && (
            <div className="mt-3 text-center text-sm text-gray-500">
              ... and {previewData.totalRows - 5} more rows
            </div>
          )}
        </div>
      )}

      {/* Parsing Indicator */}
      {parsing && (
        <div className="bg-blue-50 border-1 border-solid border-blue-200 rounded-xl p-6 text-center">
          <div className="animate-spin h-8 w-8 border-3 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-blue-700 font-medium">Parsing file...</p>
        </div>
      )}

      {/* Upload Button */}
      {selectedFile && previewData && !parsing && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl px-8 py-4 hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl font-semibold text-lg flex items-center justify-center gap-3"
        >
          {uploading ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
              Uploading and Importing...
            </>
          ) : (
            <>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3v-8" />
              </svg>
              Start Import ({previewData.totalRows} rows)
            </>
          )}
        </button>
      )}

      {/* Import Progress */}
      {jobStatus && (
        <div className={`rounded-xl p-6 ${
          jobStatus.status === 'completed'
            ? 'bg-green-50 border-1 border-solid border-green-200'
            : jobStatus.status === 'failed'
            ? 'bg-red-50 border-1 border-solid border-red-200'
            : 'bg-blue-50 border-1 border-solid border-blue-200'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            {jobStatus.status === 'processing' && (
              <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            )}
            <div className={`font-bold text-lg ${
              jobStatus.status === 'completed' ? 'text-green-700' : 
              jobStatus.status === 'failed' ? 'text-red-700' : 
              'text-blue-700'
            }`}>
              {jobStatus.status === 'processing' && '⏳ Processing Import...'}
              {jobStatus.status === 'completed' && '✅ Import Completed!'}
              {jobStatus.status === 'failed' && '❌ Import Failed'}
            </div>
          </div>

          {/* Progress Bar */}
          {jobStatus.status === 'processing' && (
            <div className="mb-4">
              <Progress
                percent={Math.round((jobStatus.processed / jobStatus.totalRows) * 100)}
                status="active"
                strokeColor={{ from: '#3b82f6', to: '#2563eb' }}
              />
              <div className="text-sm text-blue-700 mt-2">
                Processing {jobStatus.processed} of {jobStatus.totalRows} rows...
              </div>
            </div>
          )}

          {/* Results */}
          {(jobStatus.status === 'completed' || jobStatus.status === 'failed') && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="bg-white rounded-lg p-3">
                  <div className="text-gray-600">Total Rows</div>
                  <div className="text-2xl font-bold text-gray-900">{jobStatus.totalRows}</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-gray-600">Created</div>
                  <div className="text-2xl font-bold text-green-600">{jobStatus.successful}</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-gray-600">Skipped</div>
                  <div className="text-2xl font-bold text-yellow-600">{jobStatus.skipped || 0}</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-gray-600">Failed</div>
                  <div className="text-2xl font-bold text-red-600">{jobStatus.failed}</div>
                </div>
              </div>

              {/* Errors */}
              {jobStatus.errors && jobStatus.errors.length > 0 && (
                <div className="bg-white rounded-lg p-4">
                  <div className="font-semibold text-red-900 mb-2">Errors:</div>
                  <div className="space-y-1 text-sm max-h-60 overflow-y-auto">
                    {jobStatus.errors.map((err, idx) => (
                      <div key={idx} className="text-red-700 border-b border-red-100 pb-1">
                        <strong>Row {err.row}:</strong> {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="bg-gradient-to-br from-gray-50 to-slate-50 border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 text-lg mb-3">Import Conversations - Simple Format ✨</h3>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="bg-blue-50 p-3 rounded-lg border-1 border-solid border-blue-200">
                <strong className="text-blue-900">🎯 Two Ways to Import:</strong>
                <div className="mt-2 space-y-1 text-blue-800">
                  <div><strong>Option 1:</strong> Have contactId → Creates conversation</div>
                  <div><strong>Option 2:</strong> Provide name, email, or phone → Auto-creates contact + conversation</div>
                </div>
              </div>
              
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <div>
                  <strong className="text-gray-900">Columns:</strong> locationId, contactId, name, email, phone + optional fields
                  <div className="text-xs mt-1 text-gray-600">
                    Optional: companyName, address, city, state, postalCode, country, website, timezone, dateOfBirth, gender, tags
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <strong className="text-gray-900">Auto-creates contacts</strong> using email and/or phone
                </div>
              </div>
              
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <div>
                  <strong className="text-gray-900">Creates conversations</strong> automatically for each contact
                </div>
              </div>
            </div>
            <div className="mt-4 bg-white rounded-lg p-3 border-1 border-solid border-gray-200">
              <div className="text-xs text-gray-600 font-mono space-y-1">
                <div><strong>Minimal:</strong> rf6...,1q8..., , ,</div>
                <div><strong>Full data:</strong> rf6..., ,John,john@mail.com,+123,TechCorp,123 St,NYC,NY,10001,US,site.com,America/New_York,1990-01-15,male,vip;lead</div>
                <div><strong>Tags:</strong> Use semicolons to separate: vip;customer;priority</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import History */}
      {historyData?.data?.jobs && historyData.data.jobs.length > 0 && (
        <div className="bg-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Import History</h3>
          <div className="space-y-3">
            {historyData.data.jobs.map((job) => (
              <div
                key={job.jobId}
                className="bg-gray-50 border-1 border-solid border-gray-200 rounded-lg p-4 hover:border-blue-400 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      job.status === 'completed' ? 'bg-green-500' :
                      job.status === 'processing' ? 'bg-blue-500 animate-pulse' :
                      job.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                    }`}></div>
                    <div>
                      <div className="font-medium text-gray-900">{job.fileName}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm">
                      <span className="text-green-600 font-semibold">{job.successful}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-yellow-600 font-semibold">{job.skipped || 0}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-red-600 font-semibold">{job.failed}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-600">{job.totalRows}</span>
                    </div>
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                      job.status === 'completed' ? 'bg-green-100 text-green-700' :
                      job.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                      job.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                    </span>
                  </div>
                </div>

                {/* View Details Button */}
                <div className="mt-3">
                  <Button
                    size="small"
                    type="link"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const details = await importAPI.getStatus(job.jobId);
                      setModalJobDetails(details.data);
                      setModalVisible(true);
                    }}
                  >
                    View Details →
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Details Modal */}
      <Modal
        title="Import Job Details"
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setModalJobDetails(null);
        }}
        footer={[
          <Button key="close" onClick={() => setModalVisible(false)}>
            Close
          </Button>
        ]}
        width={700}
      >
        {modalJobDetails && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-600">File Name</div>
                  <div className="font-semibold">{modalJobDetails.fileName}</div>
                </div>
                <div>
                  <div className="text-gray-600">Status</div>
                  <div className={`font-semibold ${
                    modalJobDetails.status === 'completed' ? 'text-green-600' :
                    modalJobDetails.status === 'failed' ? 'text-red-600' : 'text-blue-600'
                  }`}>
                    {modalJobDetails.status.toUpperCase()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Total Rows</div>
                  <div className="font-semibold text-gray-900">{modalJobDetails.totalRows}</div>
                </div>
                <div>
                  <div className="text-gray-600">Processed</div>
                  <div className="font-semibold text-gray-900">{modalJobDetails.processed}</div>
                </div>
                <div>
                  <div className="text-gray-600">Successful</div>
                  <div className="font-semibold text-green-600">{modalJobDetails.successful}</div>
                </div>
                <div>
                  <div className="text-gray-600">Failed</div>
                  <div className="font-semibold text-red-600">{modalJobDetails.failed}</div>
                </div>
                <div>
                  <div className="text-gray-600">Started At</div>
                  <div className="text-sm">{modalJobDetails.startedAt ? new Date(modalJobDetails.startedAt).toLocaleString() : 'N/A'}</div>
                </div>
                <div>
                  <div className="text-gray-600">Completed At</div>
                  <div className="text-sm">{modalJobDetails.completedAt ? new Date(modalJobDetails.completedAt).toLocaleString() : 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Progress Overview */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-gray-100 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-900">{modalJobDetails.totalRows}</div>
                <div className="text-xs text-gray-600">Total Rows</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{modalJobDetails.successful}</div>
                <div className="text-xs text-green-700">Created</div>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-600">{modalJobDetails.skipped || 0}</div>
                <div className="text-xs text-yellow-700">Skipped</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{modalJobDetails.failed}</div>
                <div className="text-xs text-red-700">Failed</div>
              </div>
            </div>

            {/* Processing Details */}
            {modalJobDetails.successful > 0 && (
              <div className="bg-green-50 border-1 border-solid border-green-200 rounded-lg p-4">
                <h4 className="font-semibold text-green-900 mb-2">✅ Successfully Created:</h4>
                <div className="text-sm text-green-800">
                  <div>• {modalJobDetails.successful} contacts created/found</div>
                  <div>• {modalJobDetails.successful} conversations created</div>
                </div>
              </div>
            )}
            
            {/* Skipped Details */}
            {modalJobDetails.skipped > 0 && (
              <div className="bg-yellow-50 border-1 border-solid border-yellow-200 rounded-lg p-4">
                <h4 className="font-semibold text-yellow-900 mb-2">⏭️ Skipped (Duplicates):</h4>
                <div className="text-sm text-yellow-800">
                  <div>• {modalJobDetails.skipped} duplicate rows detected</div>
                  <div>• These contacts already existed in the file</div>
                  <div className="text-xs text-yellow-700 mt-2">
                    Only the first occurrence of each contact was processed
                  </div>
                </div>
              </div>
            )}

            {/* Errors */}
            {modalJobDetails.errors && modalJobDetails.errors.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">❌ Errors ({modalJobDetails.errors.length}):</h4>
                <div className="bg-red-50 rounded-lg p-4 max-h-80 overflow-y-auto space-y-3">
                  {modalJobDetails.errors.map((err, idx) => (
                    <div key={idx} className="bg-white rounded-lg border-1 border-solid border-red-200 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="font-bold text-red-900">Row {err.row}</div>
                        <div className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">Error</div>
                      </div>
                      
                      {/* Error Message */}
                      <div className="bg-red-50 rounded p-2 mb-3">
                        <div className="text-sm text-red-700 font-medium">{err.error}</div>
                      </div>

                      {/* Row Data */}
                      {err.data && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-gray-700 mb-2">Row Data:</div>
                          <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 rounded p-3">
                            {err.data.locationId && (
                              <div>
                                <span className="text-gray-600">LocationId:</span>
                                <div className="font-mono text-gray-900 mt-1">{err.data.locationId}</div>
                              </div>
                            )}
                            {err.data.contactId && (
                              <div>
                                <span className="text-gray-600">ContactId:</span>
                                <div className="font-mono text-gray-900 mt-1">{err.data.contactId}</div>
                              </div>
                            )}
                            {err.data.name && (
                              <div>
                                <span className="text-gray-600">Name:</span>
                                <div className="text-gray-900 mt-1">{err.data.name}</div>
                              </div>
                            )}
                            {err.data.email && (
                              <div>
                                <span className="text-gray-600">Email:</span>
                                <div className="text-gray-900 mt-1">{err.data.email}</div>
                              </div>
                            )}
                            {err.data.phone && (
                              <div>
                                <span className="text-gray-600">Phone:</span>
                                <div className="text-gray-900 mt-1">{err.data.phone}</div>
                              </div>
                            )}
                            {err.data.companyName && (
                              <div>
                                <span className="text-gray-600">Company:</span>
                                <div className="text-gray-900 mt-1">{err.data.companyName}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Success Message */}
            {modalJobDetails.status === 'completed' && modalJobDetails.failed === 0 && (
              <div className="bg-green-50 border-1 border-solid border-green-200 rounded-lg p-4 text-center">
                <div className="text-green-700 font-semibold">
                  ✅ All {modalJobDetails.successful} conversations imported successfully!
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

