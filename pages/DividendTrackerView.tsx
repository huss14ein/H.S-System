import React, { useState, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
    CHART_MARGIN,
    CHART_GRID_STROKE,
    CHART_GRID_COLOR,
    CHART_AXIS_COLOR,
    formatAxisNumber,
    CHART_COLORS,
} from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { getAIDividendAnalysis, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { useCurrency } from '../context/CurrencyContext';
import {
    toSAR,
    resolveSarPerUsd,
    personalInvestmentTerminalValueSAR,
} from '../utils/currencyMath';
import { unrealizedPnL } from '../services/portfolioMetrics';
import type { Holding, InvestmentTransaction, Page } from '../types';
import { approximatePortfolioMWRR, flowsFromInvestmentTransactionsInSARWithDatedFx } from '../services/portfolioXirr';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel } from '../components/SymbolWithCompanyName';
import { useAI } from '../context/AiContext';
import { useToast } from '../context/ToastContext';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { resolveCanonicalAccountId, inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import InfoHint from '../components/InfoHint';
import {
    syncFinnhubDividendsForHoldings,
    defaultDividendSyncWindow,
    listDividendEligibleHoldings,
} from '../services/dividendFinnhubSync';

const DIVIDEND_AI_LANG_KEY = 'finova_default_ai_lang_v1';
const FINNHUB_DIV_SYNC_KEY = 'finova_dividend_finnhub_last_sync_v1';
/** Auto background sync at most this often unless we have no TTM dividends but do have eligible holdings (fill the ledger). */
const AUTO_DIVIDEND_SYNC_COOLDOWN_MS = 60 * 60 * 1000;

const DividendTrackerView: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage: _setActivePage }) => {
    const { data, loading, recordTrade, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
    const { showToast } = useToast();
    const { isAiAvailable } = useAI();
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

    const {
        dividendIncomeYTD,
        monthlyDividendsChartData,
        platformStackKeys,
        monthlyChartHasActivity,
        trailing12mDividendActual,
        recentDividendTransactions,
        projectedAnnualIncome,
        averageYield,
        topPayers,
        mwrrPct,
        mwrrNote,
    } = useMemo(() => {
        const dividendTransactions = invTxPersonal.filter((t) => t.type === 'dividend');
        const now = new Date();

        const dividendIncomeYTD = dividendTransactions
            .filter((t) => new Date(t.date).getFullYear() === now.getFullYear())
            .reduce((sum, t) => {
                const cur = inferInvestmentTransactionCurrency(t, accountsFull, portfoliosAll);
                return sum + toSAR(t.total ?? 0, cur, sarPerUsd);
            }, 0);

        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        const monthKeys: string[] = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        const personalAccountIdSet = new Set(personalAccounts.map((a) => a.id));
        const platformKey = (accountId: string) => `pf_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}`;

        const byAccountMonth = new Map<string, Map<string, number>>();
        let trailing12mDividendActual = 0;

        for (const t of dividendTransactions) {
            const txDate = new Date(t.date);
            if (isNaN(txDate.getTime()) || txDate < twelveMonthsAgo) continue;
            const monthKey = t.date.slice(0, 7);
            const cur = inferInvestmentTransactionCurrency(t, accountsFull, portfoliosAll);
            const sar = toSAR(t.total ?? 0, cur, sarPerUsd);
            trailing12mDividendActual += sar;

            const aid = resolveCanonicalAccountId(t.accountId, accountsFull);
            if (!personalAccountIdSet.has(aid)) continue;
            if (!byAccountMonth.has(aid)) byAccountMonth.set(aid, new Map());
            const m = byAccountMonth.get(aid)!;
            m.set(monthKey, (m.get(monthKey) || 0) + sar);
        }

        const sumForAccount = (accountId: string) =>
            [...(byAccountMonth.get(accountId)?.values() ?? [])].reduce((s, v) => s + v, 0);

        const accountIdsFromTx = [...byAccountMonth.keys()].filter((id) => personalAccountIdSet.has(id));
        accountIdsFromTx.sort((a, b) => sumForAccount(b) - sumForAccount(a));

        const MAX_PLATFORMS = 8;
        const displayAccountIds = accountIdsFromTx.slice(0, MAX_PLATFORMS);
        const otherAccountIds = accountIdsFromTx.slice(MAX_PLATFORMS);

        const accountLabel = (id: string) => {
            const a = personalAccounts.find((x) => x.id === id);
            return (a?.name?.trim() || 'Investment platform').slice(0, 36);
        };

        type StackKey = { key: string; label: string };
        const platformStackKeys: StackKey[] = [
            ...displayAccountIds.map((id) => ({ key: platformKey(id), label: accountLabel(id) })),
            ...(otherAccountIds.length ? [{ key: platformKey('__other__'), label: 'Other platforms' }] : []),
        ];

        const monthlyDividendsChartData = monthKeys.map((mk) => {
            const name = new Date(mk + '-02').toLocaleString('default', { month: 'short', year: '2-digit' });
            const row: Record<string, string | number> = { name, monthKey: mk };
            let total = 0;
            if (platformStackKeys.length === 0) {
                row.totalBar = 0;
                return row;
            }
            for (const aid of displayAccountIds) {
                const v = byAccountMonth.get(aid)?.get(mk) ?? 0;
                row[platformKey(aid)] = v;
                total += v;
            }
            let other = 0;
            for (const aid of otherAccountIds) {
                other += byAccountMonth.get(aid)?.get(mk) ?? 0;
            }
            if (otherAccountIds.length) {
                row[platformKey('__other__')] = other;
                total += other;
            }
            row.total = total;
            return row;
        });

        const monthlyChartHasActivity = monthlyDividendsChartData.some((row) => Number(row.total ?? row.totalBar ?? 0) > 0.01);

        const recentDividendTransactions = dividendTransactions
            .filter((t) => {
                const txDate = new Date(t.date);
                return !isNaN(txDate.getTime());
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 15);

        type HoldingRow = Holding & { portfolioCurrency?: string };
        const allHoldings: HoldingRow[] = personalInvestments.flatMap((p) =>
            (p.holdings ?? []).map((h) => ({
                ...h,
                portfolioCurrency: resolveInvestmentPortfolioCurrency(p),
            })),
        );

        const totalInvestmentValue = allHoldings.reduce(
            (sum, h) => sum + toSAR(h.currentValue ?? 0, (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR', sarPerUsd),
            0,
        );

        const holdingsWithProjectedDividends = allHoldings
            .map((h) => {
                const sym = (h.symbol || '').trim().toUpperCase();
                const live = sym ? fundMap[sym] : undefined;
                const yieldVal = Number(h.dividendYield ?? live?.dividendYieldPct ?? 0) || 0;
                const perShareAnnual = live?.dividendPerShareAnnual;
                const holding = h as unknown as Holding;
                const uPnL = unrealizedPnL(holding);
                const costBasis = Math.max(0, Number(holding.avgCost) || 0) * Math.max(0, Number(holding.quantity) || 0);
                const cv = Number(h.currentValue) || 0;
                const book = (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR';
                const qty = Math.max(0, Number(h.quantity) || 0);

                let annualCashBook = 0;
                if (perShareAnnual && perShareAnnual > 0 && qty > 0) {
                    annualCashBook = perShareAnnual * qty;
                } else if (yieldVal > 0 && yieldVal <= 100 && cv > 0) {
                    annualCashBook = cv * (yieldVal / 100);
                }

                const projected = toSAR(annualCashBook, book, sarPerUsd);
                const unrealizedSAR = toSAR(uPnL, book, sarPerUsd);
                const dy = yieldVal;
                const yieldOnCostPct =
                    costBasis > 0.01 && annualCashBook > 0 ? (annualCashBook / costBasis) * 100 : null;

                return {
                    symbol: sym,
                    name: h.name ?? h.symbol ?? '—',
                    projected,
                    unrealizedSAR,
                    forwardYieldPct: dy,
                    yieldOnCostPct,
                    include: annualCashBook > 0 && (dy > 0 || (perShareAnnual ?? 0) > 0),
                };
            })
            .filter((x) => x.include);

        const projectedAnnualIncome = holdingsWithProjectedDividends.reduce((sum, h) => sum + h.projected, 0);
        const averageYield = totalInvestmentValue > 0 ? (projectedAnnualIncome / totalInvestmentValue) * 100 : 0;
        const topPayers = holdingsWithProjectedDividends
            .sort((a, b) => b.projected - a.projected)
            .slice(0, 5);

        if (data) hydrateSarPerUsdDailySeries(data, exchangeRate);
        const flows = flowsFromInvestmentTransactionsInSARWithDatedFx(
            invTxPersonal.map((t) => ({
                date: t.date,
                type: t.type,
                total: t.total,
                currency: inferInvestmentTransactionCurrency(t, accountsFull, portfoliosAll),
            })),
            data ?? null,
            exchangeRate,
        );
        const termVal = personalInvestmentTerminalValueSAR({
            portfolios: personalInvestments,
            investmentAccountIds: personalInvestmentAccountIds,
            exchangeRate: sarPerUsd,
            getAvailableCashForAccount,
        });
        const rawMwrr = approximatePortfolioMWRR(flows, termVal, new Date().toISOString().slice(0, 10));
        let mwrrNote = '';
        let mwrrPct: number | null = rawMwrr;
        if (flows.length === 0 && termVal <= 0) {
            mwrrPct = null;
            mwrrNote = 'Add investment activity and holdings to estimate money-weighted return.';
        } else if (rawMwrr != null && (!Number.isFinite(rawMwrr) || rawMwrr <= -90 || rawMwrr > 400)) {
            mwrrPct = null;
            mwrrNote =
                'This estimate is outside a believable range—usually missing transfers, mixed currencies, or incomplete history. Keep recording deposits, buys, sells, and dividends.';
        }

        return {
            dividendIncomeYTD,
            monthlyDividendsChartData,
            platformStackKeys,
            monthlyChartHasActivity,
            trailing12mDividendActual,
            recentDividendTransactions,
            projectedAnnualIncome,
            averageYield,
            topPayers,
            mwrrPct,
            mwrrNote,
        };
    }, [
        data,
        exchangeRate,
        invTxPersonal,
        accountsFull,
        portfoliosAll,
        sarPerUsd,
        personalAccounts,
        personalInvestments,
        personalInvestmentAccountIds,
        getAvailableCashForAccount,
        fundMap,
    ]);

    const dividendTxSymbols = useMemo(() => {
        if (!data) return [] as string[];
        const dividendTransactions = invTxPersonal.filter((t) => t.type === 'dividend');
        return Array.from(
            new Set(
                dividendTransactions
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .slice(0, 15)
                    .map((t) => (t.symbol || '').trim())
                    .filter((s) => s.length >= 2),
            ),
        );
    }, [data, invTxPersonal]);

    const topPayerSymbols = useMemo(
        () => Array.from(new Set(topPayers.map((p) => (p.symbol || '').trim()).filter((s) => s.length >= 2))),
        [topPayers],
    );

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

    const dividendSymbolBatch = useMemo(
        () => Array.from(new Set([...dividendTxSymbols, ...topPayerSymbols])),
        [dividendTxSymbols, topPayerSymbols],
    );
    const { names: dividendCompanyNames } = useCompanyNames(dividendSymbolBatch);

    const handleGetAnalysis = useCallback(async () => {
        setIsLoading(true);
        setAiError(null);
        setAiAnalysisAr(null);
        try {
            const analysis = await getAIDividendAnalysis(
                dividendIncomeYTD,
                projectedAnnualIncome,
                trailing12mDividendActual,
                topPayers.map((p) => ({ name: p.name, symbol: p.symbol || '', projected: p.projected })),
            );
            setAiAnalysis(analysis);
        } catch (err) {
            setAiError(formatAiError(err));
            setAiAnalysis('');
        } finally {
            setIsLoading(false);
        }
    }, [dividendIncomeYTD, projectedAnnualIncome, trailing12mDividendActual, topPayers]);

    useEffect(() => {
        if (divDisplayLang !== 'ar' || !aiAnalysis.trim() || aiAnalysisAr != null || !isAiAvailable) return;
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
    }, [divDisplayLang, aiAnalysis, aiAnalysisAr, isAiAvailable]);

    const runFinnhubSync = useCallback(
        async (isManual: boolean) => {
            if (!data || syncBusy) return;
            if (!import.meta.env.VITE_FINNHUB_API_KEY?.trim()) {
                if (isManual) {
                    showToast('Finnhub is not configured (VITE_FINNHUB_API_KEY). Add it to enable automatic dividend history.', 'error');
                }
                return;
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
                        });
                    },
                });
                const msg = `Finnhub sync: ${result.created} new, ${result.skipped} already had${result.errors.length ? `, ${result.errors.length} issues` : ''}.`;
                showToast(msg, result.errors.length ? 'error' : 'success');
                if (result.errors.length && isManual) {
                    console.warn('Dividend sync errors', result.errors);
                }
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
        [data, personalInvestments, sarPerUsd, recordTrade, showToast, syncBusy],
    );

    useEffect(() => {
        if (loading || !data || autoSyncStarted.current) return;
        autoSyncStarted.current = true;
        let cancelled = false;
        (async () => {
            try {
                if (!import.meta.env.VITE_FINNHUB_API_KEY?.trim()) return;
                const eligible = listDividendEligibleHoldings(personalInvestments).length > 0;
                if (!eligible) return;

                const dividendTx = invTxPersonal.filter((t) => t.type === 'dividend');
                const now = new Date();
                const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
                const hasTtmDividends = dividendTx.some((t) => {
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
                /* ignore auto failures */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loading, data, runFinnhubSync, personalInvestments, invTxPersonal]);

    const formatTxAmountSar = useCallback(
        (t: InvestmentTransaction) => {
            const cur = inferInvestmentTransactionCurrency(t, accountsFull, portfoliosAll);
            return formatCurrencyString(toSAR(t.total ?? 0, cur, sarPerUsd));
        },
        [accountsFull, portfoliosAll, sarPerUsd, formatCurrencyString],
    );

    if (loading || !data) {
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
            <div className="section-card p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                            <TrophyIcon className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <h2 className="page-title text-2xl sm:text-3xl">Dividend Tracker</h2>
                            <p className="text-slate-600 mt-1">
                                Passive income from your portfolio — amounts are normalized to your display currency (SAR) using your USD→SAR rate.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => runFinnhubSync(true)}
                            disabled={syncBusy}
                            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                        >
                            <ArrowPathIcon className={`h-4 w-4 ${syncBusy ? 'animate-spin' : ''}`} aria-hidden />
                            {syncBusy ? 'Syncing from Finnhub…' : 'Refresh from market data'}
                        </button>
                    </div>
                </div>
                <p className="mt-4 text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <strong className="text-slate-800">Automation:</strong> When Finnhub is configured, this page pulls historical dividends for your open positions and writes them to each platform’s investment ledger—no import step required for ongoing updates. Use refresh only if you want to force a sync sooner. Requires{' '}
                    <code className="text-xs bg-white px-1 rounded">VITE_FINNHUB_API_KEY</code>.
                    <InfoHint text="Finnhub reports historical per-share payments; we multiply by your recorded quantity and book in each portfolio’s currency (USD or SAR), then show SAR using your FX setting." />
                </p>
            </div>

            <div className="cards-grid grid grid-cols-1 md:grid-cols-3">
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                            Dividend Income (YTD)
                            <InfoHint text="Sum of dividend transactions this calendar year on your personal investment platforms, converted to SAR." />
                        </p>
                        <div className="w-10 h-10 bg-success/10 rounded-xl flex items-center justify-center">
                            <TrophyIcon className="h-5 w-5 text-success" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(dividendIncomeYTD)}</p>
                    <p className="text-sm text-slate-600 mt-1">Received so far this year (SAR equivalent)</p>
                </div>
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                            Projected Annual Income
                            <InfoHint text="Uses Finnhub yield or dividend-per-share when available, otherwise the yield stored on each holding. Forward-looking estimate only." />
                        </p>
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                            <BanknotesIcon className="h-5 w-5 text-primary" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(projectedAnnualIncome)}</p>
                    <p className="text-sm text-slate-600 mt-1">Estimated from live fundamentals + holdings</p>
                </div>
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                            Average Portfolio Yield
                            <InfoHint text="Projected annual dividend income divided by total holding value (SAR). Not a broker-reported figure." />
                        </p>
                        <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center">
                            <ArrowTrendingUpIcon className="h-5 w-5 text-secondary" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{averageYield.toFixed(2)}%</p>
                    <p className="text-sm text-slate-600 mt-1">Weighted by current value</p>
                </div>
            </div>

            <div className="section-card border border-violet-100 bg-violet-50/40">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    Approx. portfolio MWRR (money-weighted)
                    <InfoHint text="Uses your investment ledger (deposits, withdrawals, buys, sells, dividends) and today’s holdings plus idle cash on platforms—everything converted to SAR the same way as the Investments page." />
                </p>
                <p className="text-2xl font-bold text-violet-800 tabular-nums mt-1">
                    {mwrrPct != null && Number.isFinite(mwrrPct) ? `${mwrrPct.toFixed(2)}%` : '—'}
                </p>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    {mwrrNote ||
                        'Educational estimate only; not tax or advisor-grade performance. Dividends count as positive cash flows; terminal value includes tradable cash on your investment accounts.'}
                </p>
            </div>

            <div className="section-card">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                            <LightBulbIcon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="section-title mb-0">Dividend Advisor</h3>
                            <p className="text-sm text-slate-500 mt-0.5">Expert analysis · English or Arabic</p>
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
                                title={!isAiAvailable ? 'Configure AI for Arabic translation' : 'عرض بالعربية'}
                                onClick={() => {
                                    try {
                                        localStorage.setItem(DIVIDEND_AI_LANG_KEY, 'ar');
                                    } catch {
                                        /* ignore */
                                    }
                                    setDivDisplayLang('ar');
                                    setAiAnalysisAr(null);
                                }}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${divDisplayLang === 'ar' ? 'bg-primary/15 text-primary' : 'text-slate-600'} disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                العربية
                            </button>
                        </div>
                        <button onClick={handleGetAnalysis} disabled={isLoading || !isAiAvailable} className="btn-primary disabled:opacity-50">
                            <SparklesIcon className="h-5 w-5" />
                            {isLoading ? 'Analyzing...' : 'Generate Analysis'}
                        </button>
                    </div>
                </div>

                {aiError && (
                    <div className="alert-warning mb-4">
                        <SafeMarkdownRenderer content={aiError} />
                        <button type="button" onClick={handleGetAnalysis} className="btn-ghost mt-3">
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
                    <div className="rounded-xl p-6 border border-slate-200 bg-slate-50/50" dir={divDisplayLang === 'ar' ? 'rtl' : 'ltr'} lang={divDisplayLang === 'ar' ? 'ar' : 'en'}>
                        {divDisplayLang === 'ar' && isTranslatingDiv && (
                            <p className="text-sm text-violet-800 mb-2">جاري الترجمة…</p>
                        )}
                        {divDisplayLang === 'ar' && !isAiAvailable && !aiAnalysisAr && aiAnalysis.trim() && !isTranslatingDiv && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                                Arabic needs the AI service enabled. Switch to English or add an API key.
                            </p>
                        )}
                        <SafeMarkdownRenderer content={divDisplayLang === 'ar' ? (aiAnalysisAr ?? aiAnalysis) : aiAnalysis} />
                    </div>
                )}

                {!isLoading && !aiAnalysis && !aiError && (
                    <div className="text-center py-8">
                        <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <LightBulbIcon className="h-7 w-7 text-slate-500" />
                        </div>
                        <p className="text-sm text-slate-600">Click Generate Analysis for plain-language commentary on your dividend income.</p>
                    </div>
                )}
            </div>

            <div className="section-card">
                <h3 className="section-title flex items-center gap-2">
                    Monthly Dividend Income
                    <InfoHint text="Rolling 12 months of dividend cash logged on each investment platform, converted to SAR. Stacked bars show which platform paid each month." />
                </h3>
                <p className="text-sm text-slate-500 mb-2">
                    Actual cash dividends from your investment ledger, attributed to each platform (broker) account. Updates when new dividend rows are recorded—including automatic Finnhub sync when configured.
                </p>
                {!monthlyChartHasActivity && (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                        No dividend payments in the last 12 months yet. With Finnhub configured, opening this page syncs historical dividends into your ledgers automatically (throttled to limit API use).
                    </p>
                )}
                <div className="h-[400px]">
                    <ChartContainer height="100%" isEmpty={false} className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyDividendsChartData} margin={CHART_MARGIN}>
                                <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                                <YAxis
                                    tickFormatter={(v) => formatAxisNumber(Number(v))}
                                    stroke={CHART_AXIS_COLOR}
                                    fontSize={12}
                                    tickLine={false}
                                    width={48}
                                />
                                <Tooltip
                                    formatter={(val: number) => formatCurrencyString(val, { digits: 2 })}
                                    contentStyle={{
                                        backgroundColor: 'white',
                                        border: '2px solid #e2e8f0',
                                        borderRadius: '12px',
                                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                        padding: '12px 16px',
                                    }}
                                />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                {platformStackKeys.length > 0 ? (
                                    platformStackKeys.map((pk, i) => (
                                        <Bar
                                            key={pk.key}
                                            dataKey={pk.key}
                                            stackId="div"
                                            fill={CHART_COLORS.categorical[i % CHART_COLORS.categorical.length]}
                                            name={pk.label}
                                            radius={i === platformStackKeys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                                        />
                                    ))
                                ) : (
                                    <Bar
                                        dataKey="totalBar"
                                        fill={CHART_COLORS.secondary}
                                        name="Dividend income (SAR)"
                                        radius={[6, 6, 0, 0]}
                                    />
                                )}
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="section-card">
                    <h3 className="section-title">Recent Dividend Payments</h3>
                    <p className="text-sm text-slate-500 mb-4">Latest dividend transactions (amounts shown in SAR equivalent)</p>
                    <div className="overflow-x-auto">
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <table className="min-w-full">
                                <thead className="bg-slate-50">
                                    <tr className="text-left">
                                        <th className="px-4 py-3 font-bold text-slate-700 text-sm uppercase tracking-wider">Date</th>
                                        <th className="px-4 py-3 font-bold text-slate-700 text-sm uppercase tracking-wider">Symbol</th>
                                        <th className="px-4 py-3 text-right font-bold text-slate-700 text-sm uppercase tracking-wider">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100">
                                    {recentDividendTransactions.map((t) => (
                                        <tr key={t.id} className="hover:bg-slate-50 transition-colors duration-150">
                                            <td className="px-4 py-3 text-sm text-slate-900 font-medium">
                                                {new Date(t.date).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-800 font-bold text-sm min-w-0">
                                                    <ResolvedSymbolLabel
                                                        symbol={t.symbol || ''}
                                                        names={dividendCompanyNames}
                                                        layout="inline"
                                                        symbolClassName="font-bold text-sm"
                                                    />
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="inline-flex items-center px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-sm">
                                                    {formatTxAmountSar(t)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {recentDividendTransactions.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-slate-500 font-medium">No dividend transactions yet</p>
                            <p className="text-sm text-slate-500 mt-2">
                                With Finnhub configured, dividends sync into this ledger automatically. You can also add them via Record Trade or statement upload.
                            </p>
                        </div>
                    )}
                    {recentDividendTransactions.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <button
                                type="button"
                                onClick={() => {
                                    const csv = [
                                        ['Date', 'Symbol', 'Amount_SAR_equiv'].join(','),
                                        ...recentDividendTransactions.map((t) =>
                                            [t.date, t.symbol, toSAR(t.total ?? 0, inferInvestmentTransactionCurrency(t, accountsFull, portfoliosAll), sarPerUsd)].join(
                                                ',',
                                            ),
                                        ),
                                    ].join('\n');
                                    const blob = new Blob([csv], { type: 'text/csv' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `dividend-transactions-${new Date().toISOString().split('T')[0]}.csv`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                }}
                                className="btn-primary"
                            >
                                Export to CSV
                            </button>
                        </div>
                    )}
                </div>

                <div className="section-card">
                    <h3 className="section-title flex items-center gap-2">
                        Top 5 Dividend Payers
                        <InfoHint text="Ranked by projected annual income in SAR (Finnhub data when available)." />
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">Based on projected annual income</p>
                    <div className="space-y-3">
                        {topPayers.map((payer, index: number) => (
                            <div key={`${payer.symbol || payer.name}-${index}`} className="list-row flex-wrap gap-2">
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                            index === 0
                                                ? 'bg-amber-100 text-amber-800'
                                                : index === 1
                                                  ? 'bg-slate-200 text-slate-700'
                                                  : index === 2
                                                    ? 'bg-slate-100 text-slate-600'
                                                    : 'bg-slate-100 text-slate-600'
                                        }`}
                                    >
                                        {index + 1}
                                    </div>
                                    <div>
                                        {payer.symbol ? (
                                            <ResolvedSymbolLabel
                                                symbol={payer.symbol}
                                                storedName={payer.name}
                                                names={dividendCompanyNames}
                                                layout="stacked"
                                                symbolClassName="font-bold text-slate-900"
                                                companyClassName="text-xs text-slate-500"
                                            />
                                        ) : (
                                            <span className="font-bold text-slate-900 block">{payer.name}</span>
                                        )}
                                        <span className="text-xs text-slate-500">
                                            Forward yield {Number(payer.forwardYieldPct ?? 0).toFixed(2)}%
                                            {payer.yieldOnCostPct != null && Number.isFinite(payer.yieldOnCostPct) ? (
                                                <>
                                                    {' '}
                                                    · <strong className="text-violet-700">YoC {payer.yieldOnCostPct.toFixed(2)}%</strong>
                                                </>
                                            ) : null}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5 text-sm">
                                    <span className="font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg">
                                        {formatCurrencyString(payer.projected)}/yr
                                    </span>
                                    {payer.unrealizedSAR != null && Number.isFinite(payer.unrealizedSAR) && Math.abs(payer.unrealizedSAR) >= 0.01 && (
                                        <span className={`text-xs ${payer.unrealizedSAR >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            Unrealized {payer.unrealizedSAR >= 0 ? '+' : ''}
                                            {formatCurrencyString(payer.unrealizedSAR)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    {topPayers.length === 0 && (
                        <div className="empty-state">
                            <p className="font-medium">No dividend estimates yet</p>
                            <p className="text-sm text-slate-500 mt-1">Hold dividend-paying stocks with live prices, or wait for fundamentals to load.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DividendTrackerView;
