import { useEffect, useState } from 'react';
import {
  quoteRefreshCooldownRemainingMs,
  subscribeQuoteRefreshCooldownEnd,
} from '../services/quoteRefreshCooldown';

/** Reactive cooldown ms — updates when rate-limit window starts/ends. */
export function useQuoteRefreshCooldownMs(): number {
  const [remainingMs, setRemainingMs] = useState(() => quoteRefreshCooldownRemainingMs());

  useEffect(() => {
    const sync = () => setRemainingMs(quoteRefreshCooldownRemainingMs());
    sync();
    const interval = setInterval(sync, 500);
    const unsub = subscribeQuoteRefreshCooldownEnd(sync);
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, []);

  return remainingMs;
}
