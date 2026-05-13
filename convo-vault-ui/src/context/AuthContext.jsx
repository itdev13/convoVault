import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useGHLContext } from '../hooks/useGHLContext';
import { authAPI } from '../api/auth';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const { context: ghlContext, loading: ghlLoading, error: ghlError } = useGHLContext();
  const [session, setSession] = useState(null);
  const [location, setLocation] = useState(null);
  const [features, setFeatures] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const authAttemptCount = useRef(0); // Track number of attempts
  const maxAttempts = 3; // Maximum 3 attempts

  // Authenticate with backend when user context is available (MAX 3 ATTEMPTS)
  useEffect(() => {
    if (ghlContext && !session && authAttemptCount.current < maxAttempts) {
      console.log('[AuthProvider useEffect] Conditions met - starting authentication');
      authenticateUser(ghlContext);
    } else if (authAttemptCount.current >= maxAttempts && !session) {
      // Stop trying after max attempts
      console.warn('[AuthProvider useEffect] Max authentication attempts reached');
      setLoading(false);
      if (!error) {
        setError('Maximum authentication attempts reached. Please refresh the page.');
      }
    } else {
      console.log('[AuthProvider useEffect] Skipping auth:', {
        reason: !ghlContext ? 'no ghlContext' : session ? 'already has session' : 'max attempts reached'
      });
    }
  }, [ghlContext]);

  const authenticateUser = async (ghlContext) => {
    // Increment attempt counter
    authAttemptCount.current += 1;
    const attemptNum = authAttemptCount.current;

    console.log('[authenticateUser] Starting attempt', attemptNum, 'of', maxAttempts);
    console.log('[authenticateUser] GHL Context:', {
      locationId: ghlContext.locationId,
      companyId: ghlContext.companyId,
      userId: ghlContext.userId
    });

    // Check if we've exceeded max attempts
    if (attemptNum > maxAttempts) {
      console.error('[authenticateUser] Exceeded max attempts');
      setError('Maximum authentication attempts reached. Please refresh the page.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const response = await authAPI.verify({
        locationId: ghlContext.locationId,
        companyId: ghlContext.companyId,
        userId: ghlContext.userId
      });

      // Success! Store session token
      localStorage.setItem('sessionToken', response.sessionToken);

      setSession({
        token: response.sessionToken,
        user: response.user,
        locationId: response.location.id
      });

      setLocation(response.location);

      setError(null);

      try {
        const sessionInfo = await authAPI.getSession();
        if (sessionInfo?.features) setFeatures(sessionInfo.features);
      } catch (validationError) {
        // Check if it's a token expiration error
        const errorMsg = validationError.message || '';
        console.error('[authenticateUser] Token validation FAILED:', errorMsg);

        if (errorMsg.includes('token expired') ||
            errorMsg.includes('authentication has expired') ||
            errorMsg.includes('Please reconnect') ||
            errorMsg.includes('Company token expired')) {
          console.error('[authenticateUser] Token already expired - needs reconnection');
          setError('Your authentication has expired. Please reconnect the convo-vault app to your GHL account.');
          setLoading(false);
          return;
        }
        // Non-critical validation errors - continue anyway
        console.warn('[authenticateUser] Token validation warning (non-critical):', errorMsg);
      }

      setLoading(false);
      console.log('[authenticateUser] COMPLETE - Session and location state updated successfully');

    } catch (err) {
      // Extract error message from various possible locations
      const errorMessage = err.details || err.message || 'Authentication failed';
      console.error('[authenticateUser] Authentication FAILED:', {
        message: errorMessage,
        details: err.details,
        status: err.status,
        fullError: err
      });

      setError(errorMessage);
      setLoading(false);

      // Stop all future attempts
      authAttemptCount.current = maxAttempts;
      console.log('[authenticateUser] Set authAttemptCount to maxAttempts to prevent further attempts');
    }
  };

  const refreshSession = async () => {
    console.log('[refreshSession] Attempting to refresh session');
    try {
      const response = await authAPI.refresh();
      
      localStorage.setItem('sessionToken', response.sessionToken);
      setSession(prev => ({ ...prev, token: response.sessionToken }));
      
      console.log('[refreshSession] Session updated with new token');
    } catch (err) {
      console.error('[refreshSession] Session refresh failed:', err.message);
      logout();
    }
  };

  const logout = () => {
    localStorage.removeItem('sessionToken');
    setSession(null);
    setLocation(null);
    console.log('[logout] Session and location cleared');
  };

  const combinedLoading = ghlLoading || loading;
  const combinedError = ghlError || error;
  const isAuthenticated = !!session;

  const value = {
    ghlContext,
    session,
    location,
    features,
    loading: combinedLoading,
    error: combinedError,
    isAuthenticated,
    refreshSession,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

