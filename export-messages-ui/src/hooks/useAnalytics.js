import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../constants/api';

/**
 * Lightweight analytics hook
 * Tracks user actions without impacting performance
 */
export function useAnalytics() {
  const { location, ghlContext } = useAuth();
  const sessionIdRef = useRef(`session_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  // Track app opened (once per session)
  useEffect(() => {
    if (location?.id && ghlContext?.userId) {
      track('app_opened');
    }
  }, [location?.id, ghlContext?.userId]);

  const track = async (eventType, metadata = {}) => {
    // Skip if no context
    if (!location?.id || !ghlContext?.userId) {
      return;
    }

    try {
      // Fire and forget - don't await
      fetch(`${API_BASE_URL}/api/analytics/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: location.id,
          userId: ghlContext.userId,
          eventType,
          metadata: {
            ...metadata,
            sessionId: sessionIdRef.current
          }
        })
      }).catch(() => {}); // Silent fail - analytics is non-critical

    } catch (error) {
      // Silent fail - don't impact user experience
      console.debug('Analytics tracking failed:', error);
    }
  };

  return { track };
}

