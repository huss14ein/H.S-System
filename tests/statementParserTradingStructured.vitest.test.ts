import { describe, it, expect } from 'vitest';
import { extractInvestmentTransactionsFromStructuredText, extractInvestmentTransactionsFromHeuristicText, extractInvestmentTransactionsFromTokenStream, extractInvestmentTransactionsFromGlobalPattern, extractInvestmentTransactionsFromAwaedTable } from '../services/statementParser';

describe('structured trading statement parser', () => {
  it('parses purchase/sale and wire-in rows from broker-style table lines', () => {
    const text = [
      '07/01/2026 23:42:26  Ordf 41458367  Purchase of Security 30.00 PTLO.US @ USD 4.48  504.00000    2.69390',
      '13/01/2026 19:21:55  J2026-42097720  Cash Deposit - Wire In    3,000.00000   3,002.69390',
      '23/01/2026 18:10:21  Ordf 43694695  Sale of Security 1.00 NVO.US @ USD 64.00    240.00000   240.76890',
    ].join('\n');

    const rows = extractInvestmentTransactionsFromStructuredText(text, 'acc-1');
    expect(rows.length).toBe(3);

    const buy = rows.find((r) => r.type === 'buy');
    expect(buy?.symbol).toBe('PTLO.US');
    expect(buy?.quantity).toBeCloseTo(30);
    expect(buy?.price).toBeCloseTo(4.48);
    expect(buy?.currency).toBe('USD');
    expect(buy?.total).toBeCloseTo(504);

    const dep = rows.find((r) => r.type === 'deposit');
    expect(dep?.symbol).toBe('CASH');
    expect(dep?.total).toBeCloseTo(3000);

    const sell = rows.find((r) => r.type === 'sell');
    expect(sell?.symbol).toBe('NVO.US');
    expect(sell?.quantity).toBeCloseTo(1);
    expect(sell?.price).toBeCloseTo(64);
    expect(sell?.currency).toBe('USD');
  });

  it('uses statement currency when header currency differs from quote currency', () => {
    const text = [
      'Transaction Statement (SAR)',
      '07/01/2026 23:42:26  Ordf 41458367  Purchase of Security 30.00 PTLO.US @ USD 4.48  504.00000    2.69390',
    ].join('\n');

    const rows = extractInvestmentTransactionsFromStructuredText(text, 'acc-1', { statementCurrency: 'SAR' });
    expect(rows.length).toBe(1);
    expect(rows[0].currency).toBe('SAR');
    expect(rows[0].total).toBeCloseTo(504, 5);
    expect(rows[0].price).toBeCloseTo(504 / 30, 5);
  });

  it('falls back to heuristic parsing for less-structured broker rows', () => {
    const text = [
      '2026-01-07 Buy 30 PTLO.US @ 4.48 USD total 134.40',
      '2026-01-13 Deposit USD 3,000.00',
      '2026-01-23 Sell 1 NVO.US @ 64.00 USD total 64.00',
    ].join('\n');

    const rows = extractInvestmentTransactionsFromHeuristicText(text, 'acc-1', { statementCurrency: 'USD' });
    expect(rows.length).toBe(3);
    expect(rows[0].type).toBe('buy');
    expect(rows[1].type).toBe('deposit');
    expect(rows[2].type).toBe('sell');
    expect(rows[0].symbol).toBe('PTLO.US');
    expect(rows[0].currency).toBe('USD');
  });

  it('parses flattened PDF token streams where row line-breaks are missing', () => {
    const flattened = [
      'Transaction Statement (SAR)',
      '07/01/2026 23:42:26 Ordf 41458367 Purchase of Security 30.00 PTLO.US @ USD 4.48 504.00000 2.69390',
      '13/01/2026 19:21:55 J2026-42097720 Cash Deposit - Wire In 3,000.00000 3,002.69390',
      '23/01/2026 18:10:21 Ordf 43694695 Sale of Security 1.00 NVO.US @ USD 64.00 240.00000 240.76890',
    ].join(' ');

    const rows = extractInvestmentTransactionsFromTokenStream(flattened, 'acc-1', { statementCurrency: 'SAR' });
    expect(rows.length).toBe(3);
    const buy = rows.find((r) => r.type === 'buy');
    const deposit = rows.find((r) => r.type === 'deposit');
    const sell = rows.find((r) => r.type === 'sell');
    expect(buy?.symbol).toBe('PTLO.US');
    expect(buy?.currency).toBe('SAR');
    expect(deposit?.total).toBeCloseTo(3000);
    expect(sell?.symbol).toBe('NVO.US');
  });

  it('recovers rows via global-pattern parser when token spacing is noisy', () => {
    const noisy = [
      '07/01/2026 xx yy zz Purchase of Security 30.00 PTLO.US @ USD 4.48 504.00000 random',
      '13/01/2026 aa bb Cash Deposit - Wire In 3,000.00000 junk',
      '23/01/2026 noise Sale of Security 1.00 NVO.US @ USD 64.00 240.00000',
    ].join(' ');
    const rows = extractInvestmentTransactionsFromGlobalPattern(noisy, 'acc-1', { statementCurrency: 'SAR' });
    expect(rows.length).toBe(3);
    expect(rows.some((r) => r.type === 'buy' && r.symbol === 'PTLO.US')).toBe(true);
    expect(rows.some((r) => r.type === 'deposit')).toBe(true);
    expect(rows.some((r) => r.type === 'sell' && r.symbol === 'NVO.US')).toBe(true);
  });

  it('parses Awaed-style table rows with debit/credit/balance columns', () => {
    const text = [
      'Transaction Statement (SAR)',
      '07/01/2026 23:42:26  Ordf 41458367  Purchase of Security 30.00 PTLO.US @ USD 4.48  504.00000    2.69390',
      '13/01/2026 19:21:55  J2026-42097720  Cash Deposit - Wire In    3,000.00000   3,002.69390',
      '23/01/2026 18:10:21  Ordf 43694695  Sale of Security 1.00 NVO.US @ USD 64.00    240.00000   240.76890',
    ].join('\n');

    const rows = extractInvestmentTransactionsFromAwaedTable(text, 'acc-1', { statementCurrency: 'SAR' });
    expect(rows.length).toBe(3);
    const buy = rows.find((r) => r.type === 'buy');
    const dep = rows.find((r) => r.type === 'deposit');
    const sell = rows.find((r) => r.type === 'sell');
    expect(buy?.total).toBeCloseTo(504);
    expect(dep?.total).toBeCloseTo(3000);
    expect(sell?.total).toBeCloseTo(240);
    expect(buy?.currency).toBe('SAR');
    expect(sell?.currency).toBe('SAR');
  });

  it('extracts symbol/date/details from full screenshot-style Awaed rows', () => {
    const text = [
      'Transaction Statement (SAR)',
      '07/01/2026 23:42:26  Ordf 41458367  Purchase of Security 30.00 PTLO.US @ USD 4.48  504.00000    2.69390',
      '13/01/2026 19:21:55  J2026-42097720  Cash Deposit - Wire In    3,000.00000   3,002.69390',
      '20/01/2026 23:05:13  Ordf 43133422  Purchase of Security 250.00 ALUR.US @ USD 1.60 1,500.00000 1,502.69390',
      '20/01/2026 23:05:13  Ordf 43133619  Purchase of Security 252.00 ALUR.US @ USD 1.59 1,502.55000 0.14390',
      '21/01/2026 18:46:12  J2026-42193033  Cash Deposit - Wire In    5,500.00000   5,500.14390',
      '22/01/2026 19:57:35  Ordf 43432159  Purchase of Security 500.00 ALUR.US @ USD 1.45 2,718.75000 2,781.39390',
      '23/01/2026 00:00:23  Ordf 43432221  Purchase of Security 196.00 ALUR.US @ USD 1.40 1,029.00000 1,752.39390',
      '23/01/2026 17:52:05  Ordf 43669547  Purchase of Security 346.00 ALUR.US @ USD 1.35 1,751.62500 0.76890',
      '23/01/2026 18:10:21  Ordf 43694695  Sale of Security 1.00 NVO.US @ USD 64.00    240.00000   240.76890',
    ].join('\n');

    const rows = extractInvestmentTransactionsFromAwaedTable(text, 'acc-1', { statementCurrency: 'SAR' });
    expect(rows.length).toBe(9);
    const symbols = Array.from(new Set(rows.filter((r) => r.symbol !== 'CASH').map((r) => r.symbol))).sort();
    expect(symbols).toEqual(['ALUR.US', 'NVO.US', 'PTLO.US']);
    const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
    expect(dates).toEqual(['2026-01-07', '2026-01-13', '2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23']);
    expect(rows.filter((r) => r.type === 'deposit').length).toBe(2);
    expect(rows.filter((r) => r.type === 'buy').length).toBe(6);
    expect(rows.filter((r) => r.type === 'sell').length).toBe(1);
  });
});
