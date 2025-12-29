import { useEffect, useState, useRef } from 'react';

/**
 * Hook to get GHL context using official User Context API
 * Based on: https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps
 * Returns: { locationId, companyId, userId, email, userName, type }
 */
export const useGHLContext = () => {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const attemptCountRef = useRef(0);
  const resolvedRef = useRef(false);
  const MAX_ATTEMPTS = 3;

  useEffect(() => {
    let timeoutId;
    let messageHandler;
    
    // Skip if already resolved (prevents React StrictMode double-run)
    if (resolvedRef.current) {
      console.log('⏭️ Skipping - already resolved');
      return;
    }
    
    const initGHL = async () => {
      try {
        console.log('🔍 Initializing GHL User Context (Official Method)...');
        
        // Official Method: REQUEST_USER_DATA postMessage
        // Reference: https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps
        const getUserContext = async () => {
          return new Promise((resolve, reject) => {
            let localTimeoutId;
            
            messageHandler = ({ data, origin }) => {
              // Verify origin is from GHL
              if (!origin.includes('gohighlevel.com') && !origin.includes('leadconnectorhq.com')) {
                return;
              }

              console.log('📬 Received message from GHL:', data.message);

              // Response from GHL with encrypted user data
              if (data.message === 'REQUEST_USER_DATA_RESPONSE' && !resolvedRef.current) {
                console.log('✅ Got REQUEST_USER_DATA_RESPONSE');
                console.log('Encrypted payload received, sending to backend...');
                
                // Clear timeout immediately!
                if (localTimeoutId) {
                  clearTimeout(localTimeoutId);
                  console.log('⏰ Timeout cleared - data received successfully');
                }
                resolvedRef.current = true;
                
                // Use cloudflare tunnel for backend
                const backendUrl = 'https://convo-vault.vercel.app';
                const decryptUrl = `${backendUrl}/api/auth/decrypt-user-data`;
                
                console.log('Decrypt URL:', decryptUrl);
                
                fetch(decryptUrl, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                  },
                  credentials: 'include',
                  body: JSON.stringify({ encryptedData: data.payload })
                })
                .then(res => {
                  console.log('Decrypt response status:', res.status);
                  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                  return res.json();
                })
                .then(userData => {
                  console.log('✅ User data decrypted:', userData);
                  resolve(userData);
                })
                .catch(err => {
                  console.error('❌ Decryption failed:', err.message);
                  reject(err);
                });
          }
        };

            window.addEventListener('message', messageHandler);
        
            // Request user data from parent (Official GHL method)
        if (window.parent !== window) {
              console.log('📤 Sending REQUEST_USER_DATA to parent...');
              window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
            } else {
              reject(new Error('Not in iframe'));
              return;
        }

            // Timeout after 3 seconds (only if not resolved)
            localTimeoutId = setTimeout(() => {
              if (!resolvedRef.current) {
                console.warn('⏱️ Timeout - no response from GHL');
                reject(new Error('Timeout waiting for GHL response'));
              } else {
                console.log('⏰ Timeout skipped - already resolved');
              }
            }, 3000);
          });
        };

        // Try to get user context using official GHL method
        try {
          const userData = await getUserContext();
          
          const ctx = {
            locationId: userData.activeLocation || userData.locationId,
            companyId: userData.companyId,
            userId: userData.userId,
            email: userData.email,
            userName: userData.userName,
            role: userData.role,
            type: userData.type || (userData.activeLocation ? 'Location' : 'Agency')
          };

          console.log('✅ User Context Retrieved:', ctx);
          setContext(ctx);
          setLoading(false);

        } catch (err) {
          console.warn(`⚠️ Attempt ${attemptCountRef.current} failed:`, err.message);

          // Check if max attempts reached
          if (err.message === 'MAX_ATTEMPTS_REACHED' || attemptCountRef.current >= MAX_ATTEMPTS) {
            console.error(`❌ Max attempts (${MAX_ATTEMPTS}) reached`);
            setError('INSTALL_REQUIRED');
            setLoading(false);
          return;
        }

          // Fallback: URL parameters (for development/testing)
            const params = new URLSearchParams(window.location.search);
          const urlLocationId = params.get('location_id') || params.get('locationId');
          const urlUserId = params.get('user_id') || params.get('userId');
          const urlCompanyId = params.get('company_id') || params.get('companyId');

          if (urlLocationId && urlUserId) {
            console.log('✅ Using URL parameters (development mode)');
                setContext({
              locationId: urlLocationId,
              companyId: urlCompanyId || 'unknown',
              userId: urlUserId,
                  type: 'Location'
                });
                setLoading(false);
          } else {
            // No context available - redirect to about page
            console.warn('❌ No context available - redirecting to about page');
            
            // Check if we're on localhost
            const isLocalhost = window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1';
            
            if (isLocalhost) {
              // Redirect to about page on backend
              window.location.href = 'http://localhost:3003/about.html';
            } else {
              // Redirect to about page on cloudflare backend
              window.location.href = 'https://convo-vault.vercel.app/about.html';
            }
          }
        }
      } catch (err) {
        console.error('❌ GHL Context Error:', err);
        setError(err.message || 'Context initialization failed');
        setLoading(false);
      }
    };

    initGHL();

    // Cleanup
    return () => {
      if (messageHandler) {
        window.removeEventListener('message', messageHandler);
      }
    };
  }, []);

  return { context, loading, error };
};

