import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { AuthContext } from './AuthContext';
import {
  recordPageVisit,
  recordAction,
  recordFormDefault,
  recordHintDismissed,
  recordSuggestionFeedback,
  getLearnedDefault,
  shouldShowHint,
  getTopPages,
  getTopActions,
  getSuggestionAcceptanceRate,
  getExpertiseScore,
  type Page,
  type ActionId,
} from '../services/selfLearningEngine';

interface SelfLearningContextType {
  trackPageVisit: (page: Page, durationMs?: number) => void;
  trackAction: (actionId: ActionId, page: Page, context?: string) => void;
  trackFormDefault: (formId: string, field: string, value: unknown) => void;
  trackHintDismissed: (hintId: string, page: Page) => void;
  trackSuggestionFeedback: (suggestionId: string, page: Page, accepted: boolean) => void;
  getLearnedDefault: (formId: string, field: string, minCount?: number) => unknown;
  shouldShowHint: (hintId: string, page?: Page) => boolean;
  getTopPages: (limit?: number) => { page: Page; count: number }[];
  getTopActions: (page?: Page, limit?: number) => { actionId: ActionId; count: number }[];
  getSuggestionAcceptanceRate: (suggestionId: string, page?: Page) => number | null;
  getExpertiseScore: () => number;
}

const SelfLearningContext = createContext<SelfLearningContextType | null>(null);

export function useSelfLearning() {
  const ctx = useContext(SelfLearningContext);
  return ctx ?? createNoopContext();
}

function createNoopContext(): SelfLearningContextType {
  const noop = () => {};
  return {
    trackPageVisit: noop,
    trackAction: noop,
    trackFormDefault: noop,
    trackHintDismissed: noop,
    trackSuggestionFeedback: noop,
    getLearnedDefault: () => undefined,
    shouldShowHint: () => true,
    getTopPages: () => [],
    getTopActions: () => [],
    getSuggestionAcceptanceRate: () => null,
    getExpertiseScore: () => 0.2,
  };
}

export const SelfLearningProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id;

  const trackPageVisit = useCallback(
    (page: Page, durationMs?: number) => {
      recordPageVisit(userId, page, durationMs);
    },
    [userId]
  );

  const trackAction = useCallback(
    (actionId: ActionId, page: Page, context?: string) => {
      recordAction(userId, actionId, page, context);
    },
    [userId]
  );

  const trackFormDefault = useCallback(
    (formId: string, field: string, value: unknown) => {
      recordFormDefault(userId, formId, field, value);
    },
    [userId]
  );

  const trackHintDismissed = useCallback(
    (hintId: string, page: Page) => {
      recordHintDismissed(userId, hintId, page);
    },
    [userId]
  );

  const trackSuggestionFeedback = useCallback(
    (suggestionId: string, page: Page, accepted: boolean) => {
      recordSuggestionFeedback(userId, suggestionId, page, accepted);
    },
    [userId]
  );

  const getLearnedDefaultCb = useCallback(
    (formId: string, field: string, minCount?: number) => {
      return getLearnedDefault(userId, formId, field, minCount);
    },
    [userId]
  );

  const shouldShowHintCb = useCallback(
    (hintId: string, page?: Page) => {
      return shouldShowHint(userId, hintId, page);
    },
    [userId]
  );

  const getTopPagesCb = useCallback(
    (limit?: number) => getTopPages(userId, limit),
    [userId]
  );

  const getTopActionsCb = useCallback(
    (page?: Page, limit?: number) => getTopActions(userId, page, limit),
    [userId]
  );

  const getSuggestionAcceptanceRateCb = useCallback(
    (suggestionId: string, page?: Page) => getSuggestionAcceptanceRate(userId, suggestionId, page),
    [userId]
  );

  const getExpertiseScoreCb = useCallback(
    () => getExpertiseScore(userId),
    [userId]
  );

  const value = useMemo<SelfLearningContextType>(
    () => ({
      trackPageVisit,
      trackAction,
      trackFormDefault,
      trackHintDismissed,
      trackSuggestionFeedback,
      getLearnedDefault: getLearnedDefaultCb,
      shouldShowHint: shouldShowHintCb,
      getTopPages: getTopPagesCb,
      getTopActions: getTopActionsCb,
      getSuggestionAcceptanceRate: getSuggestionAcceptanceRateCb,
      getExpertiseScore: getExpertiseScoreCb,
    }),
    [
      trackPageVisit,
      trackAction,
      trackFormDefault,
      trackHintDismissed,
      trackSuggestionFeedback,
      getLearnedDefaultCb,
      shouldShowHintCb,
      getTopPagesCb,
      getTopActionsCb,
      getSuggestionAcceptanceRateCb,
      getExpertiseScoreCb,
    ]
  );

  return (
    <SelfLearningContext.Provider value={value}>
      {children}
    </SelfLearningContext.Provider>
  );
};

/** Hook to track page visit with duration. Records once on unmount to avoid double-counting. */
export function useTrackPageVisit(page: Page) {
  const { trackPageVisit } = useSelfLearning();
  const enterRef = useRef<number>(Date.now());

  useEffect(() => {
    enterRef.current = Date.now();
    return () => {
      const duration = Date.now() - enterRef.current;
      trackPageVisit(page, duration);
    };
  }, [page, trackPageVisit]);
}
