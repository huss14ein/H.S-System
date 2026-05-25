import React, { useState, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { getAIDividendAnalysis, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { useCurrency } from '../context/CurrencyContext';
import { personalInvestmentTerminalValueSAR } from '../utils/currencyMath';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import type { InvestmentTransaction, Page } from '../types';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { useAI } from '../context/AiContext';
import { useToast } from '../context/ToastContext';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { DIVIDEND_SMS_IMPORT_SECTION_ID } from '../components/DividendSmsImportPanel';
import {
    syncFinnhubDividendsForHoldings,
    defaultDividendSyncWindow,
    listDividendEligibleHoldings,
} from '../services/dividendFinnhubSync';
import { buildPortfolioPerformanceSnapshot } from '../services/portfolioPerformance';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import {
    financialMonthKeysEndingAt,
    financialMonthRangeFromKey,
    resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { getSarPerUsdForCalendarDay, hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { buildDividendTrackerModel, type MarketFundDividend } from '../services/dividendTrackerModel';
import DividendTrackerWorkspace from '../components/DividendTrackerWorkspace';
import { migrateLocalDividendOverridesToHoldings } from '../services/dividendPlanMigration';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { summarizeFinnhubDividendSyncForConfirm } from '../utils/recordConfirmMessages';
import { sortByNewestFirst } from '../utils/sortRecency';

const DIVIDEND_AI_LANG_KEY = 'finova_default_ai_lang_v1';
const FINNHUB_DIV_SYNC_KEY = 'finova_dividend_finnhub_last_sync_v1';
const AUTO_DIVIDEND_SYNC_COOLDOWN_MS = 60 * 60 * 1000;

const DividendTrackerView: React.FC<{
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  pageAction?: string | null;
  clearPageAction?: () => void;
}> = ({ setActivePage, triggerPageAction, pageAction, clearPageAction }) => {
    const { data, loading, recordTrade, updateHolding, getAvailableCashForAccount } = useContext(DataContext)!;
    const confirmAction = useConfirmAction();
    const { exchangeRate } = useCurrency();
    const { sarPerUsd } = useCanonicalFinancialMetrics();
    const { formatCurrencyString } = useFormatCurrency();
    const { showToast } = useToast();
    const { isAiAvailable, aiHealthChecked, aiActionsEnabled } = useAI();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiError, setAiError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [divDisplayLang, setDivDisplayLang] = useState<'en' | 'ar'>(() => {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(DIVIDEND_AI_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const [aiAnalysisAr, setAiAnalysisAr] = useState<string | null>(null);
    const [isTranslatingDiv, setIsTranslatingDiv] = useState(false);
    const [fundMap, setFundMap] = useState<Record<string, HoldingFundamentals['dividend']>>({});
    const [syncBusy, setSyncBusy] = useState(false);
    const [planEpoch, setPlanEpoch] = useState(0);
    const [workspaceInitialTab, setWorkspaceInitialTab] = useState<'overview' | 'plan' | 'import'>('overview');
    const autoSyncStarted = useRef(false);

    const accountsFull = data?.accounts ?? [];
    const portfoliosAll = data?.investments ?? [];
    const personalAccounts = useMemo(() => getPersonalAccounts(data), [data]);
    const personalInvestments = useMemo(() => getPersonalInvestments(data), [data]);

    const personalInvestmentAccountIds = useMemo(
        () => personalAccounts.filter((a) => a.type === 'Investment').map((a) => a.id),
        [personalAccounts],
    );

    const personalPortfolioIds = useMemo(
        () => new Set(personalInvestments.map((p) => p.id)),
        [personalInvestments],
    );

    const txHitsPersonalInvestment = useCallback(
        (t: InvestmentTransaction) => {
            const ext = t as InvestmentTransaction & { portfolio_id?: string };
            const pid = (t.portfolioId ?? ext.portfolio_id ?? '').trim();
            if (pid && personalPortfolioIds.has(pid)) return true;

            const raw = (t.accountId ?? (t as { account_id?: string }).account_id ?? '').trim();
            if (!raw) return false;
            const canon = resolveCanonicalAccountId(raw, accountsFull);
            const ids = new Set(personalAccounts.map((a) => a.id));
            return ids.has(canon) || ids.has(raw);
        },
        [accountsFull, personalAccounts, personalPortfolioIds],
    );

    const invTxPersonal = useMemo(
        () => (data?.investmentTransactions ?? []).filter(txHitsPersonalInvestment),
        [data?.investmentTransactions, txHitsPersonalInvestment],
    );

    const dividendTransactions = useMemo(
        () => invTxPersonal.filter((t) => t.type === 'dividend'),
        [invTxPersonal],
    );

    const dividendLedgerTransactions = useMemo(
        () => sortByNewestFirst(dividendTransactions),
        [dividendTransactions],
    );

    const planMigrationStarted = useRef(false);
    useEffect(() => {
        if (!data || planMigrationStarted.current) return;
        planMigrationStarted.current = true;
        void migrateLocalDividendOverridesToHoldings(data, updateHolding).then((n) => {
            if (n > 0) {
                setPlanEpoch((e) => e + 1);
                showToast(`Migrated ${n} dividend plan override(s) to your holdings.`, 'info');
            }
        });
    }, [data, updateHolding, showToast]);

    const tracker = useMemo(() => {
        if (!data) return null;
        return buildDividendTrackerModel({
            data,
            personalInvestments,
            dividendTransactions,
            accounts: accountsFull,
            portfolios: portfoliosAll,
            uiExchangeRate: exchangeRate,
            sarPerUsd,
            fundMap: fundMap as Record<string, MarketFundDividend>,
            personalAccountIds: personalInvestmentAccountIds,
        });
        // planEpoch forces re-read of localStorage overrides
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        data,
        personalInvestments,
        dividendTransactions,
        accountsFull,
        portfoliosAll,
        exchangeRate,
        sarPerUsd,
        fundMap,
        personalInvestmentAccountIds,
        planEpoch,
    ]);

    const fundamentalsSymbols = useMemo(() => {
        const fromHoldings = personalInvestments.flatMap((p) =>
            (p.holdings ?? []).map((h) => String(h.symbol ?? '').trim().toUpperCase()),
        );
        return Array.from(new Set(fromHoldings.filter((s) => s.length >= 2))).slice(0, 24);
    }, [personalInvestments]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const sym of fundamentalsSymbols) {
                if (cancelled) break;
                try {
                    const f = await getHoldingFundamentals(sym);
                    if (!cancelled && f?.dividend) {
                        setFundMap((prev) => ({ ...prev, [sym]: f.dividend! }));
                    }
                } catch {
                    /* ignore */
                }
                await new Promise((r) => setTimeout(r, 1200));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [fundamentalsSymbols.join('|')]);

    const symbolBatch = useMemo(() => {
        const syms = new Set<string>();
        for (const t of dividendTransactions.slice(0, 20)) {
            const s = (t.symbol || '').trim();
            if (s.length >= 2) syms.add(s);
        }
        for (const r of tracker?.holdingRows ?? []) syms.add(r.symbol);
        return [...syms];
    }, [dividendTransactions, tracker?.holdingRows]);

    const { names: dividendCompanyNames } = useCompanyNames(symbolBatch);

    const portfolioPerf = useMemo(() => {
        if (!data) return null;
        const endVal = personalInvestmentTerminalValueSAR({
            portfolios: personalInvestments,
            investmentAccountIds: personalInvestmentAccountIds,
            exchangeRate: sarPerUsd,
            getAvailableCashForAccount,
        });
        const snaps = listNetWorthSnapshots();
        const priorVal = snaps.length >= 2 ? Math.max(0, snaps[1].netWorth * 0.35) : endVal * 0.9;
        return buildPortfolioPerformanceSnapshot(data, endVal, priorVal, 12);
    }, [data, personalInvestments, personalInvestmentAccountIds, sarPerUsd, getAvailableCashForAccount]);

    const handleGetAnalysis = useCallback(async () => {
        if (!tracker) return;
        setIsLoading(true);
        setAiError(null);
        setAiAnalysisAr(null);
        try {
            const analysis = await getAIDividendAnalysis(
                tracker.summary.receivedYtdSar,
                tracker.summary.expectedAnnualSar,
                tracker.summary.received12mSar,
                tracker.topReceived.map((p) => ({
                    name: p.name,
                    symbol: p.symbol || '',
                    receivedSar: p.receivedSar,
                    paymentCount: p.paymentCount,
                })),
            );
            setAiAnalysis(analysis);
        } catch (err) {
            setAiError(formatAiError(err));
            setAiAnalysis('');
        } finally {
            setIsLoading(false);
        }
    }, [tracker]);

    useEffect(() => {
        if (divDisplayLang !== 'ar' || !aiAnalysis.trim() || aiAnalysisAr != null || !aiActionsEnabled) return;
        let cancelled = false;
        (async () => {
            setIsTranslatingDiv(true);
            try {
                const ar = await translateFinancialInsightToArabic(aiAnalysis);
                if (!cancelled) setAiAnalysisAr(ar);
            } finally {
                if (!cancelled) setIsTranslatingDiv(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [divDisplayLang, aiAnalysis, aiAnalysisAr, aiActionsEnabled]);

    const runFinnhubSync = useCallback(
        async (isManual: boolean) => {
            if (!data || syncBusy) return;
            if (!import.meta.env.VITE_FINNHUB_API_KEY?.trim()) {
                if (isManual) {
                    showToast('Finnhub is not configured (VITE_FINNHUB_API_KEY).', 'warning');
                }
                return;
            }
            if (isManual) {
                const eligible = listDividendEligibleHoldings(personalInvestments).length;
                const ok = await confirmAction(summarizeFinnhubDividendSyncForConfirm(eligible));
                if (!ok) return;
            }
            setSyncBusy(true);
            try {
                const { fromIso, toIso } = defaultDividendSyncWindow();
                const result = await syncFinnhubDividendsForHoldings({
                    portfolios: personalInvestments,
                    investmentTransactions: data.investmentTransactions ?? [],
                    accounts: data.accounts ?? [],
                    fromIso,
                    toIso,
                    sarPerUsd,
                    sarPerUsdForDay: (dayKey: string) => {
                        try {
                            hydrateSarPerUsdDailySeries(data, exchangeRate);
                            return getSarPerUsdForCalendarDay(dayKey, data, exchangeRate);
                        } catch {
                            return sarPerUsd;
                        }
                    },
                    recordDividend: async ({ portfolioId, accountId, symbol, date, total, currency }) => {
                        await recordTrade({
                            type: 'dividend',
                            portfolioId,
                            accountId,
                            symbol,
                            date,
                            quantity: 0,
                            price: 0,
                            total,
                            currency,
                        }, undefined, { system: true });
                    },
                });
                const msg = `Finnhub sync: ${result.created} new, ${result.skipped} already had${result.errors.length ? `, ${result.errors.length} issues` : ''}.`;
                showToast(msg, result.errors.length ? 'error' : 'success');
                try {
                    localStorage.setItem(FINNHUB_DIV_SYNC_KEY, new Date().toISOString());
                } catch {
                    /* ignore */
                }
            } catch (e) {
                showToast(formatAiError(e), 'error');
            } finally {
                setSyncBusy(false);
            }
        },
        [data, personalInvestments, sarPerUsd, exchangeRate, recordTrade, showToast, syncBusy, confirmAction],
    );

    useEffect(() => {
        if (pageAction === 'focus-dividend-sms') {
            setWorkspaceInitialTab('import');
            window.setTimeout(() => {
                document.getElementById(DIVIDEND_SMS_IMPORT_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 120);
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    useEffect(() => {
        if (loading || !data || autoSyncStarted.current) return;
        autoSyncStarted.current = true;
        let cancelled = false;
        (async () => {
            try {
                if (!import.meta.env.VITE_FINNHUB_API_KEY?.trim()) return;
                const eligible = listDividendEligibleHoldings(personalInvestments).length > 0;
                if (!eligible) return;

                const now = new Date();
                const monthStartDay = resolveMonthStartDayFromData(data);
                const finKeys12 = financialMonthKeysEndingAt(now, 12, monthStartDay);
                const twelveMonthsAgo = financialMonthRangeFromKey(finKeys12[0], monthStartDay).start;
                const hasTtmDividends = dividendTransactions.some((t) => {
                    const d = new Date(t.date);
                    return !isNaN(d.getTime()) && d >= twelveMonthsAgo;
                });

                const last = localStorage.getItem(FINNHUB_DIV_SYNC_KEY);
                const lastSync = last ? Date.parse(last) : 0;
                const withinCooldown = last && Date.now() - lastSync < AUTO_DIVIDEND_SYNC_COOLDOWN_MS;
                const bypassCooldown = !hasTtmDividends && eligible;
                if (withinCooldown && !bypassCooldown) return;

                if (cancelled) return;
                await runFinnhubSync(false);
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loading, data, runFinnhubSync, personalInvestments, dividendTransactions]);

    const formatTxAmountSar = useCallback(
        (t: InvestmentTransaction) => {
            return formatCurrencyString(
                investmentTransactionCashAmountSarDated({
                    tx: t,
                    accounts: accountsFull,
                    portfolios: portfoliosAll,
                    data: data ?? null,
                    uiExchangeRate: exchangeRate,
                }),
            );
        },
        [accountsFull, portfoliosAll, data, exchangeRate, formatCurrencyString],
    );

    if (loading || !data || !tracker) {
        return (
            <div className="page-container flex items-center justify-center min-h-[24rem]" aria-busy="true">
                <div className="text-center">
                    <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading dividend tracker" />
                    <p className="text-sm text-slate-600">Loading dividend data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container space-y-6">
            {portfolioPerf && (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 flex flex-wrap gap-4">
                    <span>
                        <strong>Portfolio return (12 mo):</strong>{' '}
                        {portfolioPerf.mwrrPct != null ? `${portfolioPerf.mwrrPct.toFixed(1)}% MWRR` : '—'}
                    </span>
                    <span>
                        TWRR approx: {portfolioPerf.twrrApproxPct != null ? `${portfolioPerf.twrrApproxPct.toFixed(1)}%` : '—'}
                    </span>
                </div>
            )}

            <div className="section-card p-6 sm:p-8">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                        <TrophyIcon className="h-7 w-7 text-primary" />
                    </div>
                    <div>
                        <h2 className="page-title text-2xl sm:text-3xl">Dividend Tracker</h2>
                        <p className="text-slate-600 mt-1 max-w-2xl">
                            Two layers: <strong>received</strong> cash from your ledger, and an <strong>expected plan</strong> you control (yield %, manual annual SAR, or optional market hints). Record cash on Investments → Record Trade → Dividend.
                        </p>
                    </div>
                </div>
            </div>

            <DividendTrackerWorkspace
                initialTab={workspaceInitialTab}
                key={planEpoch}
                summary={tracker.summary}
                holdingRows={tracker.holdingRows}
                topReceived={tracker.topReceived}
                topExpected={tracker.topExpected}
                monthlyChart={tracker.monthlyChart}
                platformStackKeys={tracker.platformStackKeys}
                monthlyChartHasActivity={tracker.monthlyChartHasActivity}
                recentDividendTransactions={tracker.recentDividendTransactions}
                dividendLedgerTransactions={dividendLedgerTransactions}
                coverage={tracker.coverage}
                quarterlyTotals={tracker.quarterlyTotals}
                upcomingPayouts={tracker.upcomingPayouts}
                formatTxAmountSar={formatTxAmountSar}
                companyNames={dividendCompanyNames}
                syncBusy={syncBusy}
                onFinnhubSync={() => void runFinnhubSync(true)}
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onPlanOverridesChanged={() => setPlanEpoch((n) => n + 1)}
            />

            <div className="section-card">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                            <LightBulbIcon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="section-title mb-0">Dividend Advisor</h3>
                            <p className="text-sm text-slate-500 mt-0.5">Uses received cash and your plan — not market guesses as income</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Response language">
                            <button
                                type="button"
                                onClick={() => {
                                    try {
                                        localStorage.setItem(DIVIDEND_AI_LANG_KEY, 'en');
                                    } catch {
                                        /* ignore */
                                    }
                                    setDivDisplayLang('en');
                                }}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${divDisplayLang === 'en' ? 'bg-primary/15 text-primary' : 'text-slate-600'}`}
                            >
                                English
                            </button>
                            <button
                                type="button"
                                disabled={!isAiAvailable}
                                onClick={() => {
                                    try {
                                        localStorage.setItem(DIVIDEND_AI_LANG_KEY, 'ar');
                                    } catch {
                                        /* ignore */
                                    }
                                    setDivDisplayLang('ar');
                                    setAiAnalysisAr(null);
                                }}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${divDisplayLang === 'ar' ? 'bg-primary/15 text-primary' : 'text-slate-600'} disabled:opacity-40`}
                            >
                                العربية
                            </button>
                        </div>
                        <button onClick={() => void handleGetAnalysis()} disabled={isLoading || !aiActionsEnabled} className="btn-primary disabled:opacity-50">
                            <SparklesIcon className="h-5 w-5" />
                            {isLoading ? 'Analyzing...' : 'Generate Analysis'}
                        </button>
                    </div>
                </div>

                {aiError && (
                    <div className="alert-warning mb-4">
                        <SafeMarkdownRenderer content={aiError} />
                        <button type="button" onClick={() => void handleGetAnalysis()} className="btn-ghost mt-3">
                            Retry
                        </button>
                    </div>
                )}

                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                        <p className="text-sm text-slate-600">Analyzing your dividend strategy...</p>
                    </div>
                )}

                {!isLoading && aiAnalysis && (
                    <div className="rounded-xl p-6 border border-slate-200 bg-slate-50/50" dir={divDisplayLang === 'ar' ? 'rtl' : 'ltr'}>
                        {divDisplayLang === 'ar' && isTranslatingDiv && <p className="text-sm text-violet-800 mb-2">جاري الترجمة…</p>}
                        {divDisplayLang === 'ar' && aiHealthChecked && !isAiAvailable && !aiAnalysisAr && !isTranslatingDiv && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                                Arabic needs the AI service enabled.
                            </p>
                        )}
                        <SafeMarkdownRenderer content={divDisplayLang === 'ar' ? (aiAnalysisAr ?? aiAnalysis) : aiAnalysis} />
                    </div>
                )}

                {!isLoading && !aiAnalysis && !aiError && (
                    <p className="text-sm text-slate-600 text-center py-6">Generate commentary based on cash you received and your annual plan.</p>
                )}
            </div>
        </div>
    );
};

export default DividendTrackerView;
