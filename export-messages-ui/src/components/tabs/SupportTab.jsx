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
        <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm ring-1 ring-indigo-500/20">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Support</h2>
          <p className="text-sm text-slate-500">Need help? Reach out and we'll get back to you fast.</p>
        </div>
      </div>

      {/* Info */}
      <div className="bg-indigo-50 border border-solid border-indigo-200 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-indigo-900 text-lg mb-2">How We Can Help</h3>
            <ul className="space-y-2 text-sm text-indigo-800">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Technical issues with the app</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Questions about features or functionality</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Feature requests or suggestions</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Bug reports with screenshots</span>
              </li>
            </ul>
            <div className="mt-4 text-sm text-indigo-800 bg-white border border-indigo-200 rounded-lg p-3 flex items-center gap-2">
              <span className="text-base">📧</span>
              <span>
                <strong>Email us:</strong>{' '}
                <a href="mailto:binduchowdary856@gmail.com" className="font-bold text-indigo-600 underline hover:text-indigo-800">
                  binduchowdary856@gmail.com
                </a>
              </span>
            </div>
            <div className="mt-3 text-xs text-indigo-700 bg-indigo-100 rounded-lg p-3">
              If you have any issue, please reach out to <strong>binduchowdary856@gmail.com</strong> — we'll assist you immediately, typically within <strong>1 hour</strong> and no later than <strong>12 hours</strong>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

