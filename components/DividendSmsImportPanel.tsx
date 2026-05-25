import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DataContext } from '../context/DataContext';
import InfoHint from './InfoHint';
import { useToast } from '../context/ToastContext';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import {
  parseDividendSmsText,
  resolveDividendSmsRows,
  importResolvedDividendSmsRows,
  isImportableDividendSmsRow,
  countWillImportDividendSmsRows,
  selectableDividendSmsIndices,
  dividendSmsRowNeedsHoldingPick,
  type ParsedDividendSmsRow,
  type ResolvedDividendSmsRow,
} from '../services/dividendSmsParser';
import { buildHoldingSymbolOptions } from '../services/holdingSymbolOptions';
import { ResolvedSymbolLabel } from './SymbolWithCompanyName';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useConfirmAction } from '../hooks/useConfirmAction';

export const DIVIDEND_SMS_IMPORT_SECTION_ID = 'dividend-sms-import';

const DividendSmsImportPanel: React.FC = () => {
  const { data, recordTrade } = useContext(DataContext)!;
  const { sarPerUsd } = useCanonicalFinancialMetrics();
  const { showToast } = useToast();
  const confirmAction = useConfirmAction();
  const { formatCurrencyString } = useFormatCurrency();
  const importLockRef = useRef(false);

  const personalAccounts = useMemo(() => getPersonalAccounts(data), [data]);
  const personalInvestments = useMemo(() => getPersonalInvestments(data), [data]);
  const investmentAccounts = useMemo(
    () => personalAccounts.filter((a) => a.type === 'Investment'),
    [personalAccounts],
  );

  const holdingSymbols = useMemo(
    () =>
      personalInvestments.flatMap((p) =>
        (p.holdings ?? []).map((h) => String(h.symbol ?? '').trim().toUpperCase()).filter(Boolean),
      ),
    [personalInvestments],
  );

  const [smsText, setSmsText] = useState('');
  const [preferredAccountId, setPreferredAccountId] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedDividendSmsRow[]>([]);
  const [resolvedRows, setResolvedRows] = useState<ResolvedDividendSmsRow[]>([]);
  const [portfolioOverrideByIndex, setPortfolioOverrideByIndex] = useState<Map<number, string>>(new Map());
  const [holdingOverrideByIndex, setHoldingOverrideByIndex] = useState<Map<number, string>>(new Map());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const defaultAccountId = preferredAccountId || investmentAccounts[0]?.id || '';

  const holdingOptions = useMemo(
    () => buildHoldingSymbolOptions(personalInvestments),
    [personalInvestments],
  );

  const reresolve = useCallback(
    (
      rows: ParsedDividendSmsRow[],
      portfolioOverrides: Map<number, string>,
      holdingOverrides: Map<number, string>,
    ) => {
      const resolved = resolveDividendSmsRows({
        rows,
        portfolios: personalInvestments,
        accounts: data?.accounts ?? [],
        investmentTransactions: data?.investmentTransactions ?? [],
        preferredAccountId: defaultAccountId,
        sarPerUsd,
        portfolioOverrideByIndex: portfolioOverrides,
        holdingOverrideByIndex: holdingOverrides,
        holdingOptions,
      });
      setResolvedRows(resolved);
      setSelected(selectableDividendSmsIndices(resolved));
    },
    [personalInvestments, data, defaultAccountId, sarPerUsd, holdingOptions],
  );

  useEffect(() => {
    if (parsedRows.length > 0) {
      reresolve(parsedRows, portfolioOverrideByIndex, holdingOverrideByIndex);
    }
  }, [parsedRows, portfolioOverrideByIndex, holdingOverrideByIndex, reresolve]);

  const symbolBatch = useMemo(
    () => Array.from(new Set(resolvedRows.map((r) => r.symbol).filter(Boolean))),
    [resolvedRows],
  );
  const { names: companyNames } = useCompanyNames(symbolBatch);

  const readyCount = useMemo(
    () =>
      countWillImportDividendSmsRows({
        rows: resolvedRows,
        selectedIndices: selected,
        investmentTransactions: data?.investmentTransactions ?? [],
        accounts: data?.accounts ?? [],
      }),
    [resolvedRows, selected, data?.investmentTransactions, data?.accounts],
  );

  const handleParse = useCallback(() => {
    if (!smsText.trim()) {
      showToast('Paste at least one dividend SMS.', 'warning');
      return;
    }
    setParsing(true);
    try {
      const parsed = parseDividendSmsText(smsText, holdingSymbols);
      setWarnings(parsed.warnings);
      setErrors(parsed.errors);
      setParsedRows(parsed.rows);
      setPortfolioOverrideByIndex(new Map());
      setHoldingOverrideByIndex(new Map());
      if (parsed.rows.length === 0) {
        setResolvedRows([]);
        setSelected(new Set());
        showToast(parsed.errors[0] ?? 'No dividends parsed.', 'warning');
      } else {
        reresolve(parsed.rows, new Map(), new Map());
        showToast(`Parsed ${parsed.rows.length} dividend(s). Review and import.`, 'success');
      }
    } finally {
      setParsing(false);
    }
  }, [smsText, holdingSymbols, reresolve, showToast]);

  const handleImport = useCallback(async () => {
    if (importLockRef.current) return;
    if (readyCount <= 0) {
      showToast('Nothing selected to import.', 'warning');
      return;
    }
    const ok = await confirmAction({
      title: 'Import dividends?',
      message: `Book ${readyCount} dividend row(s) to your investment ledger? Duplicates will be skipped.`,
      confirmLabel: `Import ${readyCount}`,
      details: resolvedRows
        .filter((r, i) => selected.has(i) && isImportableDividendSmsRow(r))
        .slice(0, 5)
        .map((r) => `${r.symbol} · ${r.date} · ${formatCurrencyString(r.total, { inCurrency: r.currency })}`),
    });
    if (!ok) return;
    importLockRef.current = true;
    setImporting(true);
    try {
      const result = await importResolvedDividendSmsRows({
        rows: resolvedRows,
        selectedIndices: selected,
        investmentTransactions: data?.investmentTransactions ?? [],
        accounts: data?.accounts ?? [],
        recordTrade,
        recordTradeOpts: { confirmed: true },
      });
      if (result.imported > 0) {
        showToast(`Imported ${result.imported} dividend(s) into your investment ledger.`, 'success');
        setSmsText('');
        setParsedRows([]);
        setResolvedRows([]);
        setSelected(new Set());
        setWarnings([]);
        setErrors([]);
        setPortfolioOverrideByIndex(new Map());
        setHoldingOverrideByIndex(new Map());
      }
      if (result.failed.length) {
        showToast(result.failed.slice(0, 2).join(' · '), 'error');
        reresolve(parsedRows, portfolioOverrideByIndex, holdingOverrideByIndex);
      }
      if ((result.skippedDuplicates ?? 0) > 0) {
        showToast(`Skipped ${result.skippedDuplicates} duplicate(s) already in your ledger.`, 'info');
      }
      if (result.imported === 0 && result.failed.length === 0) {
        showToast('Nothing to import — check selection and row status.', 'warning');
      }
    } finally {
      setImporting(false);
      importLockRef.current = false;
    }
  }, [resolvedRows, selected, recordTrade, data, showToast, parsedRows, portfolioOverrideByIndex, holdingOverrideByIndex, reresolve, readyCount, confirmAction, formatCurrencyString]);

  const toggleRow = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAllReady = () => setSelected(selectableDividendSmsIndices(resolvedRows));

  const setPortfolioForRow = (idx: number, portfolioId: string) => {
    setPortfolioOverrideByIndex((prev) => {
      const next = new Map(prev);
      next.set(idx, portfolioId);
      return next;
    });
  };

  const setHoldingForRow = (idx: number, optionKey: string) => {
    setHoldingOverrideByIndex((prev) => {
      const next = new Map(prev);
      if (optionKey) next.set(idx, optionKey);
      else next.delete(idx);
      return next;
    });
    if (optionKey) {
      setPortfolioOverrideByIndex((prev) => {
        const next = new Map(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  if (investmentAccounts.length === 0) {
    return (
      <div
        id={DIVIDEND_SMS_IMPORT_SECTION_ID}
        className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950"
      >
        Add an <strong>Investment</strong> platform in Accounts before importing dividend SMS.
      </div>
    );
  }

  return (
    <div
      id={DIVIDEND_SMS_IMPORT_SECTION_ID}
      className="section-card border-indigo-100 bg-gradient-to-br from-white via-indigo-50/20 to-white scroll-mt-24"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="section-title text-lg">Import dividends from SMS</h3>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Paste broker dividend notifications (Derayah, SNB Capital, Al Rajhi, US brokers, etc.). We extract amount
            and date when possible; if the SMS has no ticker, pick the holding from the list. Amounts convert to your
            portfolio currency, then book <strong>dividend</strong> rows — same ledger as Finnhub sync.
            <InfoHint text="Bank expense SMS belongs on Statement Upload → SMS Transactions. Use this panel only for dividend / توزيع credits." />
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div>
            <label htmlFor="dividend-sms-account" className="block text-sm font-medium text-slate-700 mb-1">
              Default investment platform
            </label>
            <select
              id="dividend-sms-account"
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultAccountId}
              onChange={(e) => setPreferredAccountId(e.target.value)}
            >
              {investmentAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Used when the same symbol exists on multiple platforms. Changing this re-maps parsed rows.
            </p>
          </div>
          <div>
            <label htmlFor="dividend-sms-paste" className="block text-sm font-medium text-slate-700 mb-1">
              Paste dividend SMS
            </label>
            <textarea
              id="dividend-sms-paste"
              rows={7}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder={`Example:\nSNBC: Cash dividend SAR 1,250.00 credited for 2222 on 15/03/2026\n\nتم إيداع توزيع نقدي بمبلغ 500.00 ريال للسهم 1120 بتاريخ 18/04/26`}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!smsText.trim() || parsing}
              onClick={handleParse}
            >
              {parsing ? 'Parsing…' : 'Parse SMS'}
            </button>
            {resolvedRows.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={importing || readyCount === 0}
                  onClick={() => void handleImport()}
                >
                  {importing ? 'Importing…' : `Import selected (${readyCount})`}
                </button>
                <button type="button" className="btn-outline text-sm" onClick={selectAllReady}>
                  Select all ready
                </button>
              </>
            )}
          </div>
          {errors.length > 0 && (
            <ul className="text-xs text-rose-800 list-disc pl-4 space-y-0.5">
              {errors.map((e, i) => (
                <li key={`err-${i}`}>{e}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="text-xs text-amber-900 list-disc pl-4 space-y-0.5">
              {warnings.slice(0, 8).map((w, i) => (
                <li key={`warn-${i}`}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 text-xs text-slate-600 space-y-2">
          <p className="font-semibold text-slate-800">Tips</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>One message per block (blank line between messages).</li>
            <li>Include stock code (e.g. 2222) or US ticker (AAPL).</li>
            <li>Arabic توزيع / إيداع توزيع messages are supported.</li>
            <li>USD SMS amounts convert to SAR (or vice versa) per portfolio book.</li>
            <li>Duplicates matching existing ledger rows are flagged.</li>
          </ul>
        </div>
      </div>

      {resolvedRows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 w-10" />
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Holding / symbol</th>
                <th className="px-3 py-2">Portfolio</th>
                <th className="px-3 py-2 text-right">Amount (ledger)</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resolvedRows.map((row, idx) => {
                const needsHoldingPick = dividendSmsRowNeedsHoldingPick(row);
                const disabled = !!row.resolveError || !!row.duplicate || !row.portfolioId;
                const holdingValue = holdingOverrideByIndex.get(idx) ?? '';
                return (
                  <tr key={`${row.symbol}-${row.date}-${idx}`} className={disabled ? 'bg-slate-50/80' : ''}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(idx)}
                        disabled={disabled}
                        onChange={() => toggleRow(idx)}
                        aria-label={`Import ${row.symbol}`}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.date}</td>
                    <td className="px-3 py-2">
                      {needsHoldingPick && holdingOptions.length > 0 ? (
                        <select
                          className="w-full min-w-[12rem] max-w-xs rounded border border-indigo-300 bg-white px-2 py-1.5 text-xs"
                          value={holdingValue}
                          onChange={(e) => setHoldingForRow(idx, e.target.value)}
                          aria-label="Select holding for dividend"
                        >
                          <option value="">Select holding…</option>
                          {holdingOptions.map((o) => (
                            <option key={o.optionKey} value={o.optionKey}>
                              {o.symbol}
                              {o.name && o.name !== o.symbol ? ` — ${o.name}` : ''} · {o.portfolioName}
                            </option>
                          ))}
                        </select>
                      ) : row.symbol ? (
                        <ResolvedSymbolLabel symbol={row.symbol} names={companyNames} layout="inline" />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                      {needsHoldingPick && holdingOptions.length === 0 && (
                        <p className="text-[10px] text-rose-800 mt-1">Add holdings on Investments first.</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {row.portfolioOptions && row.portfolioOptions.length > 1 && !holdingValue ? (
                        <select
                          className="w-full max-w-[200px] rounded border border-slate-300 px-2 py-1 text-xs"
                          value={row.portfolioId ?? ''}
                          disabled={disabled}
                          onChange={(e) => setPortfolioForRow(idx, e.target.value)}
                        >
                          {row.portfolioOptions.map((o) => (
                            <option key={o.portfolioId} value={o.portfolioId}>
                              {o.portfolioName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.portfolioName ?? '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-semibold">
                        {formatCurrencyString(row.total, { digits: 2 })} {row.currency}
                      </span>
                      {row.parsedTotal != null &&
                        row.parsedCurrency &&
                        (row.parsedTotal !== row.total || row.parsedCurrency !== row.currency) && (
                          <p className="text-[10px] text-slate-500 font-normal">
                            SMS: {row.parsedTotal.toFixed(2)} {row.parsedCurrency}
                          </p>
                        )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.resolveError ? (
                        <span className="text-rose-800">{row.resolveError}</span>
                      ) : row.duplicate ? (
                        <span className="text-amber-800">
                          {row.batchDuplicate ? 'Duplicate in paste' : 'Already in ledger'}
                        </span>
                      ) : (
                        <span className="text-emerald-800">Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DividendSmsImportPanel;
