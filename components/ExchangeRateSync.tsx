import React, { useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd, DEFAULT_SAR_PER_USD } from '../utils/currencyMath';

/**
 * Keeps `CurrencyContext.exchangeRate` aligned with `resolveSarPerUsd(data)` (wealth ultra config, plan FX, etc.).
 * Must render under both DataProvider and CurrencyProvider.
 */
const ExchangeRateSync: React.FC = () => {
  const { data, dataResetKey } = useContext(DataContext)!;
  const { setExchangeRate } = useCurrency();

  useEffect(() => {
    const r = resolveSarPerUsd(data ?? null, DEFAULT_SAR_PER_USD);
    setExchangeRate(r);
  }, [data, dataResetKey, setExchangeRate]);

  return null;
};

export default ExchangeRateSync;
