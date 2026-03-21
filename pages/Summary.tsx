import React, { useState, useMemo, useCallback, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { getAIFinancialPersona, formatAiError } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import PageActionsDropdown from '../components/PageActionsDropdown';
import Card from '../components/Card';
import CollapsibleSection from '../components/CollapsibleSection';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import NetWorthCompositionChart from '../components/charts/NetWorthCompositionChart';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { PersonaAnalysis, ReportCardItem } from '../types';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import PageLayout from '../components/PageLayout';
import InfoHint from '../components/InfoHint';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, toSAR } from '../utils/currencyMath';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import type { Page } from '../types';
import { buildHouseholdBudgetPlan, buildHouseholdEngineInputFromData } from '../services/householdBudgetEngine';
import { deriveCashflowStressSummary } from '../services/householdBudgetStress';
import { computeRiskLaneFromData } from '../services/riskLaneEngine';
import { computeLiquidityRunwayFromData } from '../services/liquidityRunwayEngine';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';
import { computeDisciplineScore } from '../services/disciplineScoreEngine';
import { runShockDrill, SHOCK_TEMPLATES } from '../services/shockDrillEngine';
import { getPersonalWealthData } from '../utils/wealthScope';
import { computeLiquidNetWorth } from '../services/liquidNetWorth';
import { usePrivacyMask } from '../context/PrivacyContext';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { attributeNetWorthWithFlows } from '../services/portfolioAttribution';
import { personalNetCashflowBetween } from '../services/netWorthPeriodFlows';
import type { Transaction } from '../types';
import {
    generateWealthSummaryReportCsv,
    generateWealthSummaryReportHtml,
    generateWealthSummaryReportJson,
} from '../services/reportingEngine';
import { useSelfLearning } from '../context/SelfLearningContext';

const getRatingColors = (rating: ReportCardItem['rating']) => {
    switch (rating) {
        case 'Excellent': return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-500', icon: <CheckCircleIcon className="h-6 w-6 text-green-500" /> };
        case 'Good': return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-500', icon: <CheckCircleIcon className="h-6 w-6 text-blue-500" /> };
        case 'Needs Improvement': return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-500', icon: <InformationCircleIcon className="h-6 w-6 text-yellow-500" /> };
        default: return { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-500', icon: null };
    }
};

const MetricIcon: React.FC<{ metric: string }> = ({ metric }) => {
    const iconClass = "h-8 w-8 text-primary";
    switch (metric) {
        case 'Savings Rate': return <PiggyBankIcon className={iconClass} />;
        case 'Debt Management': return <ShieldCheckIcon className={iconClass} />;
        case 'Emergency Fund': return <BanknotesIcon className={iconClass} />;
        case 'Investment Strategy': return <ArrowTrendingUpIcon className={iconClass} />;
        default: return <LightBulbIcon className={iconClass} />;
    }
};

const CheckCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const InformationCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

interface SummaryProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const Summary: React.FC<SummaryProps> = ({ setActivePage, triggerPageAction }) => {
    const { data, loading } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const loadRole = async () => {
            if (!auth?.user || !supabase) {
                setIsAdmin(false);
                return;
            }
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            setIsAdmin(inferIsAdmin(auth.user, userRecord?.role ?? null));
        };
        loadRole();
    }, [auth?.user?.id]);

    const { financialMetrics, investmentTreemapData } = useMemo(() => {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const transactions = (data?.personalTransactions ?? data?.transactions ?? []);
        const recentTransactions = transactions.filter(t => new Date(t.date) >= firstDayOfMonth);

        const monthlyIncome = recentTransactions.filter(t => countsAsIncomeForCashflowKpi(t)).reduce((sum, t) => sum + (Number(t.amount) ?? 0), 0);
        const monthlyExpenses = recentTransactions.filter(t => countsAsExpenseForCashflowKpi(t)).reduce((sum, t) => sum + Math.abs(Number(t.amount) ?? 0), 0);
        const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
        const monthlyPnL = monthlyIncome - monthlyExpenses;

        const investments = data?.personalInvestments ?? data?.investments ?? [];
        const { netWorth, totalAssets, totalDebt, totalReceivable } = computePersonalNetWorthBreakdownSAR(
            data,
            exchangeRate
        );
        const grossAssets = totalAssets + totalReceivable;
        const debtToAssetRatio = grossAssets > 0 ? totalDebt / grossAssets : 0;
        
        const netWorthPrevMonth = netWorth - monthlyPnL;
        const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / Math.abs(netWorthPrevMonth)) * 100 : 0;
        
        const allHoldings = investments.flatMap(p => (p.holdings || []).map(h => ({ ...h, portfolioCurrency: p.currency })));
        const investmentTreemapData = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });

        const totalInvestments = investmentTreemapData.reduce((sum, h) => sum + toSAR(h.currentValue, h.portfolioCurrency, exchangeRate), 0);
        const individualStocksValue = investmentTreemapData
            .filter(h => !['ETF', 'Index Fund', 'Bond'].some(type => h.name?.includes(type)))
            .reduce((sum, h) => sum + toSAR(h.currentValue, h.portfolioCurrency, exchangeRate), 0);
        const investmentConcentration = totalInvestments > 0 ? individualStocksValue / totalInvestments : 0;
        let investmentStyle = 'Balanced';
        if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
        else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

        return { 
            financialMetrics: { netWorth, monthlyIncome, monthlyExpenses, savingsRate, debtToAssetRatio, investmentStyle, netWorthTrend },
            investmentTreemapData
        };
    }, [data, exchangeRate]);

    const managedWealthTotal = useMemo(() => {
        if (!data) return 0;
        const fullAccounts = data.accounts ?? [];
        const fullAssets = data.assets ?? [];
        const fullLiabilities = data.liabilities ?? [];
        const fullInvestments = data.investments ?? [];
        const fullCommodities = data.commodityHoldings ?? [];
        const {
            personalAccounts,
            personalAssets,
            personalLiabilities,
            personalInvestments,
            personalCommodityHoldings: personalCommodities,
        } = getPersonalWealthData(data);
        const cash = (acc: { type?: string; balance?: number }[]) => acc.filter(a => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
        const cashNegative = (acc: { type?: string; balance?: number }[]) => acc.filter(a => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.abs(Math.min(0, a.balance ?? 0)), 0);
        const debt = (acc: { type?: string; balance?: number }[], liab: { amount?: number }[]) => liab.filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((s: number, l: { amount?: number }) => s + Math.abs(l.amount ?? 0), 0) + acc.filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((s: number, a: { balance?: number }) => s + Math.abs(a.balance ?? 0), 0) + cashNegative(acc);
        const rec = (liab: { amount?: number }[]) => liab.filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);
        const fullCash = cash(fullAccounts), fullDebt = debt(fullAccounts, fullLiabilities), fullRec = rec(fullLiabilities);
        const fullAst = fullAssets.reduce((s: number, a: { value?: number }) => s + (a.value ?? 0), 0) + fullCash + fullCommodities.reduce((s: number, c: { currentValue?: number }) => s + (c.currentValue ?? 0), 0) + getAllInvestmentsValueInSAR(fullInvestments, exchangeRate);
        const personalCash = cash(personalAccounts), personalDebt = debt(personalAccounts, personalLiabilities), personalRec = rec(personalLiabilities);
        const personalAst = personalAssets.reduce((s: number, a: { value?: number }) => s + (a.value ?? 0), 0) + personalCash + personalCommodities.reduce((s: number, c: { currentValue?: number }) => s + (c.currentValue ?? 0), 0) + getAllInvestmentsValueInSAR(personalInvestments, exchangeRate);
        const fullNW = fullAst - fullDebt + fullRec, personalNW = personalAst - personalDebt + personalRec;
        return Math.round(fullNW - personalNW);
    }, [data, exchangeRate]);

    const emergencyFund = useEmergencyFund(data);
    const efStatus = emergencyFund.status === 'healthy' ? 'green' : emergencyFund.status === 'adequate' ? 'green' : emergencyFund.status === 'low' ? 'yellow' : 'red';
    const efTrend = emergencyFund.status === 'healthy' ? 'Healthy' : emergencyFund.status === 'adequate' ? 'Adequate' : emergencyFund.status === 'low' ? 'Low' : 'Critical';
    const financialMetricsWithEf = useMemo(() => ({
        ...financialMetrics,
        emergencyFundMonths: emergencyFund.monthsCovered,
        efStatus,
        efTrend,
        emergencyShortfall: emergencyFund.shortfall,
        emergencyTargetAmount: emergencyFund.targetAmount,
    }), [financialMetrics, emergencyFund.monthsCovered, emergencyFund.shortfall, emergencyFund.targetAmount, efStatus, efTrend]);

    const householdStress = useMemo(() => {
        if (!data) return null;
        const input = buildHouseholdEngineInputFromData(
            (data?.personalTransactions ?? data?.transactions ?? []) as Array<{ date: string; type?: string; amount?: number }>,
            (data?.personalAccounts ?? data?.accounts ?? []) as Array<{ type?: string; balance?: number }>,
            (data?.goals ?? []) as any[],
            {
                year: new Date().getFullYear(),
                expectedMonthlySalary: undefined,
                adults: 2,
                kids: 0,
                profile: (data?.settings?.riskProfile as string) || 'Moderate',
                monthlyOverrides: [],
            }
        );
        const result = buildHouseholdBudgetPlan(input);
        return deriveCashflowStressSummary(result);
    }, [data]);

    const riskLane = useMemo(
        () => computeRiskLaneFromData(data, emergencyFund.monthsCovered),
        [data, emergencyFund.monthsCovered]
    );

    const liquidityRunway = useMemo(
        () => computeLiquidityRunwayFromData(data),
        [data]
    );

    const discipline = useMemo(
        () => computeDisciplineScore(data),
        [data]
    );

    const shockDrill = useMemo(
        () => (data ? runShockDrill(data, 'job_loss') : null),
        [data]
    );

    const liquidNw = useMemo(() => computeLiquidNetWorth(data), [data]);
    const { maskBalance } = usePrivacyMask();

    const nwSnapshotInsight = useMemo(() => {
        const snaps = listNetWorthSnapshots();
        if (snaps.length < 2) return { snaps, attr: null as ReturnType<typeof attributeNetWorthWithFlows> | null };
        const a = snaps[1];
        const b = snaps[0];
        const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const flow = personalNetCashflowBetween(txs, a.at, b.at);
        return {
            snaps,
            attr: attributeNetWorthWithFlows({
                startNw: a.netWorth,
                endNw: b.netWorth,
                externalCashflow: flow,
            }),
        };
    }, [data?.transactions, data?.personalTransactions]);

    const handleGenerateAnalysis = useCallback(async () => {
        trackAction('generate-financial-persona', 'Summary');
        setIsLoading(true);
        setError(null);
        setAnalysis(null);
        try {
            const result = await getAIFinancialPersona(
                Number(financialMetricsWithEf.savingsRate) || 0,
                Number(financialMetricsWithEf.debtToAssetRatio) || 0,
                Number(financialMetricsWithEf.emergencyFundMonths) || 0,
                String(financialMetricsWithEf.investmentStyle ?? 'Balanced')
            );
            setAnalysis(result ?? null);
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [financialMetricsWithEf, trackAction]);

    const wealthSummaryReportPayload = useMemo(() => ({
        generatedAtIso: new Date().toISOString(),
        currency: 'SAR',
        netWorth: Number(financialMetricsWithEf.netWorth) || 0,
        netWorthTrendPct: Number(financialMetricsWithEf.netWorthTrend) || 0,
        monthlyIncome: Number(financialMetricsWithEf.monthlyIncome) || 0,
        monthlyExpenses: Number(financialMetricsWithEf.monthlyExpenses) || 0,
        monthlyPnL: Number(financialMetricsWithEf.monthlyIncome) - Number(financialMetricsWithEf.monthlyExpenses),
        savingsRatePct: (Number(financialMetricsWithEf.savingsRate) || 0) * 100,
        debtToAssetRatioPct: (Number(financialMetricsWithEf.debtToAssetRatio) || 0) * 100,
        emergencyFundMonths: Number(financialMetricsWithEf.emergencyFundMonths) || 0,
        emergencyFundTargetAmount: Number(financialMetricsWithEf.emergencyTargetAmount) || 0,
        emergencyFundShortfall: Number(financialMetricsWithEf.emergencyShortfall) || 0,
        liquidNetWorth: Number(liquidNw?.liquidNetWorth) || 0,
        managedWealthTotal: Number(managedWealthTotal) || 0,
        riskLane: String(riskLane?.lane ?? 'Unknown'),
        liquidityRunwayMonths: Number(liquidityRunway?.monthsOfRunway ?? 0),
        disciplineScore: Number(discipline?.score ?? 0),
        investmentStyle: String(financialMetricsWithEf.investmentStyle ?? 'Balanced'),
        householdStressLabel: String(householdStress?.level ?? 'Not available'),
        householdStressPressureMonths: Number(householdStress?.affordabilityPressureMonths ?? 0),
        shockDrillSeverity: String(shockDrill?.template?.label ?? 'Not available'),
        shockDrillEstimatedGap: Number(shockDrill?.householdProjectedYearEndDelta ?? 0),
        holdings: investmentTreemapData.map((h) => ({
            symbol: String(h.symbol ?? '').toUpperCase(),
            name: String(h.name ?? h.symbol ?? ''),
            quantity: Number(h.quantity ?? 0),
            avgCost: Number(h.avgCost ?? 0),
            currentValue: Number(h.currentValue ?? 0),
            gainLoss: Number(h.gainLoss ?? 0),
            gainLossPct: Number(h.gainLossPercent ?? 0),
            currency: String(h.portfolioCurrency ?? 'USD'),
            currentValueSar: toSAR(Number(h.currentValue ?? 0), h.portfolioCurrency, exchangeRate),
        })),
    }), [
        financialMetricsWithEf,
        investmentTreemapData,
        exchangeRate,
        liquidNw?.liquidNetWorth,
        managedWealthTotal,
        riskLane?.lane,
        liquidityRunway?.monthsOfRunway,
        discipline?.score,
        householdStress?.level,
        householdStress?.affordabilityPressureMonths,
        shockDrill?.template?.label,
        shockDrill?.householdProjectedYearEndDelta,
    ]);

    const downloadTextFile = useCallback((fileName: string, contents: string, mimeType: string) => {
        const blob = new Blob([contents], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const handleExportWealthSummaryJson = useCallback(() => {
        const json = generateWealthSummaryReportJson(wealthSummaryReportPayload);
        downloadTextFile(
            `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.json`,
            json,
            'application/json'
        );
    }, [wealthSummaryReportPayload, downloadTextFile]);

    const handleExportWealthSummaryCsv = useCallback(() => {
        const csv = generateWealthSummaryReportCsv(wealthSummaryReportPayload);
        downloadTextFile(
            `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.csv`,
            csv,
            'text/csv;charset=utf-8'
        );
    }, [wealthSummaryReportPayload, downloadTextFile]);

    const handlePrintWealthSummary = useCallback(() => {
        const html = generateWealthSummaryReportHtml(wealthSummaryReportPayload);
        const w = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760');
        if (!w) return;
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
    }, [wealthSummaryReportPayload]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading summary" />
            </div>
        );
    }

    return (
        <PageLayout 
            title="Financial Summary" 
            description="Key metrics and AI-generated financial persona with report card and suggestions."
            action={
                setActivePage && (
                    <PageActionsDropdown
                        ariaLabel="Summary quick links"
                        actions={[
                            { value: 'print-wealth-summary', label: 'Print wealth summary', onClick: handlePrintWealthSummary },
                            { value: 'export-wealth-json', label: 'Export wealth summary (JSON)', onClick: handleExportWealthSummaryJson },
                            { value: 'export-wealth-csv', label: 'Export wealth summary (CSV)', onClick: handleExportWealthSummaryCsv },
                            { value: 'wealth-ultra', label: 'Wealth Ultra', onClick: () => setActivePage('Wealth Ultra') },
                            { value: 'market-events', label: 'Market Events', onClick: () => setActivePage('Market Events') },
                            { value: 'assets', label: 'Assets', onClick: () => setActivePage('Assets') },
                            { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
                            { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                            { value: 'transactions', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                            { value: 'statement-upload', label: 'Import statements', onClick: () => setActivePage('Statement Upload') },
                        ]}
                    />
                )
            }
        >
            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isAdmin ? (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setActivePage?.('Assets')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActivePage?.('Assets'); } }}
                        className="lg:col-span-1 section-card flex flex-col justify-center items-center text-center border-t-4 border-primary cursor-pointer hover:shadow-md transition-shadow"
                        aria-label="View and manage assets"
                    >
                        <h2 className="text-lg font-medium text-gray-500 flex items-center gap-1">
                            My Net Worth
                            <InfoHint text="Personal wealth only. Items with Owner set (e.g. Father) are excluded from this total." placement="top" hintId="summary-personal-wealth" hintPage="Summary" />
                        </h2>
                        <p className="text-5xl font-extrabold text-dark my-2">{maskBalance(formatCurrencyString(financialMetricsWithEf.netWorth, { digits: 0 }))}</p>
                        <p className={`${financialMetricsWithEf.netWorthTrend >= 0 ? 'text-success' : 'text-danger'} font-semibold`}>
                            {financialMetricsWithEf.netWorthTrend >= 0 ? '+' : ''}{financialMetricsWithEf.netWorthTrend.toFixed(1)}% vs last month
                        </p>
                        <p className="text-xs text-slate-500 mt-2">Personal wealth only · Click to manage assets</p>
                        {managedWealthTotal > 0 && (
                            <p className="text-xs text-amber-700 mt-2 font-medium">Wealth under management: {maskBalance(formatCurrencyString(managedWealthTotal, { digits: 0 }))}</p>
                        )}
                    </div>
                ) : (
                    <div className="lg:col-span-1 section-card border-l-4 border-amber-400">
                        <h2 className="text-lg font-medium text-gray-700">Net Worth</h2>
                        <p className="text-sm text-slate-600 mt-2">Net worth visibility is restricted to Admin only.</p>
                    </div>
                )}

                <div className="lg:col-span-2 cards-grid grid grid-cols-1 sm:grid-cols-2">
                    <Card title="This Month's Income" value={formatCurrencyString(financialMetricsWithEf.monthlyIncome)} valueColor="text-success" />
                    <Card title="This Month's Expenses" value={formatCurrencyString(financialMetricsWithEf.monthlyExpenses)} valueColor="text-danger" />
                    <Card title="Savings Rate" value={`${(financialMetricsWithEf.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="The percentage of your income you are saving." />
                    <Card 
                        title="Emergency Fund" 
                        value={`${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months`}
                        tooltip={`Liquid cash covers ${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}`}
                        trend={financialMetricsWithEf.efTrend}
                        indicatorColor={financialMetricsWithEf.efStatus as 'green' | 'yellow' | 'red'}
                    />
                </div>
            </div>

            <CollapsibleSection title="Liquid net worth (simplified)" summary={maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))} className="border border-slate-200 bg-slate-50/50 mt-4">
                <p className="text-2xl font-extrabold text-primary mb-4">{maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>Cash (checking/savings): {maskBalance(formatCurrencyString(liquidNw.liquidCash, { digits: 0 }))}</span>
                    <span>Investments (book): {maskBalance(formatCurrencyString(liquidNw.investmentsSAR, { digits: 0 }))}</span>
                    <span>Commodities: {maskBalance(formatCurrencyString(liquidNw.commodities, { digits: 0 }))}</span>
                    <span>Receivables: {maskBalance(formatCurrencyString(liquidNw.receivables, { digits: 0 }))}</span>
                    <span>Debt: −{maskBalance(formatCurrencyString(liquidNw.shortTermDebt, { digits: 0 }))}</span>
                    <span className="text-slate-500">~30d cashflow est.: {maskBalance(formatCurrencyString(liquidNw.contributionEstimate30d, { digits: 0 }))}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Excludes illiquid physical assets. Investment values in account currency; not FX-normalized to SAR here.</p>
            </CollapsibleSection>

            {isAdmin && (
                <CollapsibleSection title="Net worth change vs flows (local snapshots)" summary="Contribution vs market-style residual" className="border border-violet-100 bg-violet-50/40 mt-4">
                    {nwSnapshotInsight.attr ? (
                        <>
                            <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                                {nwSnapshotInsight.attr.bullets.map((line, i) => (
                                    <li key={i}>{line}</li>
                                ))}
                            </ul>
                            <p className="text-xs text-slate-500 mt-2">
                                From last two Dashboard visits (admin). Full detail: <button type="button" className="text-primary font-medium" onClick={() => triggerPageAction ? triggerPageAction('Investments', 'openRiskTradingHub') : setActivePage?.('Investments')}>Safety &amp; rules →</button>
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-600">
                            Open <strong>Dashboard</strong> twice on different days as admin to record net worth snapshots; then this section shows contribution vs market-style residual.{' '}
                            {nwSnapshotInsight.snaps.length === 1 && (
                                <span className="block mt-1 text-slate-500">One snapshot stored—visit Dashboard again tomorrow.</span>
                            )}
                            {nwSnapshotInsight.snaps.length === 0 && (
                                <span className="block mt-1 text-slate-500">No snapshots yet—load Dashboard once to start.</span>
                            )}
                        </p>
                    )}
                </CollapsibleSection>
            )}
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                {isAdmin ? (
                    <div className="section-card flex flex-col h-[450px]">
                        <NetWorthCompositionChart title="Historical Net Worth" />
                    </div>
                ) : (
                    <div className="section-card flex flex-col h-[450px] justify-center">
                        <p className="text-sm text-slate-600 text-center px-6">Historical net worth chart is available for Admin only.</p>
                    </div>
                )}
                <div className="section-card flex flex-col h-[450px]">
                    <h3 className="section-title mb-4">Investment Allocation & Performance</h3>
                    <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                </div>
            </div>
            
            {householdStress && (
                <div className="section-card mt-6">
                    <h3 className="section-title mb-2">Household Cashflow Stress</h3>
                    <p className="text-sm text-slate-700 mb-1">
                        Current stress level: <span className="font-semibold uppercase">{householdStress.level}</span>
                    </p>
                    <p className="text-xs text-slate-600 mb-2">
                        {householdStress.summary}
                    </p>
                    {householdStress.flags.length > 0 && (
                        <ul className="text-xs text-slate-500 list-disc pl-5 space-y-0.5">
                            {householdStress.flags.slice(0, 3).map(flag => (
                                <li key={flag}>{flag}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                <div className="section-card">
                    <h3 className="section-title mb-2">Risk Lane</h3>
                    <p className="text-sm text-slate-700">
                        Current lane: <span className="font-semibold">{riskLane.lane}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                        Suggested profile: <span className="font-semibold">{riskLane.suggestedProfile}</span>
                    </p>
                    <ul className="text-xs text-slate-500 list-disc pl-5 mt-2 space-y-0.5">
                        {(riskLane.reasons ?? []).slice(0, 3).map((r, i) => <li key={r ?? i}>{r}</li>)}
                    </ul>
                </div>
                <div className="section-card">
                    <h3 className="section-title mb-2">Liquidity Runway</h3>
                    {liquidityRunway ? (
                        <>
                            <p className="text-sm text-slate-700">
                                Runway: <span className="font-semibold">{(liquidityRunway.monthsOfRunway ?? 0).toFixed(1)} months</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Portfolio drawdown: <span className="font-semibold">{(liquidityRunway.drawdownPct ?? 0).toFixed(1)}%</span>
                            </p>
                            <p className="text-xs text-slate-600 mt-2">{liquidityRunway.reasons?.[0] ?? '—'}</p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">Not enough data.</p>
                    )}
                </div>
                <div className="section-card">
                    <h3 className="section-title mb-2">Discipline Score</h3>
                    <p className="text-sm text-slate-700">
                        Score: <span className="font-semibold">{discipline?.score ?? 0}/100</span> ({discipline?.label ?? '—'})
                    </p>
                    <ul className="text-xs text-slate-500 list-disc pl-5 mt-2 space-y-0.5">
                        {(discipline.reasons ?? []).slice(0, 3).map((r, i) => <li key={r ?? i}>{r}</li>)}
                    </ul>
                </div>
            </div>

            <div className="section-card mt-6">
                <h3 className="section-title mb-2">Shock Drill (Auto)</h3>
                <p className="text-xs text-slate-500 mb-2">
                    Default template: <span className="font-semibold">{SHOCK_TEMPLATES.find(t => t.id === 'job_loss')?.label}</span>
                </p>
                {shockDrill ? (
                    <>
                        <p className="text-sm text-slate-700">
                            Household year-end delta: <span className="font-semibold">{formatCurrencyString(shockDrill.householdProjectedYearEndDelta ?? 0, { digits: 0 })}</span>
                        </p>
                        <p className="text-sm text-slate-700 mt-1">
                            Wealth Ultra value delta: <span className="font-semibold">{(shockDrill.wealthUltraPortfolioValueDeltaPct ?? 0).toFixed(1)}%</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2">{shockDrill.combinedRiskNote ?? '—'}</p>
                    </>
                ) : (
                    <p className="text-sm text-slate-500">Not enough data to run a drill.</p>
                )}
            </div>

            <div className="section-card max-w-full">
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex flex-col"><div className="flex items-center space-x-2"><LightBulbIcon className="h-6 w-6 text-yellow-500" /><h2 className="text-xl font-semibold text-dark">Financial Advisor</h2></div><p className="text-xs text-slate-500 mt-0.5">Direct, summarized guidance with a report card</p></div>
                    <button onClick={handleGenerateAnalysis} disabled={isLoading} className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Analyzing...' : (analysis ? 'Refresh Advisor Summary' : 'Generate Advisor Summary')}
                    </button>
                </div>
                {isLoading && <div className="text-center p-8 text-gray-500">Crafting your personal financial summary...</div>}
                {!isLoading && error && (
                    <div className="alert-error">
                         <h4 className="font-bold">AI Analysis Error</h4>
                         <SafeMarkdownRenderer content={error} />
                         <button type="button" onClick={handleGenerateAnalysis} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200">Retry</button>
                    </div>
                )}
                {!isLoading && !analysis && !error && <div className="text-center p-8 text-gray-500">Click "Generate Advisor Summary" to run the advisor manually.</div>}
                {analysis && !isLoading && !error && (
                    <div className="space-y-8 mt-4">
                        <div className="text-center bg-blue-50 p-6 rounded-lg border border-blue-200">
                             <SparklesIcon className="h-10 w-10 text-primary mx-auto mb-2" />
                             <h3 className="text-2xl font-bold text-dark">{analysis.persona.title}</h3>
                             <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{analysis.persona.description}</p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-dark mb-4 text-center">Financial Health Report Card</h3>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
                                {(analysis.reportCard ?? []).map((item, idx) => (
                                    <div key={item.metric ?? `report-${idx}`} className={`p-4 rounded-lg border-l-4 ${getRatingColors(item.rating).border} ${getRatingColors(item.rating).bg}`}>
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center space-x-3">
                                                 <MetricIcon metric={item.metric} />
                                                 <div>
                                                    <p className="font-bold text-dark">{item.metric}</p>
                                                    <p className={`text-sm font-semibold ${getRatingColors(item.rating).text}`}>{item.rating} ({item.value})</p>
                                                 </div>
                                            </div>
                                             {getRatingColors(item.rating).icon}
                                        </div>
                                        <div className="mt-3 text-sm text-gray-700 space-y-2">
                                            <p><strong className="font-medium">Analysis:</strong> {item.analysis}</p>
                                            <p><strong className="font-medium">Suggestion:</strong> {item.suggestion}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

export default Summary;
