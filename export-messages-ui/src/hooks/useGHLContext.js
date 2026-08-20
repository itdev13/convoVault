import { useEffect, useState, useRef } from 'react';
import { API_BASE_URL, FRONTEND_URL } from '../constants/api';

// GHL App ID from marketplace
const GHL_APP_ID = '694f93f8a6babf0c821b1356';

/**
 * Hook to get user context from parent application
 * Supports both Custom Pages (postMessage) and Custom JavaScript (exposeSessionDetails) methods
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
      console.log('[useGHLContext] ⏭️ Skipping - already resolved');
      return;
    }

    // Helper function to decrypt and process user data
    const decryptUserData = async (encryptedData) => {
      const decryptUrl = `${API_BASE_URL}/api/auth/decrypt-user-data`;

      const res = await fetch(decryptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // Tell the backend this is the lite app so it decrypts with the lite shared secret.
          'X-App': 'lite'
        },
        credentials: 'include',
        body: JSON.stringify({ encryptedData })
      });

      if (!res.ok) throw new Error('Authentication failed');

      const userData = await res.json();

      if (!userData.success) {
        throw new Error(userData.error || 'Decryption failed');
      }

      return userData;
    };

    const initGHL = async () => {
      try {
        // METHOD 2: Try postMessage method (Custom Pages)
        const getUserContext = async () => {
          return new Promise((resolve, reject) => {
            let localTimeoutId;

            messageHandler = ({ data, origin }) => {
              console.log('[useGHLContext] Message received:', {
                message: data.message,
                origin,
                hasPayload: !!data.payload,
                payloadLength: data.payload ? data.payload.length : 0
              });

              // Response with encrypted user data
              if (data.message === 'REQUEST_USER_DATA_RESPONSE' && !resolvedRef.current) {
                // Clear timeout immediately!
                if (localTimeoutId) {
                  clearTimeout(localTimeoutId);
                }
                resolvedRef.current = true;

                decryptUserData(data.payload)
                  .then(resolve)
                  .catch(reject);
              }
            };

            window.addEventListener('message', messageHandler);

            // Request user data from parent
            if (window.parent !== window) {
              console.log('[useGHLContext] Posting REQUEST_USER_DATA to parent...');
              window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
            } else {
              console.log('[useGHLContext] NOT in iframe - rejecting');
              reject(new Error('Not in iframe'));
              return;
            }

            // Timeout after 5 seconds (increased from 3s)
            localTimeoutId = setTimeout(() => {
              if (!resolvedRef.current) {
                console.log('[useGHLContext] TIMEOUT - no response from parent after 5s');
                reject(new Error('Authentication timeout'));
              }
            }, 5000);
          });
        };

        // Try to get user context
        try {
          const userData = await getUserContext();
          console.log('[useGHLContext] getUserContext SUCCESS');

          const ctx = {
            locationId: userData.activeLocation || userData.locationId,
            companyId: userData.companyId,
            userId: userData.userId,
            email: userData.email,
            userName: userData.userName,
            role: userData.role,
            type: userData.type || (userData.activeLocation ? 'Location' : 'Agency')
          };

          setContext(ctx);
          setLoading(false);

        } catch (err) {
          console.error('[useGHLContext] getUserContext FAILED:', err.message);

          // Check if max attempts reached
          if (err.message === 'MAX_ATTEMPTS_REACHED' || attemptCountRef.current >= MAX_ATTEMPTS) {
            console.log('[useGHLContext] Max attempts reached, setting INSTALL_REQUIRED');
            setError('INSTALL_REQUIRED');
            setLoading(false);
          return;
        }
          setError('REFRESH_REQUIRED');
          setLoading(false);
        }
      } catch (err) {
        console.error('[useGHLContext] ❌ GHL Context Error:', err.message || 'Context initialization failed');
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

