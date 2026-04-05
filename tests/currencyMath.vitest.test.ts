import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAR_PER_USD,
  availableTradableCashInLedgerCurrency,
  convertBetweenTradeCurrencies,
  fromSAR,
  inferInstrumentCurrencyFromSymbol,
  quoteDailyPnLInBookCurrency,
  quoteNotionalInBookCurrency,
  resolveSarPerUsd,
  toSAR,
  totalLiquidCashSARFromAccounts,
  tradableCashBucketToSAR,
} from '../utils/currencyMath';

describe('currencyMath', () => {
  it('converts USD<->SAR roundtrip with the same rate', () => {
    const rate = 3.75;
    const usd = 1234.56;
    const sar = toSAR(usd, 'USD', rate);
    const usdBack = fromSAR(sar, 'USD', rate);
    expect(usdBack).toBeCloseTo(usd, 8);
  });

  it('tradableCashBucketToSAR converts only USD bucket and does not double-count SAR', () => {
    const rate = 3.75;
    const cash = { SAR: 1000, USD: 200 };
    expect(tradableCashBucketToSAR(cash, rate)).toBeCloseTo(1750, 8);
  });

  it('resolveSarPerUsd falls back safely for invalid input', () => {
    expect(resolveSarPerUsd(null, 0)).toBe(DEFAULT_SAR_PER_USD);
    expect(resolveSarPerUsd({ wealthUltraConfig: { fxRate: -1 } }, Number.NaN)).toBe(DEFAULT_SAR_PER_USD);
    expect(resolveSarPerUsd({ wealthUltraConfig: { fxRate: 3.8 } }, 3.7)).toBe(DEFAULT_SAR_PER_USD);
    expect(resolveSarPerUsd({}, 3.7)).toBe(DEFAULT_SAR_PER_USD);
  });

  it('resolveSarPerUsd inverts legacy USD-per-SAR wealthUltra fxRate', () => {
    expect(resolveSarPerUsd({ wealthUltraConfig: { fxRate: 0.2667 } }, 3.75)).toBe(DEFAULT_SAR_PER_USD);
  });

  it('totalLiquidCashSARFromAccounts converts USD cash accounts to SAR', () => {
    const rate = 3.75;
    const sum = totalLiquidCashSARFromAccounts(
      [
        { id: 'c1', type: 'Checking', balance: 1000, currency: 'USD' as const },
        { id: 'c2', type: 'Savings', balance: 5000, currency: 'SAR' as const },
      ],
      () => ({ SAR: 0, USD: 0 }),
      rate,
    );
    expect(sum).toBeCloseTo(8750, 8);
  });

  it('availableTradableCashInLedgerCurrency matches SAR+USD pool for buys and USD ledger', () => {
    const rate = 3.75;
    const buckets = { SAR: 1000, USD: 200 };
    expect(availableTradableCashInLedgerCurrency(buckets, 'SAR', rate)).toBeCloseTo(1750, 8);
    expect(availableTradableCashInLedgerCurrency(buckets, 'USD', rate)).toBeCloseTo(1000 / rate + 200, 8);
  });

  it('inferInstrumentCurrencyFromSymbol detects Tadawul-style symbols', () => {
    expect(inferInstrumentCurrencyFromSymbol('2222.SR')).toBe('SAR');
    expect(inferInstrumentCurrencyFromSymbol('2222')).toBe('SAR');
    expect(inferInstrumentCurrencyFromSymbol('TADAWUL:2222')).toBe('SAR');
    expect(inferInstrumentCurrencyFromSymbol('AAPL')).toBe('USD');
  });

  it('convertBetweenTradeCurrencies matches toSAR/fromSAR for USD↔SAR', () => {
    const rate = 3.75;
    expect(convertBetweenTradeCurrencies(100, 'USD', 'SAR', rate)).toBeCloseTo(toSAR(100, 'USD', rate), 8);
    expect(convertBetweenTradeCurrencies(375, 'SAR', 'USD', rate)).toBeCloseTo(fromSAR(375, 'USD', rate), 8);
  });

  it('quoteNotionalInBookCurrency maps USD-listed price into SAR book', () => {
    const rate = 3.75;
    // 10 shares @ $110 → 1100 USD → 4125 SAR
    expect(quoteNotionalInBookCurrency(110, 10, 'AAPL', 'SAR', rate)).toBeCloseTo(4125, 8);
    expect(quoteNotionalInBookCurrency(35, 100, '2222.SR', 'SAR', rate)).toBeCloseTo(3500, 8);
  });

  it('quoteDailyPnLInBookCurrency converts instrument-currency delta into book', () => {
    const rate = 3.75;
    expect(quoteDailyPnLInBookCurrency(2, 5, 'AAPL', 'SAR', rate)).toBeCloseTo(37.5, 8);
  });
});
