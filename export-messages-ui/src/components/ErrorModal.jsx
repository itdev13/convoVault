import React from 'react';
import { Modal } from 'antd';

/**
 * Reusable Error Modal Component
 * Replaces browser alert() with a better UX
 */
export default function ErrorModal({ visible, title, message, onClose }) {
  return (
    <Modal
      open={visible}
      onCancel={onClose}
      onOk={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-red-900 font-semibold">{title || 'Error'}</span>
        </div>
      }
      footer={[
        <button
          key="close"
          onClick={onClose}
          className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
        >
          Close
        </button>
      ]}
      centered
    >
      <div className="py-4">
        <p className="text-gray-700">{message}</p>
      </div>
    </Modal>
  );
}

/**
 * Hook to use error modal
 */
export const useErrorModal = () => {
  const [error, setError] = React.useState(null);

  const showError = (title, message) => {
    setError({ title, message });
  };

  const hideError = () => {
    setError(null);
  };

  const ErrorModalComponent = error ? (
    <ErrorModal
      visible={!!error}
      title={error.title}
      message={error.message}
      onClose={hideError}
    />
  ) : null;

  return { showError, hideError, ErrorModalComponent };
};

