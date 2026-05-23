import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import {
  dividendAlreadyRecorded,
  dividendAmountInBookCurrency,
  flagBatchDuplicateDividendRows,
  buildDividendDedupeKey,
} from './dividendLedgerGuards';

export { dividendAmountInBookCurrency } from './dividendLedgerGuards';
import { findHoldingOptionByKey, type HoldingSymbolOption } from './holdingSymbolOptions';
import type { RecordWriteOptions } from './recordConfirmBridge';

/** Trade payload passed to `recordTrade` when booking SMS import rows. */
export type DividendSmsRecordTradeInput = {
  portfolioId?: string;
  accountId: string;
  date: string;
  type: 'dividend';
  symbol: string;
  quantity: number;
  price: number;
  total: number;
  currency?: 'USD' | 'SAR';
};

export type ParsedDividendSmsRow = {
  date: string;
  symbol: string;
  total: number;
  currency: 'USD' | 'SAR';
  description: string;
  confidence: 'high' | 'medium' | 'low';
  /** SMS had amount/date but no ticker — user must pick a holding. */
  symbolMissing?: boolean;
};

export type DividendSmsParseResult = {
  rows: ParsedDividendSmsRow[];
  warnings: string[];
  errors: string[];
};

export type DividendSmsPortfolioOption = {
  portfolioId: string;
  accountId: string;
  portfolioName: string;
};

export type ResolvedDividendSmsRow = ParsedDividendSmsRow & {
  portfolioId?: string;
  accountId?: string;
  portfolioName?: string;
  /** When the symbol exists on multiple portfolios. */
  portfolioOptions?: DividendSmsPortfolioOption[];
  duplicate?: boolean;
  /** Duplicate of another row in the same SMS paste (not yet in ledger). */
  batchDuplicate?: boolean;
  resolveError?: string;
  /** Parsed SMS currency (before book conversion). */
  parsedCurrency?: 'USD' | 'SAR';
  parsedTotal?: number;
};

export type DividendSmsImportResult = {
  skippedDuplicates?: number;
  imported: number;
  failed: string[];
};

const DIVIDEND_HINT =
  /(dividend|dividends|div\.?|cash\s+div|distribution|coupon\s+paid|coupon\s+payment|profit\s+share|توزيع|توزيعات|توزيعة|أرباح|ارباح|عائد|إيداع\s+توزيع|ايداع\s+توزيع|نقدي\s+توزيع|توزيع\s+نقدي)/i;

const NON_DIVIDEND_HINT =
  /\b(purchase|شراء|buy\s|sold|sell\s|withdrawn|debited|خصم|سحب|pos\b|نقاط\s+البيع)\b/i;

function normalizeDigits(input: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return String(input || '')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabicIndic.indexOf(d)));
}

function normalizeSmsPaste(text: string): string {
  return normalizeDigits(text)
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitBlocks(text: string): string[] {
  const byBlank = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: string[] = [];
  let cur: string[] = [];
  const starters =
    /^(?:dividend|cash\s+div|distribution|coupon|profit|توزيع|أرباح|ارباح|تم\s+إيداع|ايداع|snbc|derayah|rajhi|alrajhi|tadawul)/i;
  for (const line of lines) {
    if (starters.test(line) && cur.length > 0) {
      blocks.push(cur.join('\n'));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks.length ? blocks : [text];
}

function parseSmsDate(raw: string, refYear = new Date().getFullYear()): string | null {
  const t = raw.trim();
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = t.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const m = String(Number(dmy[2])).padStart(2, '0');
    const d = String(Number(dmy[1])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const mdy = t.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
  if (mdy && Number(mdy[1]) <= 12) {
    let y = Number(mdy[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const m = String(Number(mdy[1])).padStart(2, '0');
    const d = String(Number(mdy[2])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const short = t.match(/\b(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2})\b/);
  if (short) {
    const y = 2000 + Number(short[3]);
    const m = String(Number(short[2])).padStart(2, '0');
    const d = String(Number(short[1])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  void refYear;
  return null;
}

function extractDateFromBlock(block: string): string | null {
  const patterns = [
    /(?:on|date|dated|في|بتاريخ)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/i,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/,
    /(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2})\b/,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m?.[1]) {
      const parsed = parseSmsDate(m[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractAmounts(block: string): { value: number; currency: 'USD' | 'SAR'; label: string }[] {
  const out: { value: number; currency: 'USD' | 'SAR'; label: string }[] = [];
  const re =
    /(?:(SAR|SR|USD|\$|ريال)\s*)?([\d,]+(?:\.\d{1,4})?)\s*(?:SAR|SR|USD|\$|ريال)?|(?:مبلغ|amount|credit(?:ed)?|paid|إيداع)\s*[:\-]?\s*(?:SAR|SR|USD|\$|ريال)?\s*([\d,]+(?:\.\d{1,4})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const curToken = (m[1] || m[0] || '').toUpperCase();
    const numRaw = m[2] || m[3];
    if (!numRaw) continue;
    const value = Number(String(numRaw).replace(/,/g, ''));
    if (!(value > 0) || value > 50_000_000) continue;
    const currency: 'USD' | 'SAR' =
      /\bUSD|\$/.test(curToken) || /\bUSD\b/i.test(block.slice(Math.max(0, m.index - 8), m.index + 12))
        ? 'USD'
        : 'SAR';
    const window = block.slice(Math.max(0, m.index - 24), m.index + 40).toLowerCase();
    if (/balance|رصيد|bal\b/.test(window) && !/dividend|توزيع|coupon|credit|إيداع/i.test(window)) continue;
    out.push({ value, currency, label: window });
  }
  return out;
}

function isLikelyTickerAmount(value: number, block: string, holdingSymbols: string[]): boolean {
  const rounded = Math.round(value);
  const code = String(rounded);
  if (!/^\d{4}$/.test(code)) return false;
  if (holdingSymbols.includes(code)) return true;
  if (/(?:symbol|stock|سهم|للسهم|لل?sهم|for|رمز)\s*[:\-]?\s*\d{4}/i.test(block) && block.includes(code)) return true;
  if (/\bfor\s+\d{4}\b/i.test(block) && rounded === Number(block.match(/\bfor\s+(\d{4})\b/i)?.[1])) return true;
  return false;
}

function pickDividendAmount(
  block: string,
  holdingSymbols: string[],
): { total: number; currency: 'USD' | 'SAR' } | null {
  const amounts = extractAmounts(block).filter(
    (a) =>
      !isLikelyTickerAmount(a.value, block, holdingSymbols) &&
      !isLikelyDateFragment(String(Math.round(a.value)), block),
  );
  if (!amounts.length) return null;
  const scored = amounts.map((a) => {
    let score = a.value;
    if (/dividend|توزيع|coupon|credit|paid|إيداع|credited|عائد|مبلغ|ريال/i.test(a.label)) score += 1_000_000;
    if (/balance|رصيد/.test(a.label)) score -= 2_000_000;
    if (String(a.value).includes('.')) score += 50_000;
    if (a.value >= 20 && a.value < 10_000 && !Number.isInteger(a.value)) score += 10_000;
    return { ...a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { total: best.value, currency: best.currency };
}

/** Skip 4-digit tokens that are clearly part of a date (e.g. 2026 in 10/05/2026), not a Tadawul code. */
function isLikelyDateFragment(code: string, block: string): boolean {
  if (!/^\d{4}$/.test(code)) return false;
  const y = Number(code);
  if (y < 1990 || y > 2099) return false;
  if (new RegExp(`\\b${code}-\\d{2}-\\d{2}\\b`).test(block)) return true;
  if (new RegExp(`\\d{1,2}[\\/\\.-]\\d{1,2}[\\/\\.-]${code}\\b`).test(block)) return true;
  if (new RegExp(`\\bon\\s+\\d{1,2}[\\/\\.-]\\d{1,2}[\\/\\.-]${code}\\b`, 'i').test(block)) return true;
  if (new RegExp(`\\bon\\s+${code}\\b`, 'i').test(block)) return true;
  if (new RegExp(`\\b${code}\\b`).test(block) && /\bdate\b|تاريخ|credited\s+on|on\s+\d/i.test(block)) return true;
  return false;
}

function extractSymbol(block: string, holdingSymbols: string[]): string | null {
  const upperHoldings = new Set(holdingSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean));

  const explicit = [
    block.match(/\b(?:symbol|stock|سهم|رمز)\s*[:\-]?\s*([A-Z]{1,5}|\d{4})\b/i),
    block.match(/\bfor\s+([A-Z]{1,5}|\d{4})\b/i),
    block.match(/\b(?:ticker)\s*[:\-]?\s*([A-Z]{1,5}|\d{4})\b/i),
    block.match(/(?:لل)?(?:ال)?سهم\s*[:\-]?\s*(\d{4})/i),
    block.match(/\b(\d{4})\b.*(?:aramco|rajhi|stc|sabic|alinma)/i),
  ];
  for (const m of explicit) {
    if (m?.[1]) {
      const sym = m[1].trim().toUpperCase();
      if (/^\d{4}$/.test(sym) || /^[A-Z]{1,5}$/.test(sym)) return sym;
    }
  }

  const tadawul = block.match(/\b([12]\d{3})\b/g);
  if (tadawul) {
    const codes = tadawul.filter((code) => !isLikelyDateFragment(code, block));
    for (const code of codes) {
      if (upperHoldings.has(code)) return code;
    }
    if (codes.length === 1) return codes[0];
  }

  const us = block.match(/\b([A-Z]{2,5})\b/g);
  if (us) {
    const skip = new Set(['SAR', 'USD', 'SR', 'DIV', 'CASH', 'DATE', 'FOR', 'THE', 'AND', 'YOUR', 'FROM', 'SNBC', 'SMS']);
    for (const tok of us) {
      if (skip.has(tok)) continue;
      if (upperHoldings.has(tok)) return tok;
    }
  }

  const lower = block.toLowerCase();
  for (const sym of upperHoldings) {
    if (sym.length >= 3 && lower.includes(sym.toLowerCase())) return sym;
  }

  return null;
}

function parseDividendBlock(block: string, holdingSymbols: string[]): ParsedDividendSmsRow | null {
  const text = block.trim();
  if (!text) return null;
  if (!DIVIDEND_HINT.test(text)) return null;
  if (NON_DIVIDEND_HINT.test(text) && !DIVIDEND_HINT.test(text)) return null;

  const amount = pickDividendAmount(text, holdingSymbols);
  if (!amount || !(amount.total > 0)) return null;

  const symbol = extractSymbol(text, holdingSymbols);
  const date = extractDateFromBlock(text) ?? new Date().toISOString().slice(0, 10);
  const hasExplicitDate = !!extractDateFromBlock(text);

  if (!symbol) {
    return {
      date,
      symbol: '',
      total: Math.round(amount.total * 100) / 100,
      currency: amount.currency,
      description: text.slice(0, 160).replace(/\s+/g, ' ').trim(),
      confidence: 'low',
      symbolMissing: true,
    };
  }

  const hasExplicitSymbol = /^\d{4}$/.test(symbol) || /^[A-Z]{2,5}$/.test(symbol);
  const confidence: ParsedDividendSmsRow['confidence'] =
    DIVIDEND_HINT.test(text) && hasExplicitDate && hasExplicitSymbol ? 'high' : 'medium';

  return {
    date,
    symbol,
    total: Math.round(amount.total * 100) / 100,
    currency: amount.currency,
    description: text.slice(0, 160).replace(/\s+/g, ' ').trim(),
    confidence,
  };
}

function dedupeParsedRows(rows: ParsedDividendSmsRow[]): ParsedDividendSmsRow[] {
  const seen = new Map<string, ParsedDividendSmsRow>();
  for (const r of rows) {
    const symKey = r.symbol || (r.symbolMissing ? r.description.slice(0, 48) : '');
    const key = `${r.date}\0${symKey}\0${r.total.toFixed(2)}\0${r.currency}`;
    const prev = seen.get(key);
    if (!prev || (prev.confidence === 'medium' && r.confidence === 'high')) seen.set(key, r);
  }
  return [...seen.values()];
}

/**
 * Parse broker dividend SMS / notification text into investment dividend rows.
 */
export function parseDividendSmsText(
  smsText: string,
  holdingSymbols: string[] = [],
): DividendSmsParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalized = normalizeSmsPaste(smsText);
  if (!normalized) {
    return { rows: [], warnings: [], errors: ['Paste is empty.'] };
  }

  const blocks = splitBlocks(normalized);
  const rows: ParsedDividendSmsRow[] = [];
  let skipped = 0;

  for (const block of blocks) {
    const row = parseDividendBlock(block, holdingSymbols);
    if (row) rows.push(row);
    else if (DIVIDEND_HINT.test(block)) {
      skipped += 1;
      warnings.push(`Could not fully parse a dividend block: "${block.slice(0, 80)}…"`);
    }
  }

  const deduped = dedupeParsedRows(rows);
  const missingSymbolCount = deduped.filter((r) => r.symbolMissing).length;
  if (missingSymbolCount > 0) {
    warnings.push(
      `${missingSymbolCount} row(s) have no symbol in the SMS — select the holding manually before import.`,
    );
  }
  if (deduped.length === 0 && skipped === 0) {
    errors.push(
      'No dividend SMS detected. Include words like "dividend", "cash dividend", or "توزيع", plus amount and date (symbol optional — you can pick the holding manually).',
    );
  }

  return { rows: deduped, warnings, errors };
}

/** All portfolios that hold `symbol`, best match first (prefers `preferredAccountId`). */
export function listPortfoliosForDividendSymbol(
  symbol: string,
  portfolios: InvestmentPortfolio[],
  accounts: Account[],
  preferredAccountId?: string,
): DividendSmsPortfolioOption[] {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return [];
  const prefCanon = preferredAccountId
    ? resolveCanonicalAccountId(preferredAccountId, accounts)
    : '';

  const matches: (DividendSmsPortfolioOption & { score: number })[] = [];

  for (const p of portfolios) {
    const accountRaw = String(p.accountId ?? (p as { account_id?: string }).account_id ?? '').trim();
    const accountId = resolveCanonicalAccountId(accountRaw, accounts);
    const has = (p.holdings ?? []).some((h) => (h.symbol || '').trim().toUpperCase() === sym);
    if (!has) continue;
    let score = 1;
    if (prefCanon && accountId === prefCanon) score += 10;
    matches.push({ portfolioId: p.id, accountId, portfolioName: p.name ?? sym, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.map(({ score: _s, ...rest }) => rest);
}

/** Map symbol → best portfolio (prefers portfolio on `preferredAccountId`). */
export function resolvePortfolioForDividendSymbol(
  symbol: string,
  portfolios: InvestmentPortfolio[],
  accounts: Account[],
  preferredAccountId?: string,
): DividendSmsPortfolioOption | null {
  const list = listPortfoliosForDividendSymbol(symbol, portfolios, accounts, preferredAccountId);
  return list[0] ?? null;
}

export function resolveDividendSmsRows(args: {
  rows: ParsedDividendSmsRow[];
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  investmentTransactions: InvestmentTransaction[];
  preferredAccountId?: string;
  /** UI SAR/USD — converts SMS amounts into each portfolio's book currency. */
  sarPerUsd?: number;
  /** Per-row portfolio override (e.g. user picked from dropdown). */
  portfolioOverrideByIndex?: Map<number, string>;
  /** Per-row holding pick (`portfolioId:holdingId`) when SMS has no symbol or wrong symbol. */
  holdingOverrideByIndex?: Map<number, string>;
  holdingOptions?: HoldingSymbolOption[];
}): ResolvedDividendSmsRow[] {
  const sarPerUsd = Number(args.sarPerUsd);
  const fx = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;

  const mapped = args.rows.map((row, index) => {
    const holdingKey = args.holdingOverrideByIndex?.get(index);
    const holdingPick =
      holdingKey && args.holdingOptions?.length
        ? findHoldingOptionByKey(args.holdingOptions, holdingKey)
        : undefined;

    const symbol = (holdingPick?.symbol ?? row.symbol).trim().toUpperCase();
    const parsedCurrency = row.currency;
    const parsedTotal = row.total;

    if (!symbol) {
      return {
        ...row,
        symbol: '',
        symbolMissing: true,
        parsedCurrency,
        parsedTotal,
        resolveError: 'Select a holding from the dropdown.',
      };
    }

    if (holdingPick) {
      const portfolio = args.portfolios.find((p) => p.id === holdingPick.portfolioId);
      const book = portfolio ? resolveInvestmentPortfolioCurrency(portfolio) : row.currency;
      const totalBook = dividendAmountInBookCurrency(row.total, row.currency, book, fx);
      const duplicate = dividendAlreadyRecorded({
        transactions: args.investmentTransactions,
        accounts: args.accounts,
        accountId: holdingPick.accountId,
        symbol,
        payDate: row.date,
        totalBook,
        bookCurrency: book,
        portfolioId: holdingPick.portfolioId,
        portfolios: args.portfolios,
        sarPerUsd: fx,
      });

      return {
        ...row,
        symbol,
        symbolMissing: false,
        total: totalBook,
        currency: book,
        parsedCurrency,
        parsedTotal,
        portfolioId: holdingPick.portfolioId,
        accountId: holdingPick.accountId,
        portfolioName: holdingPick.portfolioName,
        duplicate,
      };
    }

    const portfolioOptions = listPortfoliosForDividendSymbol(
      symbol,
      args.portfolios,
      args.accounts,
      args.preferredAccountId,
    );
    if (!portfolioOptions.length) {
      return {
        ...row,
        symbol,
        symbolMissing: row.symbolMissing,
        parsedCurrency,
        parsedTotal,
        resolveError: row.symbolMissing
          ? 'Select a holding from the dropdown.'
          : `Symbol ${symbol} not found in any portfolio holdings — select a holding or add the position on Investments.`,
      };
    }

    const overridePid = args.portfolioOverrideByIndex?.get(index);
    const resolved =
      (overridePid ? portfolioOptions.find((o) => o.portfolioId === overridePid) : null) ??
      portfolioOptions[0];

    const portfolio = args.portfolios.find((p) => p.id === resolved.portfolioId);
    const book = portfolio ? resolveInvestmentPortfolioCurrency(portfolio) : row.currency;
    const totalBook = dividendAmountInBookCurrency(row.total, row.currency, book, fx);
    const duplicate = dividendAlreadyRecorded({
      transactions: args.investmentTransactions,
      accounts: args.accounts,
      accountId: resolved.accountId,
      symbol,
      payDate: row.date,
      totalBook,
      bookCurrency: book,
      portfolioId: resolved.portfolioId,
      portfolios: args.portfolios,
      sarPerUsd: fx,
    });

    return {
      ...row,
      symbol,
      total: totalBook,
      currency: book,
      parsedCurrency: row.currency,
      parsedTotal: row.total,
      portfolioId: resolved.portfolioId,
      accountId: resolved.accountId,
      portfolioName: resolved.portfolioName,
      portfolioOptions: portfolioOptions.length > 1 ? portfolioOptions : undefined,
      duplicate,
    };
  });

  return flagBatchDuplicateDividendRows(mapped, args.accounts);
}

/** Book selected rows via `recordTrade` (same path as Finnhub sync and statement import). */
export async function importResolvedDividendSmsRows(args: {
  rows: ResolvedDividendSmsRow[];
  selectedIndices: Iterable<number>;
  investmentTransactions: InvestmentTransaction[];
  accounts: Account[];
  recordTrade: (
    trade: DividendSmsRecordTradeInput,
    executedPlanId?: string,
    opts?: RecordWriteOptions,
  ) => Promise<unknown>;
  /** Applied to each row (e.g. `{ confirmed: true }` after batch confirm, or `{ system: true }` for automation). */
  recordTradeOpts?: RecordWriteOptions;
}): Promise<DividendSmsImportResult> {
  const selected = new Set(args.selectedIndices);
  let imported = 0;
  let skippedDuplicates = 0;
  const failed: string[] = [];
  const pendingKeys = new Set<string>();

  for (let i = 0; i < args.rows.length; i++) {
    if (!selected.has(i)) continue;
    const row = args.rows[i];
    if (!isImportableDividendSmsRow(row)) continue;

    if (
      dividendAlreadyRecorded({
        transactions: args.investmentTransactions,
        accounts: args.accounts,
        accountId: row.accountId,
        symbol: row.symbol,
        payDate: row.date,
        totalBook: row.total,
        bookCurrency: row.currency,
        portfolioId: row.portfolioId,
        pendingKeys,
      })
    ) {
      skippedDuplicates += 1;
      continue;
    }

    try {
      const trade: DividendSmsRecordTradeInput = {
        type: 'dividend',
        portfolioId: row.portfolioId,
        accountId: row.accountId,
        symbol: row.symbol,
        date: row.date,
        quantity: 0,
        price: 0,
        total: row.total,
        currency: row.currency,
      };
      await args.recordTrade(trade, undefined, args.recordTradeOpts);
      imported += 1;
      pendingKeys.add(
        buildDividendDedupeKey(
          {
            portfolioId: row.portfolioId,
            accountId: row.accountId,
            symbol: row.symbol,
            payDate: row.date,
            totalBook: row.total,
            bookCurrency: row.currency,
          },
          args.accounts,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('already recorded')) {
        skippedDuplicates += 1;
      } else {
        failed.push(`${row.symbol}: ${msg}`);
      }
    }
  }

  return { imported, failed, skippedDuplicates };
}

/** Matches `importResolvedDividendSmsRows` row eligibility (excludes batch/ledger duplicates). */
export function isImportableDividendSmsRow(
  row: ResolvedDividendSmsRow,
): row is ResolvedDividendSmsRow & { portfolioId: string; accountId: string; symbol: string } {
  return (
    !row.resolveError &&
    !row.duplicate &&
    !row.batchDuplicate &&
    !!row.portfolioId &&
    !!row.accountId &&
    !!row.symbol.trim()
  );
}

export function selectableDividendSmsIndices(rows: ResolvedDividendSmsRow[]): Set<number> {
  const out = new Set<number>();
  rows.forEach((r, i) => {
    if (isImportableDividendSmsRow(r)) out.add(i);
  });
  return out;
}

/** Count rows that `importResolvedDividendSmsRows` would book (ledger + batch dedupe). */
export function countWillImportDividendSmsRows(args: {
  rows: ResolvedDividendSmsRow[];
  selectedIndices: Iterable<number>;
  investmentTransactions: InvestmentTransaction[];
  accounts: Account[];
}): number {
  const selected = new Set(args.selectedIndices);
  const pendingKeys = new Set<string>();
  let count = 0;
  for (let i = 0; i < args.rows.length; i++) {
    if (!selected.has(i)) continue;
    const row = args.rows[i];
    if (!isImportableDividendSmsRow(row)) continue;
    if (
      dividendAlreadyRecorded({
        transactions: args.investmentTransactions,
        accounts: args.accounts,
        accountId: row.accountId,
        symbol: row.symbol,
        payDate: row.date,
        totalBook: row.total,
        bookCurrency: row.currency,
        portfolioId: row.portfolioId,
        pendingKeys,
      })
    ) {
      continue;
    }
    count += 1;
    pendingKeys.add(
      buildDividendDedupeKey(
        {
          portfolioId: row.portfolioId,
          accountId: row.accountId,
          symbol: row.symbol,
          payDate: row.date,
          totalBook: row.total,
          bookCurrency: row.currency,
        },
        args.accounts,
      ),
    );
  }
  return count;
}

/** Row needs manual holding selection in the import table. */
export function dividendSmsRowNeedsHoldingPick(row: ResolvedDividendSmsRow): boolean {
  return !!row.symbolMissing || !row.symbol.trim() || !!row.resolveError;
}
