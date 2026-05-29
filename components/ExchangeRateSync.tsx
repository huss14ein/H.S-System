import React, { useContext, useEffect, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd, DEFAULT_SAR_PER_USD } from '../utils/currencyMath';

/**
 * Keeps `CurrencyContext.exchangeRate` aligned with `resolveSarPerUsd(data)` (wealth ultra config, plan FX, etc.).
 * Must render under both DataProvider and CurrencyProvider.
 */
const ExchangeRateSync: React.FC = () => {
  const { data, dataResetKey } = useContext(DataContext)!;
  const { exchangeRate, setExchangeRate } = useCurrency();
  const lastSyncedRef = useRef(exchangeRate);

  useEffect(() => {
    const r = resolveSarPerUsd(data ?? null, DEFAULT_SAR_PER_USD);
    if (Math.abs(lastSyncedRef.current - r) > 1e-6) {
      lastSyncedRef.current = r;
      setExchangeRate(r);
    }
  }, [data, dataResetKey, setExchangeRate]);

  return null;
};

export default ExchangeRateSync;
