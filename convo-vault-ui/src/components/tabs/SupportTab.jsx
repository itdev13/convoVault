import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Input, Button, Upload, message as antMessage } from 'antd';
import { supportAPI } from '../../api/support';

const { TextArea } = Input;

export default function SupportTab() {
  const { location, ghlContext } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [fileList, setFileList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  const [emailError, setEmailError] = useState('');

  // Get base64 for preview
  const getBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle preview
  const handlePreview = async (file) => {
    if (!file.url && !file.preview) {
      file.preview = await getBase64(file.originFileObj);
    }
    setPreviewImage(file.url || file.preview);
    setPreviewOpen(true);
  };

  // Email validation
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Handle email input change
  const handleEmailChange = (e) => {
    const email = e.target.value;
    setFormData({ ...formData, email });
    
    // Clear error when user starts typing
    if (emailError) setEmailError('');
    
    // Validate on blur or when user stops typing
    if (email && !validateEmail(email)) {
      setEmailError('Please enter a valid email address');
    } else {
      setEmailError('');
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.email || !formData.subject || !formData.message) {
      antMessage.error('Please fill in all required fields');
      return;
    }

    // Validate email format
    if (!validateEmail(formData.email)) {
      setEmailError('Please enter a valid email address');
      antMessage.error('Invalid email address');
      return;
    }

    try {
      setSubmitting(true);
      setResult(null);

      const formDataToSend = new FormData();
      formDataToSend.append('name', formData.name);
      formDataToSend.append('email', formData.email);
      formDataToSend.append('subject', formData.subject);
      formDataToSend.append('message', formData.message);
      formDataToSend.append('locationId', location?.id || '');
      formDataToSend.append('userId', ghlContext?.userId || '');

      // Add images
      fileList.forEach(file => {
        if (file.originFileObj) {
          formDataToSend.append('images', file.originFileObj);
        }
      });

      const response = await supportAPI.submitTicket(formDataToSend);

      setResult({
        success: true,
        message: response.message
      });

      // Reset form
      setFormData({
        name: '',
        email: '',
        subject: '',
        message: ''
      });
      setFileList([]);
      antMessage.success('Support ticket submitted successfully!');

    } catch (error) {
      console.error('Support ticket error:', error);
      setResult({
        success: false,
        message: error.response?.data?.error || error.message || 'Failed to submit support ticket'
      });
      antMessage.error('Failed to submit support ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Support</h2>
          <p className="text-sm text-gray-500">Need help? Send us a message and we'll get back to you</p>
        </div>
      </div>

      {/* Support Form */}
      <div className="bg-white border-1 border-solid border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Name <span className="text-gray-400">(Optional)</span>
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              size="large"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address <span className="text-red-500">*</span>
            </label>
            <Input
              type="email"
              value={formData.email}
              onChange={handleEmailChange}
              onBlur={() => {
                if (formData.email && !validateEmail(formData.email)) {
                  setEmailError('Please enter a valid email address');
                }
              }}
              placeholder="your@email.com"
              size="large"
              required
              status={emailError ? 'error' : ''}
            />
            {emailError && (
              <div className="text-red-500 text-xs mt-1 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {emailError}
              </div>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Subject <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="What do you need help with?"
              size="large"
              required
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message <span className="text-red-500">*</span>
            </label>
            <TextArea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Describe your issue or question in detail..."
              rows={6}
              size="large"
              required
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Attachments <span className="text-gray-400">(Optional - Max 5 images, 5MB each)</span>
            </label>
            <Upload
              listType="picture-card"
              fileList={fileList}
              onChange={({ fileList: newFileList }) => setFileList(newFileList)}
              onPreview={handlePreview}
              beforeUpload={() => false}
              accept="image/*"
              maxCount={5}
            >
              {fileList.length < 5 && (
                <div className="text-center">
                  <div className="text-2xl mb-1">📷</div>
                  <div className="text-xs text-gray-600">Upload Image</div>
                </div>
              )}
            </Upload>
            <div className="text-xs text-gray-500 mt-2">
              💡 Tip: Click on uploaded images to preview them
            </div>
          </div>

          {/* Image Preview Modal */}
          {previewOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
              onClick={() => setPreviewOpen(false)}
            >
              <div className="relative max-w-4xl max-h-screen p-4">
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="absolute top-6 right-6 w-10 h-10 bg-white rounded-full flex items-center justify-center hover:bg-gray-100 shadow-lg z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <img 
                  src={previewImage} 
                  alt="Preview" 
                  className="max-w-full max-h-screen rounded-lg shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="primary"
            size="large"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!formData.email || !formData.subject || !formData.message || emailError}
            className="w-full"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          >
            {submitting ? 'Sending...' : 'Submit Support Ticket'}
          </Button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-xl p-6 ${
          result.success
            ? 'bg-green-50 border-1 border-solid border-green-200'
            : 'bg-red-50 border-1 border-solid border-red-200'
        }`}>
          <div className={`font-semibold text-lg mb-2 ${
            result.success ? 'text-green-700' : 'text-red-700'
          }`}>
            {result.success ? '✅ Ticket Submitted!' : '❌ Submission Failed'}
          </div>
          <div className={`text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
            {result.message}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-1 border-solid border-blue-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-blue-900 text-lg mb-2">How We Can Help</h3>
            <ul className="space-y-2 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Technical issues with the app</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Questions about features or functionality</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Feature requests or suggestions</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Bug reports with screenshots</span>
              </li>
            </ul>
            <div className="mt-4 text-xs text-blue-700 bg-blue-100 rounded-lg p-3">
              <strong>📧 Response Time:</strong> We typically respond within 24 hours
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

