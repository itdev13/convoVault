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
    } 
  }, [ghlContext]);

  const authenticateUser = async (ghlContext) => {
    // Increment attempt counter
    authAttemptCount.current += 1;
    const attemptNum = authAttemptCount.current;


    // Check if we've exceeded max attempts
    if (attemptNum > maxAttempts) {
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
      
      // PROACTIVE TOKEN VALIDATION: Verify token health immediately
      try {
        await authAPI.getSession();
      } catch (validationError) {
        // Check if it's a token expiration error
        const errorMsg = validationError.message || '';
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
      console.log('[authenticateUser] Session and location state updated successfully');
      
    } catch (err) {
      // Extract error message from various possible locations
      const errorMessage = err.details || err.message || 'Authentication failed';
      console.error('[authenticateUser] Authentication failed:', errorMessage);
      
      setError(errorMessage);
      setLoading(false);
      
      // Stop all future attempts
      authAttemptCount.current = maxAttempts;
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

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

