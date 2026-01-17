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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const authAttemptCount = useRef(0); // Track number of attempts
  const maxAttempts = 3; // Maximum 3 attempts

  console.log('[AuthProvider] Component state:', {
    hasGhlContext: !!ghlContext,
    ghlLoading,
    ghlError,
    hasSession: !!session,
    hasLocation: !!location,
    loading,
    error,
    attemptCount: authAttemptCount.current
  });

  // Authenticate with backend when user context is available (MAX 3 ATTEMPTS)
  useEffect(() => {
    console.log('[AuthProvider useEffect] Triggered with:', {
      hasGhlContext: !!ghlContext,
      hasSession: !!session,
      attemptCount: authAttemptCount.current,
      maxAttempts
    });

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
      console.log('[AuthProvider useEffect] No action taken - conditions not met');
    }
  }, [ghlContext]);

  const authenticateUser = async (ghlContext) => {
    // Increment attempt counter
    authAttemptCount.current += 1;
    const attemptNum = authAttemptCount.current;

    console.log(`[authenticateUser] Attempt ${attemptNum}/${maxAttempts} started`);

    // Check if we've exceeded max attempts
    if (attemptNum > maxAttempts) {
      console.error('[authenticateUser] Max attempts exceeded');
      setError('Maximum authentication attempts reached. Please refresh the page.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('[authenticateUser] Calling authAPI.verify');
      
      const response = await authAPI.verify({
        locationId: ghlContext.locationId,
        companyId: ghlContext.companyId,
        userId: ghlContext.userId
      });

      console.log('[authenticateUser] Authentication successful');

      // Success! Store session token
      localStorage.setItem('sessionToken', response.sessionToken);
      
      setSession({
        token: response.sessionToken,
        user: response.user,
        locationId: response.location.id
      });
      
      setLocation(response.location);
      setError(null);
      setLoading(false);
      
      console.log('[authenticateUser] Session and location state updated successfully');
      
    } catch (err) {
      const errorMessage = err.message || 'Authentication failed';
      console.error('[authenticateUser] Authentication failed:', errorMessage);
      
      setError(errorMessage);
      setLoading(false);
      
      // Stop all future attempts
      authAttemptCount.current = maxAttempts;
      console.log('[authenticateUser] Setting attempt count to max to prevent retries');
    }
  };

  const refreshSession = async () => {
    console.log('[refreshSession] Attempting to refresh session');
    try {
      const response = await authAPI.refresh();
      console.log('[refreshSession] Session refresh successful');
      
      localStorage.setItem('sessionToken', response.sessionToken);
      setSession(prev => ({ ...prev, token: response.sessionToken }));
      
      console.log('[refreshSession] Session updated with new token');
    } catch (err) {
      console.error('[refreshSession] Session refresh failed:', err.message);
      console.log('[refreshSession] Logging out due to refresh failure');
      logout();
    }
  };

  const logout = () => {
    console.log('[logout] Logging out user');
    localStorage.removeItem('sessionToken');
    setSession(null);
    setLocation(null);
    console.log('[logout] Session and location cleared');
  };

  const value = {
    ghlContext,
    session,
    location,
    loading: ghlLoading || loading,
    error: ghlError || error,
    isAuthenticated: !!session,
    refreshSession,
    logout
  };

  console.log('[AuthProvider] Context value:', {
    hasGhlContext: !!value.ghlContext,
    hasSession: !!value.session,
    hasLocation: !!value.location,
    loading: value.loading,
    error: value.error,
    isAuthenticated: value.isAuthenticated
  });

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

