/**
 * Reliable clipboard copy utility
 * Works across all browsers and contexts
 */

export const copyToClipboard = async (text) => {
  if (!text) {
    console.error('No text to copy');
    return false;
  }

  // Method 1: Modern Clipboard API (preferred)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }
  }

  // Method 2: Fallback using textarea (works everywhere)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Make it invisible but accessible
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (successful) {
      return true;
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
  }

  // Method 3: Last resort - create selection range
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    
    document.body.appendChild(textArea);
    
    const selected = document.getSelection().rangeCount > 0
      ? document.getSelection().getRangeAt(0)
      : false;
    
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (selected) {
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(selected);
    }
    
    return true;
  } catch (err) {
    console.error('All copy methods failed:', err);
    return false;
  }
};

