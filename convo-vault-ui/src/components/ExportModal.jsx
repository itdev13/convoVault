import React, { useState } from 'react';
import { Modal, DatePicker, Radio, Button, Alert } from 'antd';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function ExportModal({ visible, onCancel, onExport, loading = false }) {
  const [dateRangeType, setDateRangeType] = useState('7days'); // '7days', '1month', '6months', 'custom'
  const [customDateRange, setCustomDateRange] = useState(null);
  const [error, setError] = useState('');

  // Calculate date ranges
  const getDateRange = () => {
    let startDate;
    let endDate;

    switch (dateRangeType) {
      case '7days':
        endDate = dayjs();
        startDate = endDate.subtract(7, 'days');
        break;
      case '1month':
        endDate = dayjs();
        startDate = endDate.subtract(1, 'month');
        break;
      case '6months':
        endDate = dayjs();
        startDate = endDate.subtract(6, 'months');
        break;
      case 'custom':
        if (!customDateRange || !customDateRange[0] || !customDateRange[1]) {
          return null;
        }
        startDate = customDateRange[0];
        endDate = customDateRange[1];
        break;
      default:
        return null;
    }

    // Validate 6-month limit
    const monthsDiff = endDate.diff(startDate, 'month', true);
    if (monthsDiff > 6) {
      setError('Date range cannot exceed 6 months. Please contact support for larger exports.');
      return null;
    }

    setError('');
    // Return formatted date strings (YYYY-MM-DD) - components will convert to ISO timestamps for API
    return {
      startDate: startDate.format('YYYY-MM-DD'),
      endDate: endDate.format('YYYY-MM-DD')
    };
  };

  const handleExport = () => {
    const dateRange = getDateRange();
    
    if (!dateRange) {
      if (!error) {
        setError('Please select a date range');
      }
      return;
    }

    onExport(dateRange);
  };

  const handleDateRangeChange = (dates) => {
    setCustomDateRange(dates);
    setError('');

    if (dates && dates[0] && dates[1]) {
      const monthsDiff = dates[1].diff(dates[0], 'month', true);
      if (monthsDiff > 6) {
        setError('Date range cannot exceed 6 months. Please contact support for larger exports.');
      }
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onCancel}
      title={
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Export Conversations</h3>
            <p className="text-sm text-gray-500">Select date range for export</p>
          </div>
        </div>
      }
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>,
        <Button
          key="export"
          type="primary"
          onClick={handleExport}
          loading={loading}
          disabled={!!error && dateRangeType === 'custom'}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          {loading ? 'Exporting...' : 'Export CSV'}
        </Button>
      ]}
      width={600}
      centered
    >
      <div className="space-y-6 py-4">
        {/* Date Range Selection */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            Select Date Range
          </label>
          <Radio.Group
            value={dateRangeType}
            onChange={(e) => {
              setDateRangeType(e.target.value);
              setError('');
              if (e.target.value !== 'custom') {
                setCustomDateRange(null);
              }
            }}
            className="w-full"
          >
            <div className="space-y-3">
              <Radio value="7days" className="w-full py-2">
                <div>
                  <div className="font-medium">Last 7 Days</div>
                  <div className="text-xs text-gray-500">
                    {dayjs().subtract(7, 'days').format('MMM DD')} - {dayjs().format('MMM DD, YYYY')}
                  </div>
                </div>
              </Radio>
              <Radio value="1month" className="w-full py-2">
                <div>
                  <div className="font-medium">Last 1 Month</div>
                  <div className="text-xs text-gray-500">
                    {dayjs().subtract(1, 'month').format('MMM DD')} - {dayjs().format('MMM DD, YYYY')}
                  </div>
                </div>
              </Radio>
              <Radio value="6months" className="w-full py-2">
                <div>
                  <div className="font-medium">Last 6 Months</div>
                  <div className="text-xs text-gray-500">
                    {dayjs().subtract(6, 'months').format('MMM DD')} - {dayjs().format('MMM DD, YYYY')}
                  </div>
                </div>
              </Radio>
              <Radio value="custom" className="w-full py-2">
                <div className="flex-1">
                  <div className="font-medium mb-2">Custom Date Range</div>
                  <RangePicker
                    value={customDateRange}
                    onChange={handleDateRangeChange}
                    format="YYYY-MM-DD"
                    className="w-full"
                    size="large"
                    disabledDate={(current) => {
                      // Disable dates more than 6 months ago
                      const sixMonthsAgo = dayjs().subtract(6, 'months');
                      return current && current.isBefore(sixMonthsAgo);
                    }}
                  />
                </div>
              </Radio>
            </div>
          </Radio.Group>
        </div>

        {/* Error Message */}
        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError('')}
          />
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 text-sm text-blue-800">
              <div className="font-semibold mb-1">Export Information:</div>
              <ul className="space-y-1 list-disc list-inside">
                <li>Maximum export period: 6 months</li>
                <li>Large exports will be split into multiple CSV files (chunks)</li>
                <li>Each chunk contains up to 50,000 conversations</li>
                <li>Need more than 6 months? Raise a support request</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Support Request CTA */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 text-sm text-yellow-800">
              <div className="font-semibold mb-1">Need More Data?</div>
              <p>
                For exports beyond 6 months or custom requirements, please visit the{' '}
                <strong>Support tab</strong> and raise a request. We'll process it within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

