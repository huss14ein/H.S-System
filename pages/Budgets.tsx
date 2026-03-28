import React, { useMemo, useState, useContext, useEffect, useRef } from 'react';
import ProgressBar from '../components/ProgressBar';
import { DataContext } from '../context/DataContext';
import Modal from '../components/Modal';
import { Budget, type Page } from '../types';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import Combobox from '../components/Combobox';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import { AuthContext } from '../context/AuthContext';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import PageActionsDropdown from '../components/PageActionsDropdown';
import SectionCard from '../components/SectionCard';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import {
    buildHouseholdBudgetPlan,
    buildHouseholdEngineInputFromData,
    computeBulkAddLimitsForSelection,
    deriveEngineProfileFromRiskProfile,
    HOUSEHOLD_ENGINE_PROFILES,
    HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS,
    generateHouseholdBudgetCategories,
    KSA_EXPENSE_CATEGORY_HINTS,
    monthlyEquivalentFromBudgetLimit,
    type HouseholdEngineProfile,
    type HouseholdMonthlyOverride,
} from '../services/householdBudgetEngine';

/** Explanations for each budget category (KSA + generic). Used for InfoHint next to category names. */
const BUDGET_CATEGORY_HINTS: Record<string, string> = {
    ...KSA_EXPENSE_CATEGORY_HINTS,
    Food: 'Groceries, dining out, and household food spending. Track all food-related expenses here.',
    Transportation: 'Fuel, public transport, ride-share, and vehicle costs. Petrol, metro, Uber/Careem, or car maintenance.',
    Housing: 'Rent, mortgage, or housing-related payments. Prefer a single yearly Housing Rent budget from the household engine.',
    Utilities: 'Electricity, water, gas, and similar bills. Note: electricity often spikes in summer.',
    Shopping: 'General retail and non-essential purchases. Clothing, household items, or discretionary shopping.',
    Entertainment: 'Subscriptions, dining out, and leisure. Restaurants, streaming (Netflix/Shahid), cinema, and hobbies.',
    Health: 'Medical, pharmacy, and wellness. Doctor visits, prescriptions, and health-related expenses.',
    Education: 'Tuition, books, and training. School fees, courses, and learning materials.',
    'Savings & Investments': 'Money set aside or invested. Use for transfers to savings accounts or investment contributions.',
    'Personal Care': 'Toiletries, grooming, and self-care. Haircuts, skincare, and personal hygiene products.',
    Miscellaneous: 'Other or uncategorized expenses. Use when a transaction does not fit other categories.',
    'School & Children': 'School fees, uniforms, books, and child-related education or activities.',
    Rent: 'Rent payments. Use Housing if you prefer a single housing category.',
};

function getCategoryHint(category: string): string {
    return BUDGET_CATEGORY_HINTS[category] ?? `Track spending in "${category}". Assign transactions to this category to compare against the limit.`;
}
import {
    predictFutureMonths,
    generateCommonScenarios,
    detectAnomalies,
    detectSeasonality,
    effectiveMonthExpense,
    type PredictiveForecast,
    type ScenarioAnalysis,
    type BudgetAnomaly,
    type SeasonalityPattern,
} from '../services/householdBudgetAnalytics';
import { detectRecurringBillPatterns, addBenchmarkComparison } from '../services/hybridBudgetCategorization';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { learnAndAutoAdjust } from '../services/aiBudgetAutomation';
import { getPersonalTransactions } from '../utils/wealthScope';
import { useSelfLearning } from '../context/SelfLearningContext';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import AIAdvisor from '../components/AIAdvisor';



const resolveRecipientUserByEmail = async (email: string) => {
    if (!supabase) return { data: null as { id: string; email: string | null } | null, error: { message: 'Supabase client is unavailable.' } as { message: string } | null };

    const rpcLookup = await supabase.rpc('find_user_by_email', { target_email: email });
    const rpcRow = Array.isArray(rpcLookup.data) ? rpcLookup.data[0] : rpcLookup.data;
    if (rpcRow?.id) {
        return { data: { id: rpcRow.id as string, email: (rpcRow.email as string | null) ?? email }, error: null };
    }

    const baseMessage = rpcLookup.error?.message || 'Recipient user not found.';
    const normalizedMessage = /column\s+users\.email\s+does not exist/i.test(baseMessage)
        ? 'Recipient lookup is using an outdated SQL helper. Re-run docs/budget_sharing_ready.sql to install the latest find_user_by_email function.'
        : baseMessage;

    return { data: null, error: { message: normalizedMessage } };
};
interface BudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => void;
    budgetToEdit: Budget | null;
    currentMonth: number;
    currentYear: number;
}

const BudgetModal: React.FC<BudgetModalProps> = ({ isOpen, onClose, onSave, budgetToEdit, currentMonth, currentYear }) => {
    const { data } = useContext(DataContext)!;
    const { getLearnedDefault, trackFormDefault } = useSelfLearning();
    const [category, setCategory] = useState('');
    const [limit, setLimit] = useState('');
    const [limitPeriod, setLimitPeriod] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [tier, setTier] = useState<'Core' | 'Supporting' | 'Optional'>('Optional');

    const existingCategories = useMemo(() => new Set((data?.budgets ?? []).filter(b => b.year === currentYear && b.month === currentMonth).map(b => b.category)), [data?.budgets, currentYear, currentMonth]);
    
    const availableCategories = useMemo(() => {
        const allPossible = ['Food', 'Transportation', 'Housing', 'Utilities', 'Shopping', 'Entertainment', 'Health', 'Education', 'Savings & Investments', 'Personal Care', 'Miscellaneous'];
        if (budgetToEdit) return allPossible;
        return allPossible.filter(c => !existingCategories.has(c));
    }, [existingCategories, budgetToEdit]);


    React.useEffect(() => {
        if (budgetToEdit) {
            setCategory(budgetToEdit.category);
            setLimit(String(budgetToEdit.limit));
            setLimitPeriod(budgetToEdit.period === 'yearly' ? 'Yearly' : budgetToEdit.period === 'weekly' ? 'Weekly' : budgetToEdit.period === 'daily' ? 'Daily' : 'Monthly');
            setTier((budgetToEdit as { tier?: 'Core' | 'Supporting' | 'Optional' }).tier ?? 'Optional');
        } else {
            const learnedPeriod = getLearnedDefault('budget-add', 'limitPeriod') as string | undefined;
            const learnedTier = getLearnedDefault('budget-add', 'tier') as string | undefined;
            const validPeriods: ('Monthly' | 'Weekly' | 'Daily' | 'Yearly')[] = ['Monthly', 'Weekly', 'Daily', 'Yearly'];
            const validTiers: ('Core' | 'Supporting' | 'Optional')[] = ['Core', 'Supporting', 'Optional'];
            setCategory('');
            setLimit('');
            setLimitPeriod(learnedPeriod && validPeriods.includes(learnedPeriod as any) ? (learnedPeriod as any) : 'Monthly');
            setTier(learnedTier && validTiers.includes(learnedTier as any) ? (learnedTier as any) : 'Optional');
        }
    }, [budgetToEdit, isOpen, getLearnedDefault]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const rawLimit = parseFloat(limit) || 0;
        const isYearly = limitPeriod === 'Yearly';
        const period = isYearly ? 'yearly' : limitPeriod === 'Weekly' ? 'weekly' : limitPeriod === 'Daily' ? 'daily' : 'monthly';
        const month = budgetToEdit ? budgetToEdit.month : (isYearly ? 1 : currentMonth);
        const year = budgetToEdit ? budgetToEdit.year : currentYear;

        onSave({
            category,
            limit: rawLimit,
            month,
            year,
            period,
            tier,
        }, !!budgetToEdit);
        if (!budgetToEdit) {
            trackFormDefault('budget-add', 'limitPeriod', limitPeriod);
            trackFormDefault('budget-add', 'tier', tier);
        }
        onClose();
    };
    


    return (
        <Modal isOpen={isOpen} onClose={onClose} title={budgetToEdit ? 'Edit Budget' : 'Add Budget'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700 flex items-center">Category <InfoHint text={category ? getCategoryHint(category) : 'Budget category (e.g. Food, Housing). One budget per category per month; spending is tracked against this.'} /></label>
                    {budgetToEdit ? (
                        <input type="text" id="category" value={category} disabled className="mt-1 w-full p-2 border border-gray-300 rounded-md bg-gray-100" />
                    ) : (
                        <div className="mt-1">
                            <Combobox 
                                items={availableCategories}
                                selectedItem={category}
                                onSelectItem={setCategory}
                                placeholder="Select or create a category..."
                            />
                        </div>
                    )}
                </div>
                <div>
                    <label htmlFor="budget-tier" className="block text-sm font-medium text-gray-700 flex items-center">Budget Type <InfoHint text="Core: essential spending (e.g. rent, food). Supporting: important but flexible. Optional: discretionary." /></label>
                    <select id="budget-tier" value={tier} onChange={(e) => setTier(e.target.value as 'Core' | 'Supporting' | 'Optional')} className="select-base">
                        <option value="Core">Core (essential)</option>
                        <option value="Supporting">Supporting</option>
                        <option value="Optional">Optional</option>
                    </select>
                </div>
                 <div>
                    <label htmlFor="limit" className="block text-sm font-medium text-gray-700 flex items-center">Budget Amount <InfoHint text="Choose Monthly or Yearly. Yearly budgets (e.g. housing) are stored as-is and compared to spending per month (limit÷12) in reports." /></label>
                    <input type="number" id="limit" value={limit} onChange={e => setLimit(e.target.value)} required className="input-base" />
                </div>
                <div>
                    <label htmlFor="limitPeriod" className="block text-sm font-medium text-gray-700 flex items-center">Amount Period <InfoHint text="Monthly or Yearly. Yearly is stored as-is and applies to all months of the year." /></label>
                    <select id="limitPeriod" value={limitPeriod} onChange={(e) => setLimitPeriod(e.target.value as any)} className="select-base">
                        <option value="Monthly">Monthly</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Daily">Daily</option>
                        <option value="Yearly">Yearly (all months)</option>
                    </select>
                </div>
                <button type="submit" className="w-full btn-primary">Save Budget</button>
            </form>
        </Modal>
    );
}

interface BudgetsProps {
    triggerPageAction?: (page: Page, action: string) => void;
    setActivePage?: (page: Page) => void;
}

const Budgets: React.FC<BudgetsProps> = ({ triggerPageAction, setActivePage }) => {
    const { data, loading, dataResetKey, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { trackSuggestionFeedback } = useSelfLearning();
    const { formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const [isAdmin, setIsAdmin] = useState(false);
    const [permittedCategories, setPermittedCategories] = useState<string[]>([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [requestAmount, setRequestAmount] = useState('');
    const [requestAmountPeriod, setRequestAmountPeriod] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [requestNote, setRequestNote] = useState('');
    const [requestType, setRequestType] = useState<'NewCategory' | 'IncreaseLimit' | 'AdvanceFromNextMonth'>('NewCategory');
    const [requestCategoryId, setRequestCategoryId] = useState('');
    const [governanceCategories, setGovernanceCategories] = useState<Array<{ id: string; name: string; monthly_limit?: number }>>([]);
    const [budgetRequests, setBudgetRequests] = useState<any[]>([]);
    const [requestSearch, setRequestSearch] = useState('');
    const [requestSort, setRequestSort] = useState<'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow'>('Newest');
    const [requestStatusFilter, setRequestStatusFilter] = useState<'All' | 'Pending' | 'Finalized' | 'Rejected'>('All');
    const [requestMonthFilter, setRequestMonthFilter] = useState<string>('');
    const [historyItemsToShow, setHistoryItemsToShow] = useState(10);
    const [historyCollapsed, setHistoryCollapsed] = useState(false);
    const HISTORY_PAGE_SIZE = 15;

    const [currentDate, setCurrentDate] = useState(new Date());
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [budgetView, setBudgetView] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [budgetSubPage, setBudgetSubPage] = useState<'overview' | 'household'>('overview');
    const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);
    const [cardOrder, setCardOrder] = useState<string[]>([]);
    const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
    const [sharedBudgets, setSharedBudgets] = useState<Array<Budget & { ownerEmail?: string }>>([]);
    const [shareTargetEmail, setShareTargetEmail] = useState('');
    const [shareableUsers, setShareableUsers] = useState<Array<{ id: string; email: string }>>([]);
    const [shareUsersLoadError, setShareUsersLoadError] = useState<string | null>(null);
    const [shareCategory, setShareCategory] = useState('ALL');
    const [ownerSharedTransactions, setOwnerSharedTransactions] = useState<any[]>([]);
    const [mySharedBudgetTransactions, setMySharedBudgetTransactions] = useState<any[]>([]);
    const [sharedConsumedByOwnerCategory, setSharedConsumedByOwnerCategory] = useState<Map<string, number>>(new Map());
    const [sharedConsumedSyncedAt, setSharedConsumedSyncedAt] = useState<number | null>(null);
    const [sharedTxMonthFilter, setSharedTxMonthFilter] = useState<string>(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    const [sharedTxStatusFilter, setSharedTxStatusFilter] = useState<'All' | 'Approved' | 'Pending' | 'Rejected'>('All');
    const [sharedTxCategoryFilter, setSharedTxCategoryFilter] = useState<string>('All');
    const [showKsaExpenseRef, setShowKsaExpenseRef] = useState(false);
    const [suggestedAdjustments, setSuggestedAdjustments] = useState<Array<{ orig: Budget; proposed: Budget }> | null>(null);
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const accountCurrencyById = useMemo(() => {
        const map = new Map<string, 'SAR' | 'USD'>();
        (((data as any)?.personalAccounts ?? data?.accounts ?? []) as Array<{ id: string; currency?: string }>).forEach((a) => {
            map.set(a.id, a.currency === 'USD' ? 'USD' : 'SAR');
        });
        return map;
    }, [data]);
    const txAmountSar = (tx: any): number => {
        const raw = Math.abs(Number(tx?.amount) || 0);
        const txCur = tx?.currency === 'USD' ? 'USD' : tx?.currency === 'SAR' ? 'SAR' : undefined;
        const accId = String(tx?.accountId ?? tx?.account_id ?? '');
        const fallbackCur = accountCurrencyById.get(accId) ?? 'SAR';
        return toSAR(raw, txCur ?? fallbackCur, sarPerUsd);
    };

    // Update shared transaction month filter when current month changes
    useEffect(() => {
        setSharedTxMonthFilter(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    }, [currentYear, currentMonth]);
    const [householdAdults, setHouseholdAdults] = useState(2);
    const [householdKids, setHouseholdKids] = useState(0);
    const [householdOverrides, setHouseholdOverrides] = useState<HouseholdMonthlyOverride[]>([]);
    const [engineProfile, setEngineProfile] = useState<HouseholdEngineProfile>('Moderate');
    const [expectedMonthlySalary, setExpectedMonthlySalary] = useState<number | ''>('');
    const [selectedScenario, setSelectedScenario] = useState('custom');
    const [showPredictiveAnalytics, setShowPredictiveAnalytics] = useState(false);
    const [showScenarioPlanning, setShowScenarioPlanning] = useState(false);
    const [showSeasonality, setShowSeasonality] = useState(false);
    const [predictiveForecasts, setPredictiveForecasts] = useState<PredictiveForecast[]>([]);
    const [scenarios, setScenarios] = useState<ScenarioAnalysis[]>([]);
    const [anomalies, setAnomalies] = useState<BudgetAnomaly[]>([]);
    const [seasonalityPatterns, setSeasonalityPatterns] = useState<SeasonalityPattern[]>([]);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** Map household engine bucket keys to budget category names (for merging engine projection with template). */
    const ENGINE_BUCKET_TO_CATEGORY: Record<string, string> = useMemo(() => ({
        housing: 'Housing Rent',
        groceries: 'Groceries & Supermarket',
        utilities: 'Utilities',
        telecommunications: 'Telecommunications',
        transportation: 'Transportation',
        domesticHelp: 'Domestic Help',
        diningEntertainment: 'Dining & Entertainment',
        insuranceCoPay: 'Insurance Co-pay',
        health: 'Health',
        debtLoans: 'Debt/Loans',
        remittances: 'Remittances',
        pocketMoney: 'Pocket Money',
        personalCare: 'Personal Care',
        shopping: 'Shopping',
        miscellaneous: 'Miscellaneous',
        schoolTuition: 'School Tuition (Semester)',
        householdMaintenance: 'Bulk Household Maintenance',
        iqamaRenewal: 'Iqama Renewal',
        dependentFees: 'Dependent Fees',
        exitReentryVisa: 'Exit/Re-entry Visa',
        vehicleInsurance: 'Vehicle Insurance',
        istimara: 'Istimara (Registration)',
        fahas: 'Fahas (MVPI)',
        schoolUniformsBooks: 'School Uniforms & Books',
        zakat: 'Zakat',
        annualVacation: 'Annual Vacation',
        freshProduce: 'Fresh Produce (Weekly)',
        householdHelpHourly: 'Household Help (Hourly)',
        leisureWeekly: 'Leisure (Weekly)',
        emergencySavings: 'Savings & Investments',
        reserveSavings: 'Savings & Investments',
        goalSavings: 'Savings & Investments',
        retirementSavings: 'Savings & Investments',
        investing: 'Savings & Investments',
        kidsFutureSavings: 'School & Children',
    }), []);

    /** Engine buckets are stored as monthly (or monthly-equivalent sinking). Multiplier converts to stored limit for that category's period. */
    const ENGINE_BUCKET_TO_STORED_MULTIPLIER: Record<string, number> = useMemo(() => ({
        /** Engine bucket is monthly rent; template stores yearly total. */
        housing: 12,
        groceries: 1,
        utilities: 1,
        telecommunications: 1,
        transportation: 1,
        domesticHelp: 1,
        diningEntertainment: 1,
        entertainment: 1,
        insuranceCoPay: 1,
        health: 1,
        debtLoans: 1,
        remittances: 1,
        pocketMoney: 1,
        personalCare: 1,
        shopping: 1,
        miscellaneous: 1,
        schoolTuition: 6,
        householdMaintenance: 6,
        iqamaRenewal: 12,
        dependentFees: 12,
        exitReentryVisa: 12,
        vehicleInsurance: 12,
        istimara: 12,
        fahas: 12,
        schoolUniformsBooks: 12,
        zakat: 12,
        annualVacation: 12,
        freshProduce: 1 / 4.33,
        householdHelpHourly: 1 / 4.33,
        leisureWeekly: 1 / 4.33,
        emergencySavings: 1,
        reserveSavings: 1,
        goalSavings: 1,
        retirementSavings: 1,
        investing: 1,
        kidsFutureSavings: 1,
    }), []);

    // Approved Budgets Overview (admin) filters and scope
    const [approvedOverviewMonth, setApprovedOverviewMonth] = useState(currentMonth);
    const [approvedOverviewYear, setApprovedOverviewYear] = useState(currentYear);
    const [approvedOverviewPeriodFilter, setApprovedOverviewPeriodFilter] = useState<'all' | 'monthly' | 'weekly' | 'yearly' | 'daily'>('all');
    const [approvedOverviewTierFilter, setApprovedOverviewTierFilter] = useState<'all' | 'Core' | 'Supporting' | 'Optional'>('all');
    const [approvedOverviewSearch, setApprovedOverviewSearch] = useState('');

    /** Household engine: bulk add — target month/year (single unified mode). */
    const [bulkAddTargetMonth, setBulkAddTargetMonth] = useState(currentMonth);
    const [bulkAddTargetYear, setBulkAddTargetYear] = useState(currentYear);
    const [bulkAddSalary, setBulkAddSalary] = useState<number | ''>('');
    /** Scales suggested limits (%) before bulk create — applied after engine/template merge. */
    const [bulkLimitScalePercent, setBulkLimitScalePercent] = useState(100);
    const [bulkAddSelectedCategories, setBulkAddSelectedCategories] = useState<string[]>([]);
    /** Previous bulk-add template category order; used to merge user checkbox state when salary/family/profile/month updates. */
    const bulkAddPrevSuggestionNamesRef = useRef<string[]>([]);

    type BudgetTier = 'Core' | 'Supporting' | 'Optional';

    type BudgetRow = Budget & {
        spent: number;
        percentage: number;
        colorClass: string;
        displayLimit: number;
        monthlyLimit: number;
        previousPeriodSpent?: number;
        trendDelta?: number;
        trendDirection?: 'up' | 'down' | 'flat';
        budgetTier?: BudgetTier;
        utilizationLabel?: 'Healthy' | 'Watch' | 'Critical';
    };

    const householdProfileStorageKey = useMemo(() => `household-profile:${auth?.user?.id ?? 'anon'}`, [auth?.user?.id]);
    const householdProfileCloudEnabled = Boolean(supabase && auth?.user?.id);
    const [householdProfileCloudLoadedUserId, setHouseholdProfileCloudLoadedUserId] = useState<string | null>(null);

    React.useEffect(() => {
        try {
            const raw = localStorage.getItem(householdProfileStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Number.isFinite(parsed?.adults)) setHouseholdAdults(Math.max(1, Math.round(parsed.adults)));
                if (Number.isFinite(parsed?.kids)) setHouseholdKids(Math.max(0, Math.round(parsed.kids)));
                if (Array.isArray(parsed?.overrides)) setHouseholdOverrides(parsed.overrides);
                if (parsed?.profile && Object.prototype.hasOwnProperty.call(HOUSEHOLD_ENGINE_PROFILES, parsed.profile)) {
                    setEngineProfile(parsed.profile as HouseholdEngineProfile);
                }
                if (typeof parsed?.expectedMonthlySalary === 'number' && parsed.expectedMonthlySalary > 0) {
                    setExpectedMonthlySalary(parsed.expectedMonthlySalary);
                }
            }
        } catch {
            // no-op
        }
    }, [householdProfileStorageKey]);

    React.useEffect(() => {
        const userId = auth?.user?.id;
        const db = supabase;
        if (!householdProfileCloudEnabled || !userId || !db) {
            setHouseholdProfileCloudLoadedUserId(null);
            return;
        }
        let isMounted = true;
        setHouseholdProfileCloudLoadedUserId(null);
        (async () => {
            try {
                const { data, error } = await db
                    .from('household_budget_profiles')
                    .select('profile')
                    .eq('user_id', userId)
                    .maybeSingle();
                if (error || !data || !isMounted) return;
                const profile = (data as { profile?: any })?.profile;
                if (!profile || typeof profile !== 'object') return;
                if (Number.isFinite(profile?.adults)) setHouseholdAdults(Math.max(1, Math.round(profile.adults)));
                if (Number.isFinite(profile?.kids)) setHouseholdKids(Math.max(0, Math.round(profile.kids)));
                if (Array.isArray(profile?.overrides)) setHouseholdOverrides(profile.overrides);
                if (profile?.profile && Object.prototype.hasOwnProperty.call(HOUSEHOLD_ENGINE_PROFILES, profile.profile)) {
                    setEngineProfile(profile.profile as HouseholdEngineProfile);
                }
                if (typeof profile?.expectedMonthlySalary === 'number' && profile.expectedMonthlySalary > 0) {
                    setExpectedMonthlySalary(profile.expectedMonthlySalary);
                }
            } catch {
                // Optional cloud sync path, safe to ignore when migration is not applied.
            } finally {
                if (isMounted) setHouseholdProfileCloudLoadedUserId(userId);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, [householdProfileCloudEnabled, auth?.user?.id]);

    React.useEffect(() => {
        try {
            localStorage.setItem(householdProfileStorageKey, JSON.stringify({
                adults: householdAdults,
                kids: householdKids,
                overrides: householdOverrides,
                profile: engineProfile,
                expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
            }));
        } catch {
            // no-op
        }
    }, [householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary, householdProfileStorageKey]);

    React.useEffect(() => {
        const userId = auth?.user?.id;
        const db = supabase;
        if (!householdProfileCloudEnabled || !userId || !db || householdProfileCloudLoadedUserId !== userId) return;
        const payload = {
            adults: householdAdults,
            kids: householdKids,
            overrides: householdOverrides,
            profile: engineProfile,
            expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
        };
        const t = window.setTimeout(async () => {
            try {
                await db
                    .from('household_budget_profiles')
                    .upsert({ user_id: userId, profile: payload }, { onConflict: 'user_id' });
            } catch {
                // Optional cloud sync path, safe to ignore when migration is not applied.
            }
        }, 700);
        return () => window.clearTimeout(t);
    }, [householdProfileCloudEnabled, auth?.user?.id, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary, householdProfileCloudLoadedUserId]);

    const householdBudgetEngine = useMemo(() => {
        const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const incomeByMonth = Array(12).fill(0);
        transactions.forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== currentYear || t.type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
        });
        const incomeWithData = incomeByMonth.filter((v) => v > 0);
        const suggested = incomeWithData.length > 0 ? Math.round(incomeWithData.reduce((a, b) => a + b, 0) / incomeWithData.length) : 0;

        const input = buildHouseholdEngineInputFromData(
            transactions as Array<{ date: string; type?: string; amount?: number }>,
            accounts as Array<{ type?: string; balance?: number }>,
            (data?.goals ?? []) as any[],
            {
                year: currentYear,
                expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : (suggested > 0 ? suggested : undefined),
                adults: householdAdults,
                kids: householdKids,
                profile: engineProfile,
                monthlyOverrides: householdOverrides,
            }
        );
        const result = buildHouseholdBudgetPlan(input);
        
        // Calculate predictive analytics dynamically
        try {
            if (result.months.length >= 3) {
                const forecasts = predictFutureMonths(result.months, 3);
                setPredictiveForecasts(forecasts);
                
                const commonScenarios = generateCommonScenarios(result, input.goals.map((g) => ({ name: g.name, remaining: Math.max(0, (g.targetAmount ?? 0) - (g.currentAmount ?? 0)) })));
                setScenarios(commonScenarios);
                
                       const detectedAnomalies = detectAnomalies(result.months);
                       setAnomalies(detectedAnomalies);

                       const seasonality = detectSeasonality(result.months);
                       setSeasonalityPatterns(seasonality);
                   } else {
                       setPredictiveForecasts([]);
                       setScenarios([]);
                       setAnomalies([]);
                       setSeasonalityPatterns([]);
                   }
               } catch (error) {
                   console.warn('Failed to calculate household budget analytics:', error);
                   setPredictiveForecasts([]);
                   setScenarios([]);
                   setAnomalies([]);
                   setSeasonalityPatterns([]);
               }
        
        return result;
    }, [data?.transactions, data?.accounts, (data as any)?.personalTransactions, (data as any)?.personalAccounts, data?.goals, currentYear, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary]);

    const suggestedMonthlySalary = useMemo(() => {
        const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const incomeByMonth = Array(12).fill(0);
        transactions.forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== currentYear || t.type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
        });
        const withData = incomeByMonth.filter((v) => v > 0);
        return withData.length > 0 ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;
    }, [data?.transactions, (data as any)?.personalTransactions, currentYear]);

    const recurringBillsWithBenchmarks = useMemo(() => {
        const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Array<{ date: string; type?: string; amount?: number; description?: string }>;
        const patterns = detectRecurringBillPatterns(txs as any, 2);
        return patterns.map((p) => addBenchmarkComparison(p));
    }, [data?.transactions, (data as any)?.personalTransactions]);

    const { household: householdConstraints } = useFinancialEnginesIntegration();

    React.useEffect(() => {
        const next = deriveEngineProfileFromRiskProfile(
            engineProfile,
            String((data as any)?.settings?.riskProfile || '')
        );
        if (next !== engineProfile) setEngineProfile(next);
    }, [(data as any)?.settings?.riskProfile]);

    const categoryNameById = useMemo(() => new Map(governanceCategories.map((c) => [c.id, c.name])), [governanceCategories]);
    const resolveRequestCategory = (request: any) => request.category_name || categoryNameById.get(request.category_id) || request.category_id || 'N/A';
    const requestStatusClasses: Record<string, string> = {
        Pending: 'bg-amber-100 text-amber-800',
        Finalized: 'bg-green-100 text-green-800',
        Rejected: 'bg-rose-100 text-rose-800',
    };

    const parseRequestedAmountMeta = (request: any): { rawAmount?: number; rawPeriod?: 'Monthly' | 'Weekly' | 'Daily' | 'Yearly' } => {
        const note = String(request?.request_note || request?.note || '');
        const m = note.match(/\[Requested period:\s*(Monthly|Weekly|Daily|Yearly);\s*Raw:\s*([0-9]+(?:\.[0-9]+)?)\]/i);
        if (!m) return {};
        const rawAmount = Number(m[2]);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) return {};
        return { rawAmount, rawPeriod: m[1] as any };
    };

    const addMonths = (month: number, year: number, delta: number): { month: number; year: number } => {
        const d = new Date(year, month - 1 + delta, 1);
        return { month: d.getMonth() + 1, year: d.getFullYear() };
    };
    const parseAdvanceMeta = (request: any): { fromYear: number; fromMonth: number; toYear: number; toMonth: number } | null => {
        const note = String(request?.request_note || request?.note || '');
        const m = note.match(/\[AdvanceFromNextMonth:\s*from=(\d{4})-(\d{2});\s*to=(\d{4})-(\d{2})\]/i);
        if (!m) return null;
        const fromYear = Number(m[1]);
        const fromMonth = Number(m[2]);
        const toYear = Number(m[3]);
        const toMonth = Number(m[4]);
        if (![fromYear, fromMonth, toYear, toMonth].every(Number.isFinite)) return null;
        if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) return null;
        return { fromYear, fromMonth, toYear, toMonth };
    };
    const requestMode = (request: any): 'Standard' | 'AdvanceFromNextMonth' => {
        const note = String(request?.request_note || request?.note || '');
        return /\[Request mode:\s*AdvanceFromNextMonth\]/i.test(note) ? 'AdvanceFromNextMonth' : 'Standard';
    };
    const displayRequestType = (request: any): string =>
        requestMode(request) === 'AdvanceFromNextMonth'
            ? 'Advance from next month'
            : (request?.request_type ?? 'Request');

    React.useEffect(() => {
        const loadGovernance = async () => {
            if (!supabase || !auth?.user) return;
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            const admin = inferIsAdmin(auth.user, userRecord?.role ?? null);
            setIsAdmin(admin);

            const { data: categories } = await supabase
                .from('categories')
                .select('id, name, monthly_limit')
                .order('name', { ascending: true });
            setGovernanceCategories(categories || []);

            if (!admin) {
                const { data: permissions } = await supabase
                    .from('permissions')
                    .select('categories(name)')
                    .eq('user_id', auth.user.id);
                setPermittedCategories((permissions || []).map((p: any) => p.categories?.name).filter(Boolean));

                const { data: ownRequests } = await supabase
                    .from('budget_requests')
                    .select('*')
                    .eq('user_id', auth.user.id)
                    .order('created_at', { ascending: false });
                setBudgetRequests(ownRequests || []);
            } else {
                const { data: requests } = await supabase
                    .from('budget_requests')
                    .select('*')
                    .order('created_at', { ascending: false });
                setBudgetRequests(requests || []);
            }

            // Shared budgets are fetched through an RPC so recipients only see explicitly shared budget rows.
            const { data: sharedRows, error: sharedRowsError } = await supabase
                .rpc('get_shared_budgets_for_me')
                .then((r) => r, () => ({ data: [] as any[], error: null } as any));

            if (sharedRowsError) {
                const message = (sharedRowsError.message || '').trim();
                const normalized = /get_shared_budgets_for_me|function\s+public\.get_shared_budgets_for_me/i.test(message)
                    ? 'Shared budgets are unavailable until the latest migration is applied. Run docs/budget_sharing_ready.sql.'
                    : message || 'Could not load shared budgets right now.';
                console.warn(normalized);
                setSharedBudgets([]);
            } else {
                const filtered = ((sharedRows || []) as any[]).map((b) => ({
                    ...b,
                    period: b.period ?? 'monthly',
                    month: Number(b.month) || currentMonth,
                    year: Number(b.year) || currentYear,
                    tier: b.tier ?? b.budget_tier ?? 'Optional',
                    ownerEmail: b.owner_email || b.owner_user_id || b.user_id,
                }));
                setSharedBudgets(filtered);
            }


            const { data: consumedRows } = await supabase
                .rpc('get_shared_budget_consumed_for_me')
                .then((r) => r, () => ({ data: [] as any[] } as any));
            const consumedMap = new Map<string, number>();
            ((consumedRows || []) as any[]).forEach((row: any) => {
                const ownerKey = String(row.owner_user_id || 'owner');
                const category = String(row.category || '').trim();
                if (!category) return;
                consumedMap.set(`${ownerKey}::${category}`, Number(row.consumed_amount) || 0);
            });
            setSharedConsumedByOwnerCategory(consumedMap);
            setSharedConsumedSyncedAt(Date.now());
            const { data: ownerTxRows } = await supabase
                .from('budget_shared_transactions')
                .select('*')
                .eq('owner_user_id', auth.user.id)
                .order('transaction_date', { ascending: false })
                .then((r) => r, () => ({ data: [] as any[] } as any));
            setOwnerSharedTransactions((ownerTxRows || []) as any[]);

            const { data: myTxRows } = await supabase
                .from('budget_shared_transactions')
                .select('*')
                .eq('contributor_user_id', auth.user.id)
                .order('transaction_date', { ascending: false })
                .then((r) => r, () => ({ data: [] as any[] } as any));
            setMySharedBudgetTransactions((myTxRows || []) as any[]);
        };

        loadGovernance();
    }, [auth?.user?.id, dataResetKey]);


    React.useEffect(() => {
        const loadShareableUsers = async () => {
        if (!supabase || !auth?.user?.id || !isAdmin) {
            setShareableUsers([]);
            setShareUsersLoadError(null);
            return;
            }

            const { data: users, error } = await supabase.rpc('list_shareable_users');
            if (error) {
                const message = (error.message || '').trim();
                const normalized = /list_shareable_users|function\s+public\.list_shareable_users/i.test(message)
                    ? 'Shareable users list is unavailable. Run docs/budget_sharing_ready.sql to install list_shareable_users (Admin-only).'
                    : message || 'Unable to load users list.';
                setShareUsersLoadError(normalized);
                setShareableUsers([]);
                return;
            }

            const rows = (Array.isArray(users) ? users : []).filter((row: any) => row?.id && row?.email);
            setShareableUsers(rows.map((row: any) => ({ id: String(row.id), email: String(row.email).toLowerCase() })));
            setShareUsersLoadError(null);
        };

        loadShareableUsers();
    }, [auth?.user?.id, isAdmin]);

    const budgetData = useMemo<BudgetRow[]>(() => {
        const spending = new Map<string, number>();
        const previousSpending = new Map<string, number>();

        const now = new Date();
        const rangeStart = new Date(now);
        const rangeEnd = new Date(now);
        const previousRangeStart = new Date(now);
        const previousRangeEnd = new Date(now);

        if (budgetView === 'Monthly') {
            rangeStart.setFullYear(currentYear, currentMonth - 1, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, currentMonth, 0);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setFullYear(currentYear, currentMonth - 2, 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setFullYear(currentYear, currentMonth - 1, 0);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Weekly') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            rangeStart.setDate(now.getDate() - diffToMonday);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setDate(rangeStart.getDate() + 6);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setDate(rangeStart.getDate() - 7);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setDate(rangeStart.getDate() - 1);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Daily') {
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setDate(now.getDate() - 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setDate(now.getDate() - 1);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else {
            rangeStart.setFullYear(currentYear, 0, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, 11, 31);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setFullYear(currentYear - 1, 0, 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setFullYear(currentYear - 1, 11, 31);
            previousRangeEnd.setHours(23, 59, 59, 999);
        }

        ((data as any)?.personalTransactions ?? data?.transactions ?? [])
            .filter((t: { type?: string; status?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && (t.status ?? 'Approved') === 'Approved' && !!t.budgetCategory)
            .forEach((t: { date: string; amount?: number; budgetCategory?: string }) => {
                const txDate = new Date(t.date);
                const amount = txAmountSar(t);
                if (txDate >= rangeStart && txDate <= rangeEnd) {
                    spending.set(t.budgetCategory!, (spending.get(t.budgetCategory!) || 0) + amount);
                }
                if (txDate >= previousRangeStart && txDate <= previousRangeEnd) {
                    previousSpending.set(t.budgetCategory!, (previousSpending.get(t.budgetCategory!) || 0) + amount);
                }
            });

        // Reflect collaborator spending into owner budget totals for shared categories.
        ownerSharedTransactions.forEach((tx) => {
            if ((tx.status ?? 'Approved') !== 'Approved') return;
            const d = new Date(tx.transaction_date || tx.date);
            if (!(d >= rangeStart && d <= rangeEnd)) return;
            const cat = String(tx.budget_category || '').trim();
            if (!cat) return;
            const amount = txAmountSar(tx);
            spending.set(cat, (spending.get(cat) || 0) + amount);
        });

        const ownScopedBudgets = (data?.budgets ?? [])
            .filter(b => b.year === currentYear)
            .filter(b => budgetView === 'Yearly' || b.month === currentMonth || (b.period === 'yearly' && b.year === currentYear))
            .filter(b => isAdmin || permittedCategories.includes(b.category));

        const syntheticRestrictedBudgets: Budget[] = !isAdmin
            ? permittedCategories
                .filter((cat) => !ownScopedBudgets.some((b) => b.category === cat))
                .map((cat) => {
                    const meta = governanceCategories.find((g) => g.name === cat);
                    const fallbackLimit = Number(meta?.monthly_limit) || 0;
                    return {
                        id: `synthetic-${cat}-${currentYear}-${currentMonth}`,
                        user_id: auth?.user?.id,
                        category: cat,
                        limit: fallbackLimit,
                        month: currentMonth,
                        year: currentYear,
                        period: 'monthly',
                        tier: 'Optional' as const,
                    } as Budget;
                })
            : [];

        // Approved (Finalized) NewCategory requests: show as budget cards so they display like normal budgets
        const finalizedNewCategory = (data?.budgetRequests ?? []).filter(
            (r: any) => r.status === 'Finalized' && (r.requestType ?? r.request_type) === 'NewCategory'
        );
        const approvedRequestBudgets: Budget[] = finalizedNewCategory
            .filter((r: any) => {
                const cat = (r.category_name ?? r.categoryName ?? '').trim();
                return cat && !ownScopedBudgets.some((b) => b.category === cat);
            })
            .map((r: any) => ({
                id: `approved-request-${r.id}`,
                user_id: auth?.user?.id,
                category: (r.category_name ?? r.categoryName ?? '').trim(),
                limit: Number(r.amount ?? 0) || 0,
                month: currentMonth,
                year: currentYear,
                period: 'monthly' as const,
                tier: (r.tier ?? 'Core') as 'Core' | 'Supporting' | 'Optional',
            })) as Budget[];

        const scopedBudgets = [...ownScopedBudgets, ...syntheticRestrictedBudgets, ...approvedRequestBudgets];

        if (budgetView === 'Yearly') {
            const yearlyLimitByCategory = new Map<string, number>();
            const toYearly = (b: Budget) => b.period === 'yearly' ? b.limit : b.period === 'weekly' ? b.limit * 52 : b.period === 'daily' ? b.limit * 365 : b.limit * 12;
            scopedBudgets.forEach((b) => yearlyLimitByCategory.set(b.category, (yearlyLimitByCategory.get(b.category) || 0) + toYearly(b)));

            return Array.from(yearlyLimitByCategory.entries())
                .map(([category, yearlyLimit]) => {
                    const spent = spending.get(category) || 0;
                    const percentage = yearlyLimit > 0 ? (spent / yearlyLimit) * 100 : 0;
                    let colorClass = 'bg-primary';
                    if (percentage > 100) colorClass = 'bg-danger';
                    else if (percentage > 90) colorClass = 'bg-warning';
                    return {
                        id: `${category}-${currentYear}`,
                        category,
                        month: currentMonth,
                        year: currentYear,
                        spent,
                        limit: yearlyLimit,
                        displayLimit: yearlyLimit,
                        monthlyLimit: yearlyLimit / 12,
                        percentage,
                        colorClass,
                    };
                })
                .sort((a, b) => b.spent - a.spent);
        }

        return scopedBudgets.map((budget) => {
                const monthlyEquivalent = budget.period === 'yearly' ? budget.limit / 12 : budget.period === 'weekly' ? budget.limit * (52 / 12) : budget.period === 'daily' ? budget.limit * (365 / 12) : budget.limit;
                const spent = spending.get(budget.category) || 0;
                const percentage = monthlyEquivalent > 0 ? (spent / monthlyEquivalent) * 100 : 0;
                const utilizationLabel: 'Healthy' | 'Watch' | 'Critical' = percentage > 100 ? 'Critical' : percentage > 90 ? 'Watch' : 'Healthy';
                let colorClass = 'bg-primary';
                if (percentage > 100) colorClass = 'bg-danger';
                else if (percentage > 90) colorClass = 'bg-warning';
                return { ...budget, spent, displayLimit: budget.limit, monthlyLimit: monthlyEquivalent, percentage, colorClass, previousPeriodSpent: 0, trendDelta: 0, trendDirection: 'flat' as const, budgetTier: (budget.tier ?? 'Optional') as BudgetTier, utilizationLabel };
            }).sort((a,b) => b.spent - a.spent);
    }, [data?.transactions, (data as any)?.personalTransactions, data?.budgets, data?.budgetRequests, currentYear, currentMonth, isAdmin, permittedCategories, budgetView, ownerSharedTransactions, governanceCategories, auth?.user?.id, sarPerUsd, accountCurrencyById]);

    // Admin Approved Budgets Overview: data for the selected month/year (for filters and period display)
    const adminApprovedOverviewRaw = useMemo<BudgetRow[]>(() => {
        const mo = approvedOverviewMonth;
        const yr = approvedOverviewYear;
        const rangeStart = new Date(yr, mo - 1, 1);
        const rangeEnd = new Date(yr, mo, 0, 23, 59, 59, 999);
        const spending = new Map<string, number>();
        ((data as any)?.personalTransactions ?? data?.transactions ?? []).forEach((tx: { date: string; amount?: number; budgetCategory?: string; type?: string; category?: string }) => {
            if (!countsAsExpenseForCashflowKpi(tx)) return;
            const d = new Date(tx.date);
            if (!(d >= rangeStart && d <= rangeEnd)) return;
            const cat = String((tx as { budget_category?: string }).budget_category || tx.budgetCategory || '').trim();
            if (!cat) return;
            spending.set(cat, (spending.get(cat) || 0) + txAmountSar(tx));
        });
        ownerSharedTransactions
            .filter((tx) => (tx.status ?? 'Approved') === 'Approved')
            .forEach((tx) => {
                const d = new Date(tx.transaction_date || (tx as any).date);
                if (!(d >= rangeStart && d <= rangeEnd)) return;
                const cat = String(tx.budget_category || '').trim();
                if (!cat) return;
                spending.set(cat, (spending.get(cat) || 0) + txAmountSar(tx));
            });
        const budgetsForMonth = (data?.budgets ?? []).filter(
            (b) => b.month === mo && b.year === yr || (b.period === 'yearly' && b.year === yr)
        );
        const rows: BudgetRow[] = budgetsForMonth.map((budget) => {
            const monthlyEquivalent = budget.period === 'yearly' ? budget.limit / 12 : budget.period === 'weekly' ? budget.limit * (52 / 12) : budget.period === 'daily' ? budget.limit * (365 / 12) : budget.limit;
            const spent = spending.get(budget.category) || 0;
            const percentage = monthlyEquivalent > 0 ? (spent / monthlyEquivalent) * 100 : 0;
            const utilizationLabel: 'Healthy' | 'Watch' | 'Critical' = percentage > 100 ? 'Critical' : percentage > 90 ? 'Watch' : 'Healthy';
            let colorClass = 'bg-primary';
            if (percentage > 100) colorClass = 'bg-danger';
            else if (percentage > 90) colorClass = 'bg-warning';
            return { ...budget, spent, displayLimit: budget.limit, monthlyLimit: monthlyEquivalent, percentage, colorClass, previousPeriodSpent: 0, trendDelta: 0, trendDirection: 'flat' as const, budgetTier: (budget.tier ?? 'Optional') as BudgetTier, utilizationLabel };
        });
        return rows.sort((a, b) => b.spent - a.spent);
    }, [data?.budgets, data?.transactions, (data as any)?.personalTransactions, approvedOverviewMonth, approvedOverviewYear, ownerSharedTransactions, sarPerUsd, accountCurrencyById]);

    const adminApprovedOverviewFiltered = useMemo(() => {
        let list = adminApprovedOverviewRaw;
        if (approvedOverviewPeriodFilter !== 'all') {
            list = list.filter((b) => (b.period ?? 'monthly') === approvedOverviewPeriodFilter);
        }
        if (approvedOverviewTierFilter !== 'all') {
            list = list.filter((b) => (b.budgetTier ?? 'Optional') === approvedOverviewTierFilter);
        }
        if (approvedOverviewSearch.trim()) {
            const q = approvedOverviewSearch.trim().toLowerCase();
            list = list.filter((b) => b.category.toLowerCase().includes(q));
        }
        return list;
    }, [adminApprovedOverviewRaw, approvedOverviewPeriodFilter, approvedOverviewTierFilter, approvedOverviewSearch]);

    // Household engine: merged suggested categories (template + engine projection). Template uses family size (adults, kids) and profile for amounts; when engine has run for target month, engine bucket values override for accuracy.
    const bulkAddSuggestedCategories = useMemo(() => {
        const salary = Number(bulkAddSalary);
        const fallback = (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0)
            ? expectedMonthlySalary
            : (suggestedMonthlySalary && suggestedMonthlySalary > 0 ? suggestedMonthlySalary : 0);
        const s = Number.isFinite(salary) && salary > 0 ? salary : fallback;
        if (!s || s <= 0) return [];
        const templateList = generateHouseholdBudgetCategories(householdAdults, householdKids, s, engineProfile);
        const monthPlan = householdBudgetEngine.months?.find((m) => m.month === bulkAddTargetMonth);
        const buckets = monthPlan?.buckets ?? {};
        if (Object.keys(buckets).length === 0) return templateList;
        return templateList.map((cat) => {
            const contributingBuckets = Object.entries(ENGINE_BUCKET_TO_CATEGORY).filter(([, v]) => v === cat.category);
            let engineTotal = 0;
            for (const [key] of contributingBuckets) {
                const val = buckets[key];
                const mult = ENGINE_BUCKET_TO_STORED_MULTIPLIER[key] ?? 1;
                if (typeof val === 'number' && val > 0) engineTotal += val * mult;
            }
            let limit = engineTotal > 0 ? Math.round(engineTotal) : cat.limit;
            // Guardrail: for Groceries, do not let engine override exceed the conservative template limit.
            if (cat.category === 'Groceries & Supermarket' && limit > cat.limit) {
                limit = cat.limit;
            }
            return { ...cat, limit };
        });
    }, [bulkAddSalary, expectedMonthlySalary, suggestedMonthlySalary, householdAdults, householdKids, engineProfile, householdBudgetEngine.months, bulkAddTargetMonth]);

    // Limits auto-update based on profile, salary, and number of categories selected (envelope reallocation)
    const bulkAddDisplayCategories = useMemo(() => {
        const salary = Number(bulkAddSalary);
        const fallback = (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0)
            ? expectedMonthlySalary
            : (suggestedMonthlySalary && suggestedMonthlySalary > 0 ? suggestedMonthlySalary : 0);
        const monthlySalary = Number.isFinite(salary) && salary > 0 ? salary : fallback;
        if (!monthlySalary || monthlySalary <= 0 || bulkAddSuggestedCategories.length === 0) return bulkAddSuggestedCategories;
        return computeBulkAddLimitsForSelection(
            bulkAddSuggestedCategories,
            bulkAddSelectedCategories,
            monthlySalary,
            engineProfile,
            householdAdults,
            householdKids
        );
    }, [bulkAddSuggestedCategories, bulkAddSelectedCategories, bulkAddSalary, expectedMonthlySalary, suggestedMonthlySalary, engineProfile, householdAdults, householdKids]);

    const bulkAddScaledCategories = useMemo(() => {
        const p = Number(bulkLimitScalePercent);
        const factor = Number.isFinite(p) ? Math.max(0.25, Math.min(2, p / 100)) : 1;
        return bulkAddDisplayCategories.map((c) => ({
            ...c,
            limit: Math.max(0, Math.round(Number(c.limit) * factor)),
        }));
    }, [bulkAddDisplayCategories, bulkLimitScalePercent]);

    const bulkAddDisplayCategorySet = useMemo(
        () => new Set(bulkAddScaledCategories.map((c) => c.category)),
        [bulkAddScaledCategories]
    );
    const bulkAddSelectedCategoriesNormalized = useMemo(
        () => Array.from(new Set(bulkAddSelectedCategories)).filter((n) => bulkAddDisplayCategorySet.has(n)),
        [bulkAddSelectedCategories, bulkAddDisplayCategorySet]
    );
    const bulkAddSelectedMonthlyEquivalent = useMemo(() => {
        if (bulkAddSelectedCategoriesNormalized.length === 0) return 0;
        const selectedSet = new Set(bulkAddSelectedCategoriesNormalized);
        return Math.round(
            bulkAddScaledCategories.reduce((sum, c) => {
                if (!selectedSet.has(c.category)) return sum;
                return sum + monthlyEquivalentFromBudgetLimit(c.limit, c.period as 'monthly' | 'weekly' | 'yearly' | 'daily');
            }, 0)
        );
    }, [bulkAddScaledCategories, bulkAddSelectedCategoriesNormalized]);

    // Keep checkbox selection stable when only limits change; add new template rows as selected; drop removed rows.
    // (Old logic reset to “all selected” whenever length differed — that wiped unchecks on adults/kids/profile/salary/month changes.)
    React.useEffect(() => {
        const names = bulkAddSuggestedCategories.map((c) => c.category);
        if (names.length === 0) {
            bulkAddPrevSuggestionNamesRef.current = [];
            setBulkAddSelectedCategories([]);
            return;
        }

        const prevNames = bulkAddPrevSuggestionNamesRef.current;
        const prevSet = new Set(prevNames);
        const currSet = new Set(names);

        const sameCategorySet =
            prevNames.length > 0 &&
            prevNames.length === names.length &&
            names.every((n) => prevSet.has(n));

        if (prevNames.length === 0) {
            setBulkAddSelectedCategories(names);
            bulkAddPrevSuggestionNamesRef.current = names;
            return;
        }

        if (sameCategorySet) {
            setBulkAddSelectedCategories((sel) => {
                const selSet = new Set(sel);
                return names.filter((n) => selSet.has(n));
            });
            bulkAddPrevSuggestionNamesRef.current = names;
            return;
        }

        const added = names.filter((n) => !prevSet.has(n));
        setBulkAddSelectedCategories((sel) => {
            const kept = sel.filter((n) => currSet.has(n));
            const keptSet = new Set(kept);
            const withNew = [...kept];
            for (const n of added) {
                if (!keptSet.has(n)) {
                    withNew.push(n);
                    keptSet.add(n);
                }
            }
            return names.filter((n) => keptSet.has(n));
        });
        bulkAddPrevSuggestionNamesRef.current = names;
    }, [bulkAddSuggestedCategories]);

    React.useEffect(() => {
        setCardOrder((prev) => {
            const ids = budgetData.map((b) => b.id);
            const retained = prev.filter((id) => ids.includes(id));
            const appended = ids.filter((id) => !retained.includes(id));
            return [...retained, ...appended];
        });
    }, [budgetData]);

    const orderedBudgetData = useMemo(() => {
        const map = new Map(budgetData.map((b) => [b.id, b]));
        return cardOrder.map((id) => map.get(id)).filter((b): b is BudgetRow => !!b);
    }, [budgetData, cardOrder]);

    const sharedBudgetCards = useMemo<BudgetRow[]>(() => {
        const spendingByOwnerCategory = new Map<string, number>();
        const now = new Date();
        const rangeStart = new Date(now);
        const rangeEnd = new Date(now);

        if (budgetView === 'Monthly') {
            rangeStart.setFullYear(currentYear, currentMonth - 1, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, currentMonth, 0);
            rangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Weekly') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            rangeStart.setDate(now.getDate() - diffToMonday);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setDate(rangeStart.getDate() + 6);
            rangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Daily') {
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setHours(23, 59, 59, 999);
        } else {
            rangeStart.setFullYear(currentYear, 0, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, 11, 31);
            rangeEnd.setHours(23, 59, 59, 999);
        }

        mySharedBudgetTransactions
            .filter((tx) => (tx.status ?? 'Approved') === 'Approved')
            .forEach((tx) => {
                const d = new Date(tx.transaction_date || tx.date);
                if (!(d >= rangeStart && d <= rangeEnd)) return;
                const category = String(tx.budget_category || '').trim();
                if (!category) return;
                const amount = txAmountSar(tx);
                const ownerKey = String(tx.owner_user_id || tx.owner_id || tx.user_id || 'owner');
                spendingByOwnerCategory.set(`${ownerKey}::${category}`, (spendingByOwnerCategory.get(`${ownerKey}::${category}`) || 0) + amount);
            });

        ownerSharedTransactions
            .filter((tx) => (tx.status ?? 'Approved') === 'Approved')
            .forEach((tx) => {
                const d = new Date(tx.transaction_date || tx.date);
                if (!(d >= rangeStart && d <= rangeEnd)) return;
                const category = String(tx.budget_category || '').trim();
                if (!category) return;
                const amount = txAmountSar(tx);
                const ownerKey = String(tx.owner_user_id || tx.owner_id || tx.user_id || auth?.user?.id || 'owner');
                spendingByOwnerCategory.set(`${ownerKey}::${category}`, (spendingByOwnerCategory.get(`${ownerKey}::${category}`) || 0) + amount);
            });

        const rowsForYear = (sharedBudgets ?? [])
            .filter((b) => (Number((b as any).year) || currentYear) === currentYear);

        const toYearly = (b: Budget) => b.period === 'yearly' ? b.limit : b.period === 'weekly' ? b.limit * 52 : b.period === 'daily' ? b.limit * 365 : b.limit * 12;

        if (budgetView === 'Yearly') {
            const yearlyByOwnerCategory = new Map<string, Budget & { ownerEmail?: string; ownerKey: string; yearlyLimit: number }>();
            rowsForYear.forEach((b) => {
                const ownerKey = String((b as any).owner_user_id || b.user_id || b.ownerEmail || 'owner');
                const key = `${ownerKey}::${b.category}`;
                const existing = yearlyByOwnerCategory.get(key);
                const yearlyLimit = (existing?.yearlyLimit || 0) + toYearly(b);
                yearlyByOwnerCategory.set(key, {
                    ...(existing || b),
                    category: b.category,
                    ownerEmail: (b as any).ownerEmail || existing?.ownerEmail,
                    ownerKey,
                    yearlyLimit,
                });
            });

            return Array.from(yearlyByOwnerCategory.values())
                .map((entry) => {
                    const ownerCategoryKey = `${entry.ownerKey}::${entry.category}`;
                    const spent = sharedConsumedByOwnerCategory.get(ownerCategoryKey) || spendingByOwnerCategory.get(ownerCategoryKey) || 0;
                    const percentage = entry.yearlyLimit > 0 ? (spent / entry.yearlyLimit) * 100 : 0;
                    const utilizationLabel: 'Healthy' | 'Watch' | 'Critical' = percentage > 100 ? 'Critical' : percentage > 90 ? 'Watch' : 'Healthy';
                    let colorClass = 'bg-primary';
                    if (percentage > 100) colorClass = 'bg-danger';
                    else if (percentage > 90) colorClass = 'bg-warning';
                    return {
                        ...entry,
                        id: `shared-${entry.ownerKey}-${entry.category}-${currentYear}`,
                        month: currentMonth,
                        year: currentYear,
                        limit: entry.yearlyLimit,
                        displayLimit: entry.yearlyLimit,
                        monthlyLimit: entry.yearlyLimit / 12,
                        spent,
                        percentage,
                        colorClass,
                        previousPeriodSpent: 0,
                        trendDelta: 0,
                        trendDirection: 'flat' as const,
                        budgetTier: (entry.tier ?? 'Optional') as BudgetTier,
                        utilizationLabel,
                    };
                })
                .sort((a, b) => b.spent - a.spent);
        }

        return rowsForYear
            .filter((b) => {
                const month = Number((b as any).month) || currentMonth;
                const year = Number((b as any).year) || currentYear;
                return month === currentMonth || (b.period === 'yearly' && year === currentYear);
            })
            .map((b) => {
                const monthlyEquivalent = b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
                const ownerKey = String((b as any).owner_user_id || b.user_id || b.ownerEmail || 'owner');
                const spent = sharedConsumedByOwnerCategory.get(`${ownerKey}::${b.category}`) || spendingByOwnerCategory.get(`${ownerKey}::${b.category}`) || 0;
                const percentage = monthlyEquivalent > 0 ? (spent / monthlyEquivalent) * 100 : 0;
                const utilizationLabel: 'Healthy' | 'Watch' | 'Critical' = percentage > 100 ? 'Critical' : percentage > 90 ? 'Watch' : 'Healthy';
                let colorClass = 'bg-primary';
                if (percentage > 100) colorClass = 'bg-danger';
                else if (percentage > 90) colorClass = 'bg-warning';
                return {
                    ...b,
                    id: `shared-${ownerKey}-${b.id}`,
                    spent,
                    percentage,
                    colorClass,
                    displayLimit: b.limit,
                    monthlyLimit: monthlyEquivalent,
                    previousPeriodSpent: 0,
                    trendDelta: 0,
                    trendDirection: 'flat' as const,
                    budgetTier: (b.tier ?? 'Optional') as BudgetTier,
                    utilizationLabel,
                };
            })
            .sort((a, b) => b.spent - a.spent);
    }, [sharedBudgets, mySharedBudgetTransactions, ownerSharedTransactions, sharedConsumedByOwnerCategory, budgetView, currentYear, currentMonth, auth?.user?.id, sarPerUsd, accountCurrencyById]);

    const sharedBudgetOwnerByCardId = useMemo(() => {
        return new Map(
            sharedBudgetCards.map((b) => [
                b.id,
                (b as Budget & { ownerEmail?: string }).ownerEmail || b.user_id || 'Owner',
            ]),
        );
    }, [sharedBudgetCards]);

    const availableIncreaseCategories = useMemo(() => {
        const ownCategories = budgetData.map((b) => ({ value: `OWN::${b.category}`, label: b.category, category: b.category, source: 'own' as const }));
        const sharedCategories = sharedBudgetCards.map((b) => ({
            value: `SHARED::${(b as any).owner_user_id || b.user_id || (b as any).ownerEmail || 'owner'}::${b.category}`,
            label: `${b.category} (shared from ${sharedBudgetOwnerByCardId.get(b.id) || 'Owner'})`,
            category: b.category,
            source: 'shared' as const,
        }));
        const merged = [...ownCategories, ...sharedCategories];
        const dedup = new Map<string, typeof merged[number]>();
        merged.forEach((item) => dedup.set(item.value, item));
        return Array.from(dedup.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [budgetData, sharedBudgetCards, sharedBudgetOwnerByCardId]);

    const toggleBudgetCardSize = (id: string) => setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));

    const budgetInsights = useMemo(() => {
        const totalLimit = budgetData.reduce((sum, b) => sum + b.monthlyLimit, 0);
        const totalSpent = budgetData.reduce((sum, b) => sum + b.spent, 0);
        /** Money saved from budget = sum of (limit - spent) for categories where we're under. Same as max(0, totalLimit - totalSpent) when no category is over. */
        const totalSavedFromBudget = Math.max(0, totalLimit - totalSpent);
        const healthyCount = budgetData.filter((b) => b.utilizationLabel === 'Healthy').length;
        const watchCount = budgetData.filter((b) => b.utilizationLabel === 'Watch').length;
        const criticalCount = budgetData.filter((b) => b.utilizationLabel === 'Critical').length;
        const topChange = [...budgetData].sort((a, b) => Math.abs(b.trendDelta ?? 0) - Math.abs(a.trendDelta ?? 0))[0];

        return { totalLimit, totalSpent, totalSavedFromBudget, healthyCount, watchCount, criticalCount, topChange };
    }, [budgetData]);

    const budgetValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        if (!Number.isFinite(budgetInsights.totalLimit) || !Number.isFinite(budgetInsights.totalSpent)) {
            warnings.push('Budget totals contain invalid values.');
        }
        if (budgetData.length > 0 && budgetData.every((b) => (b.monthlyLimit ?? 0) <= 0)) {
            warnings.push('All visible budgets have zero limits.');
        }
        const uncategorizedExpenses = ((data as any)?.personalTransactions ?? data?.transactions ?? [])
            .filter((t: any) => countsAsExpenseForCashflowKpi(t) && (t.status ?? 'Approved') === 'Approved' && !String(t.budgetCategory ?? '').trim()).length;
        if (uncategorizedExpenses > 0) {
            warnings.push(`${uncategorizedExpenses} approved expense transaction(s) are not mapped to budget categories.`);
        }
        if (isAdmin && budgetRequests.some((r) => r.status === 'Pending') && budgetData.length === 0) {
            warnings.push('Pending requests exist while no budget cards are visible for this filter/month.');
        }
        const [fy, fm] = String(sharedTxMonthFilter || '').split('-').map(Number);
        if (!(Number.isFinite(fy) && Number.isFinite(fm) && fm >= 1 && fm <= 12)) {
            warnings.push('Shared transaction month filter is invalid; defaulting to all months.');
        }
        return warnings;
    }, [budgetInsights, budgetData, data?.transactions, (data as any)?.personalTransactions, budgetRequests, isAdmin, sharedTxMonthFilter]);

    const updateMonthlyOverride = (month: number, patch: Partial<HouseholdMonthlyOverride>) => {
        setHouseholdOverrides((prev) => {
            const existing = prev.find((o) => o.month === month) || { month };
            const next = { ...existing, ...patch };
            const merged = [...prev.filter((o) => o.month !== month), next].sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
            return merged;
        });
    };

    const criticalValidationCount = useMemo(() => householdBudgetEngine.months.reduce((sum, m) => sum + ((m.validationErrors?.length || 0) > 0 ? 1 : 0), 0), [householdBudgetEngine]);

    const handleOpenModal = (budget: Budget | null = null) => {
        if (!isAdmin) return;
        setBudgetToEdit(budget);
        setIsModalOpen(true);
    };

    const handleSaveBudget = (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => {
        if (isEditing && budgetToEdit) {
            updateBudget({ ...budgetToEdit, ...budget });
        } else {
            addBudget(budget);
        }
    };

    const handleShareBudget = async () => {
        if (!supabase || !auth?.user) return;
        if (!isAdmin) {
            alert('Only Admin can share budgets.');
            return;
        }
        const email = shareTargetEmail.trim().toLowerCase();
        if (!email) {
            alert('Enter recipient email first.');
            return;
        }
        const { data: targetUser, error: userError } = await resolveRecipientUserByEmail(email);
        if (userError || !targetUser?.id) {
            const detail = (userError?.message || '').trim();
            const helperHint = detail.includes('find_user_by_email')
                ? ' Run docs/budget_sharing_ready.sql to install helper function.'
                : '';
            const alreadyPrefixed = /^Recipient user not found\.?/i.test(detail);
            const message = alreadyPrefixed
                ? `${detail}${helperHint}`.trim()
                : `Recipient user not found.${detail ? ` ${detail}` : ''}${helperHint}`.trim();
            alert(message);
            return;
        }
        const payload = {
            owner_user_id: auth.user.id,
            shared_with_user_id: targetUser.id,
            category: shareCategory === 'ALL' ? null : shareCategory,
        };
        const { error } = await supabase.from('budget_shares').upsert(payload).then((r) => r, () => ({ error: { message: 'budget_shares table is missing. Run the SQL migration first.' } } as any));
        if (error) {
            alert(`Could not share budget: ${error.message}`);
            return;
        }
        alert(`Budget access shared with ${targetUser.email}${shareCategory === 'ALL' ? ' (all categories)' : ` for ${shareCategory}`}.`);
        setShareTargetEmail('');
    };
    
    const changeMonth = (offset: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    }


    const normalizeToMonthly = (amount: number, period: 'Monthly' | 'Weekly' | 'Daily' | 'Yearly') => {
        if (period === 'Weekly') return amount * (52 / 12);
        if (period === 'Daily') return amount * (365 / 12);
        if (period === 'Yearly') return amount / 12;
        return amount;
    };

    const handleCopyBudgets = () => {
        if (!isAdmin) return;

        if (window.confirm("This will copy budgets from the previous month for any categories that don't already have one this month. Continue?")) {
            copyBudgetsFromPreviousMonth(currentYear, currentMonth);
        }
    };

    const handleSmartFillBudgets = () => {
        if (!isAdmin) return;
        const allTx = ((data as any)?.personalTransactions ?? data?.transactions ?? []).filter((t: { type?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && !!t.budgetCategory);
        if (allTx.length === 0) {
            alert('No expense history with budget categories found to smart-fill from.');
            return;
        }
        const now = new Date(currentYear, currentMonth - 1, 1);
        const threeMonthsAgo = new Date(now);
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const byCategory = new Map<string, { total: number; months: Set<string> }>();
        allTx.forEach((t: { date: string; budgetCategory?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d < threeMonthsAgo || d > now) return;
            const cat = t.budgetCategory!;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const entry = byCategory.get(cat) || { total: 0, months: new Set<string>() };
            entry.total += Math.abs(t.amount ?? 0);
            entry.months.add(key);
            byCategory.set(cat, entry);
        });

        const suggestions: { category: string; monthly: number }[] = [];
        byCategory.forEach((v, category) => {
            const monthCount = v.months.size || 1;
            const avg = v.total / monthCount;
            if (avg > 0) {
                suggestions.push({ category, monthly: Math.round(avg) });
            }
        });

        if (suggestions.length === 0) {
            alert('Not enough recent history to suggest budgets.');
            return;
        }

        const existingForMonth = new Set(
            (data?.budgets ?? [])
                .filter((b) => b.year === currentYear && b.month === currentMonth)
                .map((b) => b.category)
        );

        const toCreate = suggestions.filter((s) => !existingForMonth.has(s.category));
        if (toCreate.length === 0) {
            alert('All categories already have budgets this month. Nothing to smart-fill.');
            return;
        }

        if (
            !window.confirm(
                `Smart-fill will create ${toCreate.length} budgets for this month using the last ~3 months of spending averages. Continue?`
            )
        ) {
            return;
        }

        const CORE_CATEGORIES = ['Housing', 'Rent', 'Food', 'Transportation', 'Utilities', 'Health', 'Education'];

        toCreate.forEach((s) => {
            const tier: BudgetTier =
                CORE_CATEGORIES.some((name) => s.category.toLowerCase().includes(name.toLowerCase())) ? 'Core' : 'Optional';
            addBudget({
                category: s.category,
                limit: s.monthly,
                month: currentMonth,
                year: currentYear,
                period: 'monthly',
                tier,
            } as any);
        });
    };

    const handleSuggestBudgetAdjustments = async () => {
        if (!isAdmin) return;
        const txs = getPersonalTransactions(data) as import('../types').Transaction[];
        const budgets = (data?.budgets ?? []) as Budget[];
        const adjusted = await learnAndAutoAdjust(txs, budgets, currentMonth, currentYear);
        const currentForMonth = budgets.filter(b => b.month === currentMonth && b.year === currentYear);
        const proposals: Array<{ orig: Budget; proposed: Budget }> = [];
        currentForMonth.forEach(orig => {
            const prop = adjusted.find(b => b.id === orig.id || (b.category === orig.category && b.month === orig.month && b.year === orig.year));
            if (prop && prop.limit !== orig.limit) {
                proposals.push({ orig, proposed: prop });
            }
        });
        if (proposals.length === 0) {
            alert('No budget adjustments suggested. Need at least 2 months of spending data per category.');
            return;
        }
        setSuggestedAdjustments(proposals);
    };

    const applySuggestedAdjustments = () => {
        if (!suggestedAdjustments) return;
        trackSuggestionFeedback('budget-suggested-adjustments', 'Budgets', true);
        suggestedAdjustments.forEach(({ proposed }) => updateBudget(proposed));
        setSuggestedAdjustments(null);
    };

    const submitBudgetRequest = async () => {
        if (!supabase || !auth?.user) return;

        const enteredAmount = Number(requestAmount || 0);
        if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) {
            alert('Please enter a valid proposed amount greater than 0.');
            return;
        }

        if (requestType === 'NewCategory' && !newCategoryName.trim()) {
            alert('Please provide a category name for a new category request.');
            return;
        }

        if ((requestType === 'IncreaseLimit' || requestType === 'AdvanceFromNextMonth') && !requestCategoryId) {
            alert(requestType === 'AdvanceFromNextMonth' ? 'Please select a category to borrow from next month.' : 'Please select a category for an increase request.');
            return;
        }

        const selectedCategoryName =
            (requestType === 'IncreaseLimit' || requestType === 'AdvanceFromNextMonth') && requestCategoryId
                ? (availableIncreaseCategories.find((opt) => opt.value === requestCategoryId)?.category ??
                   (requestCategoryId.startsWith('OWN::') ? requestCategoryId.replace('OWN::', '') : ''))
                : '';

        const duplicateMatch = budgetRequests.some((r) => {
            const storedMode = requestMode(r);
            const wantedMode = requestType === 'AdvanceFromNextMonth' ? 'AdvanceFromNextMonth' : 'Standard';
            if (r.status !== 'Pending') return false;
            if (requestType === 'NewCategory' && r.request_type !== 'NewCategory') return false;
            if (requestType !== 'NewCategory' && r.request_type !== 'IncreaseLimit') return false;
            if (storedMode !== wantedMode) return false;
            if (requestType === 'NewCategory') {
                return String(r.category_name || '').trim().toLowerCase() === newCategoryName.trim().toLowerCase();
            }
            // IncreaseLimit / Advance: match by category_id when present, otherwise by category_name for shared-category requests
            if (requestCategoryId && !requestCategoryId.startsWith('SHARED::')) {
                const normalizedCategoryId = requestCategoryId.replace('OWN::', '');
                return r.category_id === normalizedCategoryId;
            }
            if (!selectedCategoryName) return false;
            return !r.category_id &&
                String(r.category_name || '').trim().toLowerCase() === selectedCategoryName.trim().toLowerCase();
        });

        if (duplicateMatch) {
            alert('A similar pending request already exists. Please wait for admin review.');
            return;
        }

        const monthlyAmount = normalizeToMonthly(enteredAmount, requestAmountPeriod);

        const periodTag = requestAmountPeriod === 'Monthly' ? '' : `[Requested period: ${requestAmountPeriod}; Raw: ${enteredAmount}]`;
        const modeTag = requestType === 'AdvanceFromNextMonth' ? '[Request mode: AdvanceFromNextMonth]' : '';
        const advanceWindowTag = (() => {
            if (requestType !== 'AdvanceFromNextMonth') return '';
            const from = addMonths(currentMonth, currentYear, 1);
            return `[AdvanceFromNextMonth: from=${from.year}-${String(from.month).padStart(2, '0')}; to=${currentYear}-${String(currentMonth).padStart(2, '0')}]`;
        })();
        const mergedNote = [modeTag, advanceWindowTag, periodTag, requestNote.trim()].filter(Boolean).join(' ').trim() || null;

        const isSharedSelection = (requestType === 'IncreaseLimit' || requestType === 'AdvanceFromNextMonth') && requestCategoryId.startsWith('SHARED::');
        const requestTypeForStorage: 'NewCategory' | 'IncreaseLimit' = requestType === 'NewCategory' ? 'NewCategory' : 'IncreaseLimit';

        const payloadBase = {
            user_id: auth.user.id,
            request_type: requestTypeForStorage,
            category_id: requestType !== 'NewCategory' && !isSharedSelection ? (requestCategoryId.replace('OWN::', '') || null) : null,
            category_name: requestType === 'NewCategory'
                ? newCategoryName.trim()
                : (isSharedSelection ? selectedCategoryName || null : null),
            amount: monthlyAmount,
            status: 'Pending'
        };

        const payloadVariants = [
            { ...payloadBase, note: mergedNote },
            { ...payloadBase, request_note: mergedNote },
            payloadBase,
        ];

        let createdRequest: any = null;
        let error: any = null;
        for (const payload of payloadVariants) {
            const result = await supabase.from('budget_requests').insert(payload).select().single();
            createdRequest = result.data;
            error = result.error;
            if (!error) break;
            const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
            const isMissingColumn = error?.code === '42703' || error?.code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache');
            if (!isMissingColumn) break;
        }

        if (error) {
            alert(`Failed to submit request: ${error.message}`);
            return;
        }
        setNewCategoryName('');
        setRequestAmount('');
        setRequestCategoryId('');
        setRequestNote('');
        if (createdRequest) setBudgetRequests(prev => [createdRequest, ...prev]);
        alert('Request submitted for admin approval.');
    };

    const finalizeBudgetRequest = async (request: any, approvedAmount?: number) => {
        if (!supabase) return;
        const amount = Number(approvedAmount ?? request.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Request amount is invalid; please reject or correct the request.');
            return;
        }
        const mode = requestMode(request);

        const categoryLabel = resolveRequestCategory(request);
        const requestLabel = mode === 'AdvanceFromNextMonth' ? 'Advance from next month' : request.request_type;
        if (!window.confirm(`Finalize ${requestLabel} for ${categoryLabel} with ${formatCurrencyString(amount, { digits: 0 })}?`)) {
            return;
        }

        if (request.request_type === 'NewCategory') {
            const { data: createdCategory, error: insertError } = await supabase
                .from('categories')
                .insert({ name: request.category_name, monthly_limit: amount, total_spent: 0 })
                .select()
                .single();
            if (insertError || !createdCategory) {
                alert(`Failed to create category: ${insertError?.message || 'Unknown error'}`);
                return;
            }

            // Grant requester permission so they see this category in their Budgets page and request forms
            try {
                await supabase
                    .from('permissions')
                    .insert({ user_id: request.user_id, category_id: createdCategory.id })
                    .then(
                        (r) => r,
                        () => ({ error: null } as any)
                    );
            } catch {
                // Non-critical; ignore RLS / unique violations
            }

            // Auto-create a starting budget row for admin (approver) and requester so category appears in Budgets cards
            const adminId = auth?.user?.id;
            const baseBudgetRow = {
                category: request.category_name,
                limit: amount,
                month: currentMonth,
                year: currentYear,
                period: 'monthly' as const,
                tier: (request as any).tier ?? 'Core',
            };
            const budgetInserts: any[] = [];
            if (adminId) {
                budgetInserts.push({ ...baseBudgetRow, user_id: adminId });
            }
            budgetInserts.push({ ...baseBudgetRow, user_id: request.user_id });
            try {
                await supabase
                    .from('budgets')
                    .insert(budgetInserts)
                    .then(
                        (r) => r,
                        () => ({ error: null } as any)
                    );
            } catch {
                // Optional; ignore failures (RLS / duplicates)
            }
        }
        let finalizedByAtomicAdvance = false;
        if (mode === 'AdvanceFromNextMonth') {
            const targetCategory = resolveRequestCategory(request);
            const advanceMeta = parseAdvanceMeta(request) ?? (() => {
                const from = addMonths(currentMonth, currentYear, 1);
                return { fromYear: from.year, fromMonth: from.month, toYear: currentYear, toMonth: currentMonth };
            })();

            const { data: requesterBudgets, error: requesterBudgetError } = await supabase
                .from('budgets')
                .select('*')
                .eq('user_id', request.user_id)
                .eq('category', targetCategory);
            if (requesterBudgetError) {
                alert(`Failed to load requester budgets: ${requesterBudgetError.message}`);
                return;
            }
            const rows = (requesterBudgets || []) as any[];
            const src = rows.find((b) => Number(b.year) === advanceMeta.fromYear && Number(b.month) === advanceMeta.fromMonth);
            if (!src) {
                alert(`Next month budget row was not found for ${targetCategory}. Ask user to create next month budget first.`);
                return;
            }
            const srcLimit = Number(src.limit ?? 0);
            if (!Number.isFinite(srcLimit) || srcLimit < amount) {
                alert(`Next month available limit is ${formatCurrencyString(Math.max(0, srcLimit), { digits: 0 })}. Cannot approve ${formatCurrencyString(amount, { digits: 0 })}.`);
                return;
            }
            const rpcRes = await supabase.rpc('finalize_advance_budget_request', {
                p_request_id: request.id,
                p_request_user_id: request.user_id,
                p_category: targetCategory,
                p_amount: amount,
                p_from_year: advanceMeta.fromYear,
                p_from_month: advanceMeta.fromMonth,
                p_to_year: advanceMeta.toYear,
                p_to_month: advanceMeta.toMonth,
            } as any);
            if (rpcRes.error) {
                const msg = String(rpcRes.error.message || '');
                const missingRpc = rpcRes.error.code === 'PGRST202' || (msg.toLowerCase().includes('function') && msg.toLowerCase().includes('does not exist'));
                if (missingRpc) {
                    alert('Atomic budget-advance RPC is not deployed yet. Run migration `supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql` and retry.');
                } else {
                    alert(`Failed to finalize advance request atomically: ${rpcRes.error.message}`);
                }
                return;
            }
            finalizedByAtomicAdvance = true;
        } else if (request.request_type === 'IncreaseLimit') {
            if (request.category_id) {
                const { error: updateError } = await supabase
                    .from('categories')
                    .update({ monthly_limit: amount })
                    .eq('id', request.category_id);
                if (updateError) {
                    alert(`Failed to update category limit: ${updateError.message}`);
                    return;
                }
            }

            const targetCategory = resolveRequestCategory(request);
            const matchingBudgets = (data?.budgets ?? []).filter((b) => b.category === targetCategory && b.year === currentYear && (b.month === currentMonth || b.period === 'yearly'));
            if (matchingBudgets.length > 0) {
                matchingBudgets.forEach((b) => updateBudget({ ...b, limit: amount }));
            } else if (targetCategory && auth?.user?.id) {
                addBudget({
                    category: targetCategory,
                    limit: amount,
                    month: currentMonth,
                    year: currentYear,
                    period: 'monthly',
                    tier: 'Optional',
                });
            }
        }

        if (!finalizedByAtomicAdvance) {
            const { error: requestUpdateError } = await supabase
                .from('budget_requests')
                .update({ status: 'Finalized', amount })
                .eq('id', request.id);
            if (requestUpdateError) {
                alert(`Failed to finalize request: ${requestUpdateError.message}`);
                return;
            }
        }

        setBudgetRequests(prev => prev.map((r) => r.id === request.id ? { ...r, status: 'Finalized', amount } : r));
        
        // Refresh data context to show newly created budgets
        // Note: DataContext automatically refreshes when dataResetKey changes
    };

    const rejectBudgetRequest = async (requestId: string) => {
        if (!supabase) return;
        if (!window.confirm('Reject this budget request?')) return;
        const { error } = await supabase
            .from('budget_requests')
            .update({ status: 'Rejected' })
            .eq('id', requestId);
        if (error) {
            alert(`Failed to reject request: ${error.message}`);
            return;
        }
        setBudgetRequests(prev => prev.map((r) => r.id === requestId ? { ...r, status: 'Rejected' } : r));
    };


    const sortedFilteredRequests = useMemo(() => {
        const normalizedQuery = requestSearch.trim().toLowerCase();
        const filtered = budgetRequests.filter((r) => {
            const matchesStatus = requestStatusFilter === 'All' || r.status === requestStatusFilter;
            if (!matchesStatus) return false;
            
            // Month filter
            if (requestMonthFilter) {
                const [filterYear, filterMonth] = requestMonthFilter.split('-').map(Number);
                const requestDate = new Date(r.created_at || 0);
                const matchesMonth = requestDate.getFullYear() === filterYear && requestDate.getMonth() + 1 === filterMonth;
                if (!matchesMonth) return false;
            }
            
            if (!normalizedQuery) return true;
            const combinedText = `${displayRequestType(r)} ${resolveRequestCategory(r)} ${r.note || ''} ${r.request_note || ''}`.toLowerCase();
            return combinedText.includes(normalizedQuery);
        });

        const sorted = [...filtered].sort((a, b) => {
            if (requestSort === 'Oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            if (requestSort === 'AmountHigh') return Number(b.amount || 0) - Number(a.amount || 0);
            if (requestSort === 'AmountLow') return Number(a.amount || 0) - Number(b.amount || 0);
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });

        return sorted;
    }, [budgetRequests, requestSearch, requestSort, requestStatusFilter, requestMonthFilter, governanceCategories]);

    const pendingRequests = useMemo(() => sortedFilteredRequests.filter((r) => r.status === 'Pending'), [sortedFilteredRequests]);
    const allRespondedRequests = useMemo(() => budgetRequests.filter((r) => r.status !== 'Pending').sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()), [budgetRequests]);
    const visibleHistoryRequests = useMemo(() => allRespondedRequests.slice(0, historyItemsToShow), [allRespondedRequests, historyItemsToShow]);
    const hasMoreHistory = historyItemsToShow < allRespondedRequests.length;

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading budgets" />
            </div>
        );
    }

    return (
        <PageLayout
            title={`Budgets (${budgetView})`}
            description="Set monthly spending limits for categories (groceries, dining, etc.). Get alerts when you're close to the limit."
            action={
                <div className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-end gap-2 sm:gap-3">
                    <div className="inline-flex items-center p-1 rounded-lg border border-slate-200 bg-white">
                        <button type="button" onClick={() => setBudgetSubPage('overview')} className={`px-3 py-1.5 text-xs rounded-md ${budgetSubPage === 'overview' ? 'bg-primary text-white' : 'text-slate-600'}`}>Budget Overview</button>
                        <button type="button" onClick={() => setBudgetSubPage('household')} className={`px-3 py-1.5 text-xs rounded-md ${budgetSubPage === 'household' ? 'bg-primary text-white' : 'text-slate-600'}`}>Household Engine</button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-500">View:</span>
                        <select value={budgetView} onChange={(e) => setBudgetView(e.target.value as 'Monthly' | 'Weekly' | 'Daily' | 'Yearly')} className="select-base w-auto min-w-[120px]">
                            <option value="Monthly">Monthly</option>
                            <option value="Weekly">Weekly</option>
                            <option value="Daily">Daily</option>
                            <option value="Yearly">Yearly</option>
                        </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-slate-200" aria-label="Previous month"><ChevronLeftIcon className="h-5 w-5"/></button>
                        <span className="font-semibold text-sm sm:text-base min-w-[140px] text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                        <button type="button" onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-slate-200" aria-label="Next month"><ChevronRightIcon className="h-5 w-5"/></button>
                    </div>
                    <PageActionsDropdown
                        ariaLabel="Budget actions"
                        actions={[
                            { value: 'suggest-adjustments', label: 'Suggest budget adjustments', disabled: !isAdmin, onClick: handleSuggestBudgetAdjustments },
                            { value: 'smart-fill', label: 'Smart-fill from history', disabled: !isAdmin, onClick: handleSmartFillBudgets },
                            { value: 'copy-month', label: 'Copy last month', disabled: !isAdmin, onClick: handleCopyBudgets },
                            { value: 'add-budget', label: 'Add budget', disabled: !isAdmin, onClick: handleOpenModal },
                        ]}
                    />
                </div>
            }
        >
            <div className={budgetSubPage === 'household' ? 'hidden' : 'space-y-6'}>
            <SectionCard title="Budget requests" collapsible collapsibleSummary="Search & filters" defaultExpanded>
                <div className="flex flex-wrap gap-3 items-center">
                    <input
                        value={requestSearch}
                        onChange={(e) => setRequestSearch(e.target.value)}
                        placeholder="Search requests by type, category, or note..."
                        className="flex-1 min-w-[220px] p-2 border rounded"
                    />
                    <select value={requestStatusFilter} onChange={(e) => setRequestStatusFilter(e.target.value as any)} className="p-2 border rounded">
                        <option value="All">All statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="Finalized">Finalized</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                    <input
                        type="month"
                        value={requestMonthFilter}
                        onChange={(e) => setRequestMonthFilter(e.target.value)}
                        placeholder="Filter by month"
                        className="p-2 border rounded text-sm"
                    />
                    {requestMonthFilter && (
                        <button
                            type="button"
                            onClick={() => setRequestMonthFilter('')}
                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600"
                        >
                            Clear month
                        </button>
                    )}
                    <select value={requestSort} onChange={(e) => setRequestSort(e.target.value as any)} className="p-2 border rounded">
                        <option value="Newest">Newest first</option>
                        <option value="Oldest">Oldest first</option>
                        <option value="AmountHigh">Highest amount</option>
                        <option value="AmountLow">Lowest amount</option>
                    </select>
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs min-w-0">
                    <div className="rounded border p-2 bg-amber-50 min-w-0 overflow-hidden"><span className="metric-label">Pending:</span> <span className="metric-value font-semibold">{budgetRequests.filter((r) => r.status === 'Pending').length}</span></div>
                    <div className="rounded border p-2 bg-green-50 min-w-0 overflow-hidden"><span className="metric-label">Finalized:</span> <span className="metric-value font-semibold">{budgetRequests.filter((r) => r.status === 'Finalized').length}</span></div>
                    <div className="rounded border p-2 bg-rose-50 min-w-0 overflow-hidden"><span className="metric-label">Rejected:</span> <span className="metric-value font-semibold">{budgetRequests.filter((r) => r.status === 'Rejected').length}</span></div>
                    <div className="rounded border p-2 bg-slate-50 min-w-0 overflow-hidden"><span className="metric-label">Shown:</span> <span className="metric-value font-semibold">{sortedFilteredRequests.length}</span></div>
                </div>
            </SectionCard>

            {budgetValidationWarnings.length > 0 && (
                <SectionCard title="Budget validation checks" collapsible collapsibleSummary="Data quality checks" defaultExpanded>
                    <ul className="space-y-1 text-sm text-amber-800">
                        {budgetValidationWarnings.slice(0, 6).map((w, i) => (
                            <li key={`bw-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <SectionCard title="Budget Intelligence" collapsible collapsibleSummary="Portfolio, spend, attention" defaultExpanded>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm min-w-0">
                    <div className="rounded-lg border bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Portfolio Budget</p>
                        <p className="metric-value text-lg font-semibold w-full">{formatCurrencyString(budgetInsights.totalLimit, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border bg-indigo-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Current Spend</p>
                        <p className="metric-value text-lg font-semibold w-full">{formatCurrencyString(budgetInsights.totalSpent, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border bg-amber-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Needs Attention</p>
                        <p className="metric-value text-lg font-semibold w-full">{budgetInsights.watchCount + budgetInsights.criticalCount}</p>
                    </div>
                    <div className="rounded-lg border bg-emerald-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Healthy Budgets</p>
                        <p className="metric-value text-lg font-semibold w-full">{budgetInsights.healthyCount}</p>
                    </div>
                </div>
                {budgetInsights.topChange && (
                    <p className="mt-3 text-xs text-gray-600">
                        Largest movement: <span className="font-semibold">{budgetInsights.topChange.category}</span> ({budgetInsights.topChange.trendDirection === 'up' ? '+' : ''}{formatCurrencyString(budgetInsights.topChange.trendDelta ?? 0, { digits: 0 })} vs previous period).
                    </p>
                )}
            </SectionCard>

            {recurringBillsWithBenchmarks.length > 0 && (
                <SectionCard title="Recurring bills & price benchmarks" collapsible collapsibleSummary="Bills, benchmarks">
                    <ul className="space-y-2 text-sm">
                        {recurringBillsWithBenchmarks.slice(0, 8).map((bill, i) => (
                            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                                <span className="font-medium text-slate-800">{bill.merchant}</span>
                                <span className="text-slate-600">{formatCurrencyString(bill.typicalAmount, { digits: 0 })} · {bill.frequency}</span>
                                {bill.benchmarkComparison && (
                                    <span className="text-xs text-slate-500 w-full mt-0.5">
                                        Market avg: {formatCurrencyString(bill.benchmarkComparison.marketAverage, { digits: 0 })} · {bill.benchmarkComparison.recommendation ?? `You pay ${bill.benchmarkComparison.percentile}th %ile`}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">Categories from EXPENSE_CATEGORIES; benchmarks from hybrid AI/local classification.</p>
                </SectionCard>
            )}

            {householdConstraints?.cashflowStressSignals && householdConstraints.cashflowStressSignals.length > 0 && (
                <SectionCard title="Cashflow signals (household & budget engines)" collapsible collapsibleSummary="Stress alerts">
                    <ul className="space-y-1 text-sm text-amber-900">
                        {householdConstraints.cashflowStressSignals.slice(0, 3).map((s, i) => (
                            <li key={i}>{s.message}{s.recommendedAction ? ` — ${s.recommendedAction}` : ''}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <AIAdvisor
                pageContext="cashflow"
                contextData={{ transactions: (data as any)?.personalTransactions ?? data?.transactions ?? [], budgets: data?.budgets ?? [] }}
                title="Budget AI Advisor"
                subtitle="Budget drift, category pressure, and optimization insights."
                buttonLabel="Get AI Budget Insights"
            />

            {!isAdmin && (() => {
                const selectedCategoryName = (() => {
                    if ((requestType !== 'IncreaseLimit' && requestType !== 'AdvanceFromNextMonth') || !requestCategoryId) return '';
                    const fromOptions = availableIncreaseCategories.find((opt) => opt.value === requestCategoryId);
                    if (fromOptions) return fromOptions.category;
                    return requestCategoryId.startsWith('OWN::') ? requestCategoryId.replace('OWN::', '') : '';
                })();
                const currentBudgetRow = (requestType === 'IncreaseLimit' || requestType === 'AdvanceFromNextMonth') && selectedCategoryName ? budgetData.find(b => b.category === selectedCategoryName) : null;
                const currentLimit = currentBudgetRow?.monthlyLimit ?? 0;
                const currentSpent = currentBudgetRow?.spent ?? 0;
                const nextMonthCtx = addMonths(currentMonth, currentYear, 1);
                return (
                    <div className="bg-gradient-to-br from-white via-primary/5 to-indigo-50 rounded-lg shadow p-5 border border-primary/20">
                        <h2 className="text-lg font-semibold mb-3 flex items-center">Request Budget Change <InfoHint text="Submit requests that always require admin approval: new category, increase limit, or pull budget from next month." /></h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Request type</label>
                                <select value={requestType} onChange={(e) => setRequestType(e.target.value as any)} className="w-full p-2 border rounded">
                                    <option value="NewCategory">New Category</option>
                                    <option value="IncreaseLimit">Increase Limit</option>
                                    <option value="AdvanceFromNextMonth">Advance from next month</option>
                                </select>
                            </div>
                            {requestType === 'NewCategory' ? (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Category name</label>
                                    <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Travel, Education" className="w-full p-2 border rounded" />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">{requestType === 'AdvanceFromNextMonth' ? 'Category to advance' : 'Category to increase'} <InfoHint text={selectedCategoryName ? getCategoryHint(selectedCategoryName) : requestType === 'AdvanceFromNextMonth' ? 'Choose which category should borrow limit from next month (requires admin approval).' : 'Choose which budget category you want to request a higher limit for.'} /></label>
                                    <select value={requestCategoryId} onChange={(e) => setRequestCategoryId(e.target.value)} className="w-full p-2 border rounded">
                                        <option value="">Select category</option>
                                        {availableIncreaseCategories.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    {currentBudgetRow && (
                                        <p className="mt-1 text-xs text-gray-600">Current limit: {formatCurrencyString(currentLimit, { digits: 0 })} · Spent this period: {formatCurrencyString(currentSpent, { digits: 0 })}</p>
                                    )}
                                    {requestType === 'AdvanceFromNextMonth' && (
                                        <p className="mt-1 text-xs text-indigo-700">If approved, {formatCurrencyString(Number(requestAmount || 0) || 0, { digits: 0 })} moves from {MONTHS[nextMonthCtx.month - 1]} {nextMonthCtx.year} to {MONTHS[currentMonth - 1]} {currentYear} for this category.</p>
                                    )}
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Proposed amount ({requestAmountPeriod})</label>
                                <div className="flex gap-2">
                                    <input type="number" min="0" step="1" value={requestAmount} onChange={(e) => setRequestAmount(e.target.value)} placeholder="Amount" className="flex-1 p-2 border rounded" />
                                    <select value={requestAmountPeriod} onChange={(e) => setRequestAmountPeriod(e.target.value as 'Monthly' | 'Weekly' | 'Daily' | 'Yearly')} className="p-2 border rounded w-28">
                                        <option value="Monthly">Monthly</option>
                                        <option value="Weekly">Weekly</option>
                                        <option value="Daily">Daily</option>
                                        <option value="Yearly">Yearly</option>
                                    </select>
                                </div>
                                {requestType === 'IncreaseLimit' && currentSpent > 0 && (
                                    <button type="button" onClick={() => setRequestAmount(String(Math.ceil(currentSpent)))} className="mt-1 text-xs text-primary hover:underline">Suggest: use current spend ({formatCurrencyString(currentSpent, { digits: 0 })})</button>
                                )}
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Reason / note (optional)</label>
                                <input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="e.g. Higher travel expected next quarter" className="w-full p-2 border rounded" />
                            </div>
                            <div className="md:col-span-2">
                                <button onClick={submitBudgetRequest} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Submit request</button>
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-gray-500">Amounts are normalized to a monthly limit for approval. Duplicate pending requests for the same category are blocked. Advance-from-next-month requests are automated after admin approval: next month decreases and current month increases by the approved amount.</p>
                    </div>
                );
            })()}

            {!isAdmin && pendingRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-blue-50 to-sky-50 rounded-lg shadow p-5 border border-blue-200">
                    <h2 className="text-lg font-semibold mb-3">My Pending Budget Requests</h2>
                    <div className="space-y-2">
                        {pendingRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{displayRequestType(r)} • {resolveRequestCategory(r)}</p>
                                    <p className="text-xs text-gray-500">Proposed (monthly equivalent): {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                    <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${requestStatusClasses[r.status] || 'bg-slate-100 text-slate-800'}`}>{r.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            {isAdmin && pendingRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-amber-50 to-orange-50 rounded-lg shadow p-5 border border-amber-200">
                    <h2 className="text-lg font-semibold mb-3 flex items-center">Budget Request Review <InfoHint text="Finalize directly or adjust amount before finalizing. Rejections remain in history timeline." /></h2>
                    <div className="space-y-3">
                        {pendingRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between gap-2">
                                <div>
                                    <p className="font-medium">{displayRequestType(r)} • {resolveRequestCategory(r)}</p>
                                    <p className="text-xs text-gray-500">
                                        {(() => {
                                            const meta = parseRequestedAmountMeta(r);
                                            if (meta.rawAmount && meta.rawPeriod) {
                                                return <>Requested: {formatCurrencyString(meta.rawAmount, { digits: 0 })} ({meta.rawPeriod}) · Monthly equivalent: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</>;
                                            }
                                            return <>Requested (monthly equivalent): {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</>;
                                        })()}
                                    </p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                    <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => finalizeBudgetRequest(r)} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Finalize</button>
                                    <button onClick={() => {
                                        const requestedMeta = parseRequestedAmountMeta(r);
                                        const suggestedAmount = requestedMeta.rawAmount && requestedMeta.rawPeriod
                                            ? normalizeToMonthly(requestedMeta.rawAmount, requestedMeta.rawPeriod)
                                            : Number(r.amount || 0);
                                        const nextAmount = window.prompt('Approve with custom monthly limit (monthly equivalent):', String(suggestedAmount || ''));
                                        if (nextAmount == null) return;
                                        const parsed = Number(nextAmount);
                                        if (!Number.isFinite(parsed) || parsed <= 0) {
                                            alert('Please enter a valid amount greater than 0.');
                                            return;
                                        }
                                        finalizeBudgetRequest(r, parsed);
                                    }} className="px-3 py-1 text-xs rounded bg-emerald-700 text-white">Adjust & Finalize</button>
                                    <button onClick={() => rejectBudgetRequest(r.id)} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isAdmin && (pendingRequests.length > 0 || allRespondedRequests.length > 0) && (
                <div className="bg-gradient-to-br from-white via-violet-50 to-purple-50 rounded-lg shadow p-5 border border-violet-200">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <h2 className="text-lg font-semibold">Budget Request Review & History</h2>
                        <div className="flex items-center gap-2">
                            <select value={requestStatusFilter} onChange={(e) => setRequestStatusFilter(e.target.value as any)} className="p-2 border rounded text-sm">
                                <option value="All">All statuses</option>
                                <option value="Pending">Pending</option>
                                <option value="Finalized">Finalized</option>
                                <option value="Rejected">Rejected</option>
                            </select>
                        </div>
                    </div>
                    {pendingRequests.length > 0 && requestStatusFilter === 'All' && (
                        <div className="mb-4 space-y-3">
                            <h3 className="text-sm font-semibold text-amber-800">Pending Review</h3>
                            {pendingRequests.map((r) => (
                                <div key={r.id} className="p-3 border rounded flex items-center justify-between gap-2 bg-white">
                                    <div>
                                        <p className="font-medium">{displayRequestType(r)} • {resolveRequestCategory(r)}</p>
                                        <p className="text-xs text-gray-500">
                                            {(() => {
                                                const meta = parseRequestedAmountMeta(r);
                                                if (meta.rawAmount && meta.rawPeriod) {
                                                    return <>Requested: {formatCurrencyString(meta.rawAmount, { digits: 0 })} ({meta.rawPeriod}) · Monthly equivalent: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</>;
                                                }
                                                return <>Requested (monthly equivalent): {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</>;
                                            })()}
                                        </p>
                                        {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                        <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => finalizeBudgetRequest(r)} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Finalize</button>
                                        <button onClick={() => {
                                            const requestedMeta = parseRequestedAmountMeta(r);
                                            const suggestedAmount = requestedMeta.rawAmount && requestedMeta.rawPeriod
                                                ? normalizeToMonthly(requestedMeta.rawAmount, requestedMeta.rawPeriod)
                                                : Number(r.amount || 0);
                                            const nextAmount = window.prompt('Approve with custom monthly limit (monthly equivalent):', String(suggestedAmount || ''));
                                            if (nextAmount == null) return;
                                            const parsed = Number(nextAmount);
                                            if (!Number.isFinite(parsed) || parsed <= 0) {
                                                alert('Please enter a valid amount greater than 0.');
                                                return;
                                            }
                                            finalizeBudgetRequest(r, parsed);
                                        }} className="px-3 py-1 text-xs rounded bg-emerald-700 text-white">Adjust & Finalize</button>
                                        <button onClick={() => rejectBudgetRequest(r.id)} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {allRespondedRequests.length > 0 && (requestStatusFilter === 'All' || requestStatusFilter === 'Finalized' || requestStatusFilter === 'Rejected') && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-violet-800">Request History</h3>
                                <button type="button" onClick={() => setHistoryCollapsed(!historyCollapsed)} className="text-xs text-violet-600 hover:text-violet-800">
                                    {historyCollapsed ? 'Expand' : 'Collapse'}
                                </button>
                            </div>
                            {!historyCollapsed && (
                                <>
                                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                        <table className="w-full text-sm border-collapse">
                                            <thead className="sticky top-0 bg-violet-50/95 z-10">
                                                <tr className="border-b border-violet-200">
                                                    <th className="text-left py-2 px-2 font-medium text-gray-700">Date</th>
                                                    <th className="text-left py-2 px-2 font-medium text-gray-700">Type</th>
                                                    <th className="text-left py-2 px-2 font-medium text-gray-700">Category</th>
                                                    <th className="text-right py-2 px-2 font-medium text-gray-700">Amount</th>
                                                    <th className="text-left py-2 px-2 font-medium text-gray-700">Status</th>
                                                    <th className="text-left py-2 px-2 font-medium text-gray-700">Note</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {visibleHistoryRequests.filter((r) => requestStatusFilter === 'All' || r.status === requestStatusFilter).map((r) => (
                                                    <tr key={`history-${r.id}`} className="border-b border-violet-100 hover:bg-white/60">
                                                        <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                                                        <td className="py-2 px-2">{displayRequestType(r)}</td>
                                                        <td className="py-2 px-2">{resolveRequestCategory(r)}</td>
                                                        <td className="py-2 px-2 text-right font-medium">{formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</td>
                                                        <td className="py-2 px-2"><span className={`text-xs px-2 py-0.5 rounded ${requestStatusClasses[r.status] || 'bg-slate-100 text-slate-800'}`}>{r.status}</span></td>
                                                        <td className="py-2 px-2 text-gray-600 max-w-[260px] align-top" title={r.note || r.request_note || ''}>
                                                            <span className="clamp-2-lines break-words">{r.note || r.request_note || '—'}</span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        {hasMoreHistory && (
                                            <button onClick={() => setHistoryItemsToShow((prev) => prev + HISTORY_PAGE_SIZE)} className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:bg-violet-700">Load {Math.min(HISTORY_PAGE_SIZE, allRespondedRequests.length - historyItemsToShow)} more</button>
                                        )}
                                        {!hasMoreHistory && allRespondedRequests.length > HISTORY_PAGE_SIZE && (
                                            <button onClick={() => setHistoryItemsToShow(HISTORY_PAGE_SIZE)} className="px-3 py-1.5 text-xs rounded border border-violet-300 text-violet-700 hover:bg-violet-50">Show less</button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {budgetView === 'Yearly' && (
                <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded p-3">
                    Yearly view aggregates all monthly budgets and spending for {currentYear}.
                </div>
            )}

            </div>

            <div className={budgetSubPage === 'household' ? '' : 'hidden'}>
            <SectionCard title="Household Budget Engine" collapsible collapsibleSummary="Household engine" defaultExpanded>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-700 font-medium">
                        Fully auto-builds from your transactions, accounts, goals, and risk profile to project monthly cash flow and goal routing. Manual inputs are optional overrides only.
                    </p>
                    {triggerPageAction && (
                        <button
                            type="button"
                            onClick={() => triggerPageAction('Market Events', 'focus-macro')}
                            className="text-xs px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 whitespace-nowrap"
                        >
                            Check Market Events
                        </button>
                    )}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 items-end">
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Profile</label>
                        <select
                            value={engineProfile}
                            onChange={(e) => setEngineProfile(e.target.value as HouseholdEngineProfile)}
                            className="p-2 border border-slate-200 rounded-lg bg-white text-sm min-w-[140px]"
                        >
                            {(Object.keys(HOUSEHOLD_ENGINE_PROFILES) as HouseholdEngineProfile[]).map((key) => (
                                <option key={key} value={key}>{HOUSEHOLD_ENGINE_PROFILES[key].label}</option>
                            ))}
                        </select>
                        <p className="text-xs text-slate-500 mt-1 max-w-[200px]">{HOUSEHOLD_ENGINE_PROFILES[engineProfile]?.description ?? ''}</p>
                        {(householdBudgetEngine as unknown as { suggestedProfile?: string }).suggestedProfile && (householdBudgetEngine as unknown as { suggestedProfile: string }).suggestedProfile !== engineProfile && (
                            <p className="text-xs text-amber-700 mt-1">Suggested: {(householdBudgetEngine as unknown as { suggestedProfile: string }).suggestedProfile} (income variance)</p>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Expected monthly salary (optional)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            value={expectedMonthlySalary}
                            onChange={(e) => setExpectedMonthlySalary(e.target.value === '' ? '' : Number(e.target.value))}
                            placeholder={suggestedMonthlySalary ? `Auto: ${formatCurrencyString(suggestedMonthlySalary, { digits: 0 })}` : 'From transactions'}
                            className="p-2 border border-slate-200 rounded-lg w-36 text-sm"
                        />
                        <p className="text-xs text-slate-500 mt-1">Leave empty to use actuals + average</p>
                    </div>
                    <div className="flex gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Adults</label>
                            <input type="number" min={1} value={householdAdults} onChange={(e) => setHouseholdAdults(Math.max(1, Number(e.target.value) || 1))} className="p-2 border border-slate-200 rounded-lg w-16 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Kids</label>
                            <input type="number" min={0} value={householdKids} onChange={(e) => setHouseholdKids(Math.max(0, Number(e.target.value) || 0))} className="p-2 border border-slate-200 rounded-lg w-16 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                        <p className="text-xs text-slate-500">Planned annual net</p>
                        <p className="font-bold text-slate-900">{formatCurrencyString(householdBudgetEngine.plannedVsActual.plannedNet, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                        <p className="text-xs text-slate-500">Actual annual net</p>
                        <p className="font-bold text-slate-900">{formatCurrencyString(householdBudgetEngine.plannedVsActual.actualNet, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 p-3 bg-emerald-50">
                        <p className="text-xs text-slate-600">Projected year-end liquid</p>
                        <p className="font-bold text-emerald-700">{formatCurrencyString(householdBudgetEngine.balanceProjection.projectedYearEndLiquid, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border border-indigo-200 p-3 bg-indigo-50">
                        <p className="text-xs text-slate-600">Auto-routed goal</p>
                        <p className="font-bold text-indigo-700">{householdBudgetEngine.months.find((m) => m.routedGoalName)?.routedGoalName || 'None'}</p>
                    </div>
                </div>
                {householdBudgetEngine.recommendations.length > 0 && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Recommendations</p>
                        <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
                            {householdBudgetEngine.recommendations.slice(0, 4).map((item, idx) => <li key={`hh-rec-${idx}`}>{item}</li>)}
                        </ul>
                    </div>
                )}
                {criticalValidationCount > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold text-amber-800">Issues in {criticalValidationCount} month(s)</p>
                        <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 space-y-0.5">
                            {householdBudgetEngine.months.filter((m) => (m.validationErrors?.length || 0) > 0).slice(0, 5).map((m) => (
                                <li key={`vv-${m.month}`}>Month {m.month}: {(m.validationErrors || []).join(' ')}</li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs text-amber-700">Set a higher <strong>Salary</strong> in the table below for affected months, or reduce planned expenses/savings so they don’t exceed income.</p>
                        {(typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setHouseholdOverrides((prev) => {
                                        const byMonth = new Map(prev.map((o) => [o.month, { ...o }]));
                                        for (let month = 1; month <= 12; month++) {
                                            const existing = byMonth.get(month) || { month };
                                            byMonth.set(month, { ...existing, month, salary: expectedMonthlySalary });
                                        }
                                        return Array.from(byMonth.values()).sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
                                    });
                                }}
                                className="mt-2 text-xs px-2 py-1 rounded border border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200"
                            >
                                Apply expected salary ({formatCurrencyString(expectedMonthlySalary, { digits: 0 })}) to all months
                            </button>
                        )}
                    </div>
                )}
                <div className="mt-6 pt-4 border-t border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800 mb-1">Household engine: Bulk add budgets</h3>
                    <p className="text-xs text-slate-600 mb-4">One place to create or update many budgets at once. Amounts are based on <strong>salary</strong>, <strong>family size (adults &amp; kids)</strong>, and <strong>profile</strong>. When the engine has run for the target month, its projected buckets are merged in for accuracy.</p>

                    <div className="flex flex-wrap items-end gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-slate-600 font-medium mb-1">Target month</label>
                            <input
                                type="month"
                                value={`${bulkAddTargetYear}-${String(bulkAddTargetMonth).padStart(2, '0')}`}
                                onChange={(e) => {
                                    const [y, m] = e.target.value.split('-').map(Number);
                                    setBulkAddTargetYear(y);
                                    setBulkAddTargetMonth(m);
                                }}
                                className="p-1.5 border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-600 font-medium mb-1">Monthly salary (SAR)</label>
                            <input
                                type="number"
                                min={0}
                                step={100}
                                value={bulkAddSalary}
                                onChange={(e) => setBulkAddSalary(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder={suggestedMonthlySalary > 0 ? `From income: ${formatCurrencyString(suggestedMonthlySalary, { digits: 0 })}` : (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0 ? String(expectedMonthlySalary) : 'e.g. 15000')}
                                className="w-36 p-2 border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <div>
                                <label className="block text-xs text-slate-600 font-medium mb-1">Adults</label>
                                <input type="number" min={1} value={householdAdults} onChange={(e) => setHouseholdAdults(Math.max(1, Number(e.target.value) || 1))} className="w-14 p-2 border border-slate-300 rounded text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-600 font-medium mb-1">Kids</label>
                                <input type="number" min={0} value={householdKids} onChange={(e) => setHouseholdKids(Math.max(0, Number(e.target.value) || 0))} className="w-14 p-2 border border-slate-300 rounded text-sm" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-600 font-medium mb-1">Profile</label>
                            <span className="text-sm text-slate-700">{HOUSEHOLD_ENGINE_PROFILES[engineProfile]?.label ?? engineProfile}</span>
                        </div>
                        <div className="min-w-[200px]">
                            <label className="block text-xs text-slate-600 font-medium mb-1" htmlFor="bulk-limit-scale">Limit scale before create (%)</label>
                            <div className="flex items-center gap-2">
                                <input
                                    id="bulk-limit-scale"
                                    type="range"
                                    min={25}
                                    max={200}
                                    step={1}
                                    value={bulkLimitScalePercent}
                                    onChange={(e) => setBulkLimitScalePercent(Number(e.target.value))}
                                    className="flex-1 min-w-[120px] accent-emerald-600"
                                />
                                <input
                                    type="number"
                                    min={25}
                                    max={200}
                                    step={1}
                                    value={bulkLimitScalePercent}
                                    onChange={(e) => setBulkLimitScalePercent(Math.max(25, Math.min(200, Number(e.target.value) || 100)))}
                                    className="w-16 p-1.5 border border-slate-300 rounded text-sm text-center"
                                    aria-label="Limit scale percent"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">Multiplies every suggested limit (same category split; adjust tighter or looser before generating budgets).</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                            <p className="text-xs text-slate-600">Suggested limits use the same formulas as the engine (groceries scale with family size; rent, utilities, transport, schooling, etc. are consistent). If you have run the engine above for this year, amounts for the target month may reflect engine projections. Select categories to create or update.</p>
                            {bulkAddScaledCategories.length > 0 && (
                                <>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-slate-600">Select categories to create or update (limits sync with salary, profile & selection):</span>
                                        <span className="flex gap-2">
                                            <button type="button" onClick={() => setBulkAddSelectedCategories(bulkAddScaledCategories.map((c) => c.category))} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Select all</button>
                                            <span className="text-slate-300">|</span>
                                            <button type="button" onClick={() => setBulkAddSelectedCategories([])} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Deselect all</button>
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-600">
                                        Selected: <span className="font-semibold text-slate-800">{bulkAddSelectedCategoriesNormalized.length}</span>
                                        {' '}categories · Monthly equivalent:{' '}
                                        <span className="font-semibold text-slate-800">{formatCurrencyString(bulkAddSelectedMonthlyEquivalent, { digits: 0 })}/mo</span>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white p-2 space-y-1.5">
                                        {bulkAddScaledCategories.map((cat) => {
                                            const selected = bulkAddSelectedCategoriesNormalized.includes(cat.category);
                                            const periodLabel = cat.period === 'yearly' ? '/yr' : cat.period === 'weekly' ? '/wk' : cat.period === 'daily' ? '/day' : '/mo';
                                            return (
                                                <label key={cat.category} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected}
                                                        onChange={() => {
                                                            if (selected) setBulkAddSelectedCategories((prev) => prev.filter((n) => n !== cat.category));
                                                            else setBulkAddSelectedCategories((prev) => (prev.includes(cat.category) ? prev : [...prev, cat.category]));
                                                        }}
                                                        className="rounded border-slate-300 text-emerald-600"
                                                    />
                                                    <span className="text-sm text-slate-800 flex-1 inline-flex items-center gap-1">
                                                        {cat.category}
                                                        <InfoHint text={(cat as { hint?: string }).hint ?? getCategoryHint(cat.category)} placement="bottom" />
                                                    </span>
                                                    <span className="text-xs text-slate-500 tabular-nums">{formatCurrencyString(cat.limit, { digits: 0 })}{periodLabel}</span>
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${cat.tier === 'Core' ? 'bg-emerald-100 text-emerald-700' : cat.tier === 'Supporting' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>{cat.tier}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <button
                                        type="button"
                                        disabled={!isAdmin || bulkAddSelectedCategoriesNormalized.length === 0}
                                        onClick={async () => {
                                            if (!isAdmin) { alert('Only admins can create budgets from the household engine.'); return; }
                                            const salary = Number(bulkAddSalary);
                                            const fallback = (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0) ? expectedMonthlySalary : suggestedMonthlySalary;
                                            const monthlySalary = Number.isFinite(salary) && salary > 0 ? salary : fallback;
                                            if (!monthlySalary || monthlySalary <= 0) {
                                                alert('Enter a monthly salary or use the value from the table above.');
                                                return;
                                            }
                                            const selectedSet = new Set(bulkAddSelectedCategoriesNormalized);
                                            const categories = bulkAddScaledCategories.filter((c) => selectedSet.has(c.category));
                                            if (!window.confirm(`Create or update ${categories.length} budgets for ${MONTHS[bulkAddTargetMonth - 1]} ${bulkAddTargetYear}? Existing budgets for that month will be updated.`)) return;
                                            const existingBudgets = (data?.budgets ?? []).filter((b) => b.year === bulkAddTargetYear && b.month === bulkAddTargetMonth);
                                            let created = 0, updated = 0;
                                            try {
                                                for (const cat of categories) {
                                                    const existing = existingBudgets.find((b) => b.category === cat.category);
                                                    if (existing) {
                                                        await updateBudget({ ...existing, limit: cat.limit, period: cat.period, tier: cat.tier });
                                                        updated++;
                                                    } else {
                                                        await addBudget({ category: cat.category, limit: cat.limit, month: bulkAddTargetMonth, year: bulkAddTargetYear, period: cat.period, tier: cat.tier });
                                                        created++;
                                                    }
                                                }
                                                alert(`Bulk add: ${created} created, ${updated} updated for ${MONTHS[bulkAddTargetMonth - 1]} ${bulkAddTargetYear}.`);
                                            } catch (err) {
                                                console.error('Bulk add budgets failed:', err);
                                                alert(`Some budgets could not be saved. ${created} created, ${updated} updated. Check console for details.`);
                                            }
                                        }}
                                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Create/update {bulkAddSelectedCategoriesNormalized.length} selected for {MONTHS[bulkAddTargetMonth - 1]} {bulkAddTargetYear}
                                    </button>
                                </>
                            )}
                            {((Number(bulkAddSalary) > 0) || (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0) || (suggestedMonthlySalary > 0)) && bulkAddSuggestedCategories.length === 0 && (
                                <p className="text-xs text-slate-500">Enter a valid salary above to see suggested categories.</p>
                            )}
                        </div>

                    <div className="mt-3">
                        <button type="button" onClick={() => setShowKsaExpenseRef((v) => !v)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                            {showKsaExpenseRef ? 'Hide' : 'View'} household expense reference
                        </button>
                        {showKsaExpenseRef && (
                            <div className="mt-2 p-2 rounded border border-slate-200 bg-slate-50 text-xs text-slate-700 max-h-48 overflow-y-auto">
                                {Object.entries(KSA_EXPENSE_CATEGORY_HINTS).map(([name, hint]) => (
                                    <div key={name} className="py-1 border-b border-slate-100 last:border-0">
                                        <span className="font-medium text-slate-800">{name}</span>
                                        <span className="text-slate-600"> — {hint}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Buttons — results appear below when toggled */}
                <div className="mt-6 pt-6 border-t border-slate-200 flex flex-wrap gap-2">
                    {!showPredictiveAnalytics && predictiveForecasts.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowPredictiveAnalytics(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                        >
                            Show Predictive Analytics
                        </button>
                    )}
                    {!showScenarioPlanning && scenarios.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowScenarioPlanning(true)}
                            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium"
                        >
                            Show Scenario Planning
                        </button>
                    )}
                    {!showSeasonality && seasonalityPatterns.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowSeasonality(true)}
                            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 text-sm font-medium"
                        >
                            Show Seasonality Patterns
                        </button>
                    )}
                </div>

                {/* Predictive Analytics Section — shown below the buttons */}
                {showPredictiveAnalytics && predictiveForecasts.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-bold text-slate-900">Predictive Analytics (Next 3 Months)</h4>
                            <button
                                type="button"
                                onClick={() => setShowPredictiveAnalytics(false)}
                                className="text-xs text-slate-500 hover:text-slate-700"
                            >
                                Hide
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {predictiveForecasts.map((forecast) => (
                                <div key={forecast.month} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                                        Month {forecast.month} ({MONTHS[(forecast.month - 1) % 12]})
                                    </p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Predicted Income:</span>
                                            <span className="font-semibold text-slate-900">{formatCurrencyString(forecast.predictedIncome)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Predicted Expense:</span>
                                            <span className="font-semibold text-slate-900">{formatCurrencyString(forecast.predictedExpense)}</span>
                                        </div>
                                        <div className="flex justify-between pt-2 border-t border-slate-200">
                                            <span className="text-slate-700 font-medium">Net:</span>
                                            <span className={`font-bold ${forecast.predictedNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {forecast.predictedNet >= 0 ? '+' : ''}{formatCurrencyString(forecast.predictedNet)}
                                            </span>
                                        </div>
                                        <div className="pt-2 border-t border-slate-200">
                                            <span className={`text-xs px-2 py-1 rounded ${
                                                forecast.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                                                forecast.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                'bg-rose-100 text-rose-700'
                                            }`}>
                                                {forecast.confidence.charAt(0).toUpperCase() + forecast.confidence.slice(1)} confidence
                                            </span>
                                            {forecast.factors.length > 0 && (
                                                <ul className="mt-2 text-xs text-slate-600 list-disc list-inside space-y-0.5">
                                                    {forecast.factors.map((factor, idx) => (
                                                        <li key={idx}>{factor}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Scenario Planning Section */}
                {showScenarioPlanning && scenarios.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-bold text-slate-900">Scenario Planning</h4>
                            <button
                                type="button"
                                onClick={() => setShowScenarioPlanning(false)}
                                className="text-xs text-slate-500 hover:text-slate-700"
                            >
                                Hide
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {scenarios.map((scenario, idx) => (
                                <div key={idx} className={`rounded-lg border-2 p-4 ${
                                    scenario.riskLevel === 'high' ? 'border-rose-200 bg-rose-50' :
                                    scenario.riskLevel === 'medium' ? 'border-amber-200 bg-amber-50' :
                                    'border-emerald-200 bg-emerald-50'
                                }`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-bold text-slate-900">{scenario.name}</p>
                                        <span className={`text-xs px-2 py-1 rounded ${
                                            scenario.riskLevel === 'high' ? 'bg-rose-100 text-rose-700' :
                                            scenario.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
                                            'bg-emerald-100 text-emerald-700'
                                        }`}>
                                            {scenario.riskLevel.toUpperCase()} RISK
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 mb-3">{scenario.description}</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Projected Year-End Balance:</span>
                                            <span className="font-semibold text-slate-900">{formatCurrencyString(scenario.projectedYearEndBalance)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Change from Baseline:</span>
                                            <span className={`font-bold ${scenario.projectedYearEndBalanceChange >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {scenario.projectedYearEndBalanceChange >= 0 ? '+' : ''}{formatCurrencyString(scenario.projectedYearEndBalanceChange)}
                                            </span>
                                        </div>
                                        {scenario.goalAchievementImpact.length > 0 && (
                                            <div className="pt-2 border-t border-slate-200">
                                                <p className="text-xs font-semibold text-slate-700 mb-1">Goal Impact:</p>
                                                {scenario.goalAchievementImpact.map((impact, i) => (
                                                    <div key={i} className="flex justify-between gap-3 text-xs text-slate-600">
                                                        <span className="truncate">{impact.goalName}</span>
                                                        <span className="shrink-0 font-medium tabular-nums text-slate-800">
                                                            {impact.achievementDelayMonths >= 0 ? '+' : ''}
                                                            {impact.achievementDelayMonths.toFixed(1)} mo
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Anomaly Detection */}
                {anomalies.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <h4 className="text-sm font-bold text-slate-900 mb-3">Spending Anomalies Detected</h4>
                        <div className="space-y-2">
                            {anomalies.slice(0, 5).map((anomaly, idx) => (
                                <div key={idx} className={`rounded-lg border p-3 ${
                                    anomaly.severity === 'high' ? 'border-rose-200 bg-rose-50' :
                                    anomaly.severity === 'medium' ? 'border-amber-200 bg-amber-50' :
                                    'border-slate-200 bg-slate-50'
                                }`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">
                                                {MONTHS[anomaly.month - 1]} - {anomaly.category}
                                            </p>
                                            <p className="text-xs text-slate-600 mt-1">{anomaly.explanation}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-slate-900">{formatCurrencyString(anomaly.actualAmount)}</p>
                                            <p className="text-xs text-slate-500">Expected: {formatCurrencyString(anomaly.expectedAmount)}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Spending Trends Visualization */}
                {householdBudgetEngine.months.length >= 3 && (
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <h4 className="text-sm font-bold text-slate-900 mb-4">Spending Trends (Last 6 Months)</h4>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <div className="h-48 flex items-end justify-between gap-1">
                                {householdBudgetEngine.months.slice(-6).map((month, idx) => {
                                    const outflows = householdBudgetEngine.months.slice(-6).map((m) => effectiveMonthExpense(m));
                                    const maxExpense = outflows.length > 0 ? Math.max(...outflows) : 0;
                                    const expense = effectiveMonthExpense(month);
                                    const height = maxExpense > 0 ? (expense / maxExpense) * 100 : 0;
                                    const income = (month.incomeActual ?? 0) > 0 ? (month.incomeActual ?? 0) : (month.incomePlanned ?? 0);
                                    const net = income - expense;
                                    const monthNum = month.month ?? (month.monthIndex ?? idx) + 1;
                                    return (
                                        <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                                            <div className="w-full flex flex-col items-center gap-0.5" style={{ height: '180px' }}>
                                                {/* Income bar */}
                                                <div
                                                    className="w-full rounded-t bg-emerald-500 transition-all"
                                                    style={{ height: `${maxExpense > 0 ? (income / maxExpense) * 100 : 0}%`, minHeight: income > 0 ? '2px' : '0' }}
                                                    title={`${MONTHS[(monthNum - 1) % 12]}: Income ${formatCurrencyString(income)}`}
                                                />
                                                {/* Expense bar */}
                                                <div
                                                    className={`w-full rounded-b transition-all ${
                                                        net >= 0 ? 'bg-rose-400' : 'bg-rose-600'
                                                    }`}
                                                    style={{ height: `${height}%`, minHeight: expense > 0 ? '2px' : '0' }}
                                                    title={`${MONTHS[(monthNum - 1) % 12]}: Expense ${formatCurrencyString(expense)}`}
                                                />
                                            </div>
                                            <p className="text-[10px] text-slate-600 font-medium mt-1">
                                                {MONTHS[(monthNum - 1) % 12].substring(0, 3)}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-4 flex items-center justify-center gap-4 text-xs">
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-emerald-500 rounded"></div>
                                    <span className="text-slate-600">Income</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-rose-400 rounded"></div>
                                    <span className="text-slate-600">Expense</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Seasonality Detection */}
                {showSeasonality && seasonalityPatterns.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-bold text-slate-900">Seasonal Spending Patterns</h4>
                            <button
                                type="button"
                                onClick={() => setShowSeasonality(false)}
                                className="text-xs px-2 py-1 text-slate-500 hover:text-slate-700"
                            >
                                Hide
                            </button>
                        </div>
                        <div className="space-y-3">
                            {seasonalityPatterns.slice(0, 10).map((pattern, idx) => (
                                <div
                                    key={idx}
                                    className={`rounded-lg border p-3 ${
                                        pattern.pattern === 'peak' ? 'border-rose-200 bg-rose-50' :
                                        pattern.pattern === 'trough' ? 'border-emerald-200 bg-emerald-50' :
                                        'border-slate-200 bg-slate-50'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">
                                                {pattern.monthName} - {pattern.category}
                                            </p>
                                            <p className="text-xs text-slate-600 mt-1">
                                                {pattern.pattern === 'peak' ? 'Peak spending month' :
                                                 pattern.pattern === 'trough' ? 'Low spending month' :
                                                 'Normal spending'}
                                                {' '}
                                                ({pattern.confidence} confidence)
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-slate-900">
                                                {formatCurrencyString(pattern.averageAmount)}
                                            </p>
                                            <p className={`text-xs ${pattern.deviationPct >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {pattern.deviationPct >= 0 ? '+' : ''}{pattern.deviationPct.toFixed(1)}% from average
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50">
                    <summary className="p-3 cursor-pointer text-sm font-medium text-slate-600">Advanced: monthly overrides & scenarios</summary>
                    <div className="p-3 pt-0 space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS.map((scenario) => (
                                <button
                                    key={scenario.id}
                                    type="button"
                                    className={`px-3 py-1.5 rounded-lg border text-sm ${selectedScenario === scenario.id ? 'bg-primary text-white border-primary' : 'bg-white border-slate-200 text-slate-700'}`}
                                    onClick={() => {
                                        setSelectedScenario(scenario.id);
                                        setHouseholdAdults(scenario.defaults.adults);
                                        setHouseholdKids(scenario.defaults.kids);
                                        setHouseholdOverrides(scenario.overrides);
                                    }}
                                >
                                    {scenario.label}
                                </button>
                            ))}
                            <button type="button" className="px-3 py-1.5 rounded-lg border text-sm bg-white border-slate-200 text-slate-700" onClick={() => setSelectedScenario('custom')}>Custom</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                                <thead>
                                    <tr className="text-slate-500 border-b"><th className="text-left py-1 pr-2">Month</th><th className="text-left py-1 pr-2">Salary</th><th className="text-left py-1 pr-2">Adults</th><th className="text-left py-1 pr-2">Kids</th></tr>
                                </thead>
                                <tbody>
                                    {MONTHS.map((label, idx) => {
                                        const month = idx + 1;
                                        const ov = householdOverrides.find((o) => o.month === month);
                                        const defaultSalary = (typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0) ? expectedMonthlySalary : (suggestedMonthlySalary && suggestedMonthlySalary > 0 ? suggestedMonthlySalary : undefined);
                                        const displaySalary = ov?.salary !== undefined && ov?.salary !== null ? ov.salary : defaultSalary;
                                        return (
                                            <tr key={`hh-month-${month}`} className="border-b border-slate-100">
                                                <td className="py-1 pr-2">{label}</td>
                                                <td className="py-1 pr-2"><input type="number" min={0} step={100} value={displaySalary !== undefined && displaySalary !== null ? displaySalary : ''} onChange={(e) => updateMonthlyOverride(month, { salary: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder={defaultSalary == null ? 'From income' : undefined} className="w-20 p-1 border rounded" /></td>
                                                <td className="py-1 pr-2"><input type="number" min={1} value={ov?.adults ?? householdAdults} onChange={(e) => updateMonthlyOverride(month, { adults: Math.max(1, Number(e.target.value) || 1) })} className="w-12 p-1 border rounded" /></td>
                                                <td className="py-1 pr-2"><input type="number" min={0} value={ov?.kids ?? householdKids} onChange={(e) => updateMonthlyOverride(month, { kids: Math.max(0, Number(e.target.value) || 0) })} className="w-12 p-1 border rounded" /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>
            </SectionCard>
            </div>

            {budgetData.length > 0 && (
                <div className="section-card border-l-4 border-emerald-500/60">
                    <h3 className="section-title text-base">Money saved from budget</h3>
                    <p className="text-2xl font-bold text-emerald-700 tabular-nums">{formatCurrencyString(budgetInsights.totalSavedFromBudget, { digits: 0 })}</p>
                    <p className="text-sm text-slate-600 mt-1">
                        {budgetView === 'Monthly' && 'This month you stayed under your total budget by this amount. '}
                        {budgetView === 'Weekly' && 'This week you stayed under your total budget by this amount. '}
                        {budgetView === 'Daily' && 'Today you stayed under your daily budget by this amount. '}
                        {budgetView === 'Yearly' && `So far in ${currentYear} you are under your yearly budget by this amount. `}
                        This money remains in your accounts; it is part of your actual cash flow and can go toward goals, investments, or savings.
                    </p>
                </div>
            )}

            <SectionCard title="Budget sharing" collapsible collapsibleSummary="Shared budgets">
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sharing audit snapshot</p>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        <div><span className="text-slate-500">Shared budget rows:</span> <span className="font-semibold text-slate-800">{sharedBudgets.length}</span></div>
                        <div><span className="text-slate-500">Consumed scopes:</span> <span className="font-semibold text-slate-800">{sharedConsumedByOwnerCategory.size}</span></div>
                        <div><span className="text-slate-500">Last consumed sync:</span> <span className="font-semibold text-slate-800">{sharedConsumedSyncedAt ? new Date(sharedConsumedSyncedAt).toLocaleString() : 'Not synced yet'}</span></div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Consumed totals include owner approved expenses plus approved collaborator shared transactions within shared category scope.</p>
                </div>
                {isAdmin ? (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Share with user email</label>
                                <select value={shareTargetEmail} onChange={(e) => setShareTargetEmail(e.target.value)} className="select-base">
                                    <option value="">Select a signed-up user…</option>
                                    {shareableUsers.map((u) => (
                                        <option key={u.id} value={u.email}>{u.email}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-slate-500 mt-1">Or type manually if a user is not listed.</p>
                                <input value={shareTargetEmail} onChange={(e) => setShareTargetEmail(e.target.value)} placeholder="user@example.com" className="input-base mt-2" />
                                {shareUsersLoadError && <p className="text-xs text-amber-700 mt-1">{shareUsersLoadError}</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category scope</label>
                                <select value={shareCategory} onChange={(e) => setShareCategory(e.target.value)} className="select-base">
                                    <option value="ALL">All budget categories</option>
                                    {Array.from(new Set((data?.budgets ?? []).map((b) => b.category))).map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 items-center">
                            <button type="button" onClick={handleShareBudget} className="btn-primary">Share budget</button>
                            <p className="text-xs text-slate-500">Only selected budget categories are shared with the specific users you choose. Accounts, assets, transactions, investments, and all other personal details remain private per-user.</p>
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-slate-600">Only Admin can share budgets. Any budgets shared with you are listed below.</p>
                )}

                {sharedBudgetCards.length > 0 && (
                    <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 border border-indigo-100 rounded-xl px-4 py-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-800">Shared budgets in your view</p>
                                <p className="text-xs text-slate-600">These budgets use the same spend-progress style as your own cards.</p>
                            </div>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white border border-indigo-200 text-indigo-700">{sharedBudgetCards.length} shared</span>
                        </div>
                        <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                            {sharedBudgetCards.map((budget) => {
                                const owner = sharedBudgetOwnerByCardId.get(budget.id) || 'Owner';
                                const remaining = (budgetView === 'Yearly' ? budget.limit - budget.spent : budget.monthlyLimit - budget.spent);
                                return (
                                    <div key={`shared-card-${budget.id}`} className="bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40 p-5 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300 border border-indigo-100">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold">Shared by</p>
                                                <p className="text-sm font-medium text-slate-800 break-all">{owner}</p>
                                            </div>
                                            <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">{budget.budgetTier ?? 'Optional'}</span>
                                        </div>

                                        <h4 className="mt-3 text-base font-semibold text-slate-900 inline-flex items-center gap-1">
                                            {budget.category}
                                            <InfoHint text={getCategoryHint(budget.category)} placement="bottom" />
                                        </h4>

                                        <div className="mt-4">
                                            <div className="flex justify-between items-baseline mb-1">
                                                <span className="font-medium text-secondary">{formatCurrencyString(budget.spent, { digits: 0 })}</span>
                                                <span className="text-xs text-gray-600">/ {formatCurrencyString(budget.monthlyLimit, { digits: 0 })}{budget.period === 'yearly' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/yr)` : budget.period === 'weekly' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/wk)` : budget.period === 'daily' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/day)` : ''}</span>
                                            </div>
                                            <ProgressBar value={budget.spent} max={budgetView === 'Yearly' ? (budget.limit ?? 1) : (budget.monthlyLimit ?? 1)} color={budget.colorClass} />
                                            <p className={`text-right text-sm mt-1 ${remaining >= 0 ? 'text-gray-600' : 'text-danger font-medium'}`}>
                                                {remaining >= 0 ? `${formatCurrencyString(remaining, { digits: 0 })} remaining` : `${formatCurrencyString(Math.abs(remaining), { digits: 0 })} over budget`}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </SectionCard>

            {isAdmin && (
                <SectionCard title="Admin: Approved Budgets & Shared Account Tracking" collapsible collapsibleSummary="Admin tracking">
                    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                        <h3 className="text-sm font-semibold text-indigo-900 mb-3">Approved Budgets Overview</h3>
                        <p className="text-xs text-indigo-700 mb-3">To create or update many budgets at once, use <strong>Household Engine</strong> tab → <strong>Bulk add budgets</strong>.</p>

                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Month</label>
                                <input
                                    type="month"
                                    value={`${approvedOverviewYear}-${String(approvedOverviewMonth).padStart(2, '0')}`}
                                    onChange={(e) => {
                                        const [y, m] = e.target.value.split('-').map(Number);
                                        setApprovedOverviewYear(y);
                                        setApprovedOverviewMonth(m);
                                    }}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Period</label>
                                <select
                                    value={approvedOverviewPeriodFilter}
                                    onChange={(e) => setApprovedOverviewPeriodFilter(e.target.value as typeof approvedOverviewPeriodFilter)}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                >
                                    <option value="all">All</option>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Tier</label>
                                <select
                                    value={approvedOverviewTierFilter}
                                    onChange={(e) => setApprovedOverviewTierFilter(e.target.value as typeof approvedOverviewTierFilter)}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                >
                                    <option value="all">All</option>
                                    <option value="Core">Core</option>
                                    <option value="Supporting">Supporting</option>
                                    <option value="Optional">Optional</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Category</label>
                                <input
                                    type="text"
                                    value={approvedOverviewSearch}
                                    onChange={(e) => setApprovedOverviewSearch(e.target.value)}
                                    placeholder="Search category..."
                                    className="p-1.5 border border-slate-300 rounded text-sm w-40"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm mb-4">
                            <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                <span className="text-indigo-600 text-xs uppercase tracking-wide">Total Categories</span>
                                <p className="font-bold text-indigo-900 text-lg">{adminApprovedOverviewFiltered.length}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                <span className="text-indigo-600 text-xs uppercase tracking-wide">Total Budget Limit (mo equiv)</span>
                                <p className="font-bold text-indigo-900 text-lg">{formatCurrencyString(adminApprovedOverviewFiltered.reduce((sum, b) => sum + b.monthlyLimit, 0), { digits: 0 })}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                <span className="text-indigo-600 text-xs uppercase tracking-wide">Total Spent</span>
                                <p className="font-bold text-indigo-900 text-lg">{formatCurrencyString(adminApprovedOverviewFiltered.reduce((sum, b) => sum + b.spent, 0), { digits: 0 })}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                <span className="text-indigo-600 text-xs uppercase tracking-wide">Remaining</span>
                                <p className="font-bold text-indigo-900 text-lg">{formatCurrencyString(adminApprovedOverviewFiltered.reduce((sum, b) => sum + (b.monthlyLimit - b.spent), 0), { digits: 0 })}</p>
                            </div>
                        </div>

                        {adminApprovedOverviewFiltered.length > 0 && (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Category</th>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Period</th>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Tier</th>
                                            <th className="px-3 py-2 text-right font-medium text-slate-700">Limit</th>
                                            <th className="px-3 py-2 text-right font-medium text-slate-700">Spent</th>
                                            <th className="px-3 py-2 text-right font-medium text-slate-700">Remaining</th>
                                            <th className="px-3 py-2 text-center font-medium text-slate-700">Utilization</th>
                                            <th className="px-3 py-2 text-center font-medium text-slate-700">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {adminApprovedOverviewFiltered.map((b) => {
                                            const remaining = b.monthlyLimit - b.spent;
                                            const percentage = b.monthlyLimit > 0 ? (b.spent / b.monthlyLimit) * 100 : 0;
                                            const periodLabel = (b.period ?? 'monthly') === 'yearly' ? 'Yearly' : (b.period ?? 'monthly') === 'weekly' ? 'Weekly' : (b.period ?? 'monthly') === 'daily' ? 'Daily' : 'Monthly';
                                            const limitWithUnit = (b.period ?? 'monthly') === 'yearly'
                                                ? `${formatCurrencyString(b.limit, { digits: 0 })}/yr`
                                                : (b.period ?? 'monthly') === 'weekly'
                                                ? `${formatCurrencyString(b.limit, { digits: 0 })}/wk`
                                                : (b.period ?? 'monthly') === 'daily'
                                                ? `${formatCurrencyString(b.limit, { digits: 0 })}/day`
                                                : `${formatCurrencyString(b.limit, { digits: 0 })}/mo`;
                                            const canEditRemove = !b.id.startsWith('synthetic-') && !b.id.startsWith('approved-request-');
                                            return (
                                                <tr key={`admin-budget-${b.id}`} className="border-t border-slate-100">
                                                    <td className="px-3 py-2 font-medium text-slate-900">
                                                        <span className="inline-flex items-center gap-1">{b.category}<InfoHint text={getCategoryHint(b.category)} placement="bottom" /></span>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{periodLabel}</span>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <span className={`text-xs px-2 py-0.5 rounded ${b.budgetTier === 'Core' ? 'bg-indigo-100 text-indigo-800' : b.budgetTier === 'Supporting' ? 'bg-cyan-100 text-cyan-800' : 'bg-slate-100 text-slate-700'}`}>
                                                            {b.budgetTier}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{limitWithUnit}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyString(b.spent, { digits: 0 })}</td>
                                                    <td className={`px-3 py-2 text-right tabular-nums ${remaining >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {remaining >= 0 ? formatCurrencyString(remaining, { digits: 0 }) : `-${formatCurrencyString(Math.abs(remaining), { digits: 0 })}`}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                <div className={`h-full ${percentage > 100 ? 'bg-rose-500' : percentage > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
                                                            </div>
                                                            <span className={`text-xs ${percentage > 100 ? 'text-rose-600 font-medium' : percentage > 90 ? 'text-amber-600' : 'text-slate-600'}`}>
                                                                {percentage.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        {canEditRemove ? (
                                                            <div className="flex items-center justify-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenModal({ ...b, limit: b.displayLimit })}
                                                                    className="p-1.5 text-slate-500 hover:text-indigo-600 rounded"
                                                                    title="Edit"
                                                                >
                                                                    <PencilIcon className="h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { if (window.confirm(`Remove budget "${b.category}" for ${MONTHS[b.month - 1]} ${b.year}?`)) deleteBudget(b.category, b.month, b.year); }}
                                                                    className="p-1.5 text-slate-500 hover:text-rose-600 rounded"
                                                                    title="Remove"
                                                                >
                                                                    <TrashIcon className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {adminApprovedOverviewFiltered.length === 0 && (
                            <p className="text-sm text-slate-500 py-3">No budgets match the selected filters for {MONTHS[approvedOverviewMonth - 1]} {approvedOverviewYear}. Adjust filters or use Household Engine → Bulk add budgets.</p>
                        )}
                    </div>

                    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                        <h3 className="text-sm font-semibold text-emerald-900 mb-2">Shared Account Transaction Tracking</h3>
                        <p className="text-xs text-emerald-700 mb-3">
                            Transactions from shared accounts that affect shared budgets are tracked below. Approved transactions are deducted from budget totals.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-4">
                            <div className="bg-white rounded-lg p-3 border border-emerald-100">
                                <span className="text-emerald-600 text-xs uppercase tracking-wide">Approved Shared Tx</span>
                                <p className="font-bold text-emerald-900 text-lg">
                                    {ownerSharedTransactions.filter(tx => (tx.status ?? 'Approved') === 'Approved').length}
                                </p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-emerald-100">
                                <span className="text-emerald-600 text-xs uppercase tracking-wide">Pending Shared Tx</span>
                                <p className="font-bold text-emerald-900 text-lg">
                                    {ownerSharedTransactions.filter(tx => (tx.status ?? 'Approved') === 'Pending').length}
                                </p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border border-emerald-100">
                                <span className="text-emerald-600 text-xs uppercase tracking-wide">Total from Shared</span>
                                <p className="font-bold text-emerald-900 text-lg">
                                    {formatCurrencyString(
                                        ownerSharedTransactions
                                            .filter(tx => (tx.status ?? 'Approved') === 'Approved')
                                            .reduce((sum, tx) => sum + txAmountSar(tx), 0),
                                        { digits: 0 }
                                    )}
                                </p>
                            </div>
                        </div>

                        {ownerSharedTransactions.length > 0 && (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Date</th>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Category</th>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Contributor</th>
                                            <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                                            <th className="px-3 py-2 text-right font-medium text-slate-700">Amount</th>
                                            <th className="px-3 py-2 text-center font-medium text-slate-700">Deducted</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ownerSharedTransactions
                                            .sort((a, b) => new Date(b.transaction_date || b.date).getTime() - new Date(a.transaction_date || a.date).getTime())
                                            .map((tx, idx) => {
                                                const isApproved = (tx.status ?? 'Approved') === 'Approved';
                                                const isPending = (tx.status ?? 'Approved') === 'Pending';
                                                return (
                                                    <tr key={`shared-tx-${tx.id || idx}`} className="border-t border-slate-100">
                                                        <td className="px-3 py-2">{new Date(tx.transaction_date || tx.date).toLocaleDateString()}</td>
                                                        <td className="px-3 py-2 font-medium text-slate-900">{tx.budget_category}</td>
                                                        <td className="px-3 py-2">{tx.contributor_email || tx.contributor_user_id || 'Contributor'}</td>
                                                        <td className="px-3 py-2">
                                                            <span className={`text-xs px-2 py-0.5 rounded ${isApproved ? 'bg-emerald-100 text-emerald-700' : isPending ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                                                                {tx.status ?? 'Approved'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrencyString(txAmountSar(tx), { digits: 0 })}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className={`text-xs ${isApproved ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                                                                {isApproved ? 'Yes' : 'No'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </SectionCard>
            )}

            {(ownerSharedTransactions.length > 0 || mySharedBudgetTransactions.length > 0) && (
                <SectionCard title="Shared Budget Transactions" collapsible collapsibleSummary="Shared tx" defaultExpanded>
                    <div className="mb-4">
                        <p className="text-xs text-slate-500 mb-3">
                            Default view is the <strong>current month</strong>. Use the month filter to view history. Track all transactions from shared accounts affecting your budgets; approved transactions are deducted from budget totals.
                        </p>
                        
                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Month:</label>
                                <input
                                    type="month"
                                    value={sharedTxMonthFilter}
                                    onChange={(e) => setSharedTxMonthFilter(e.target.value)}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setSharedTxMonthFilter(`${currentYear}-${String(currentMonth).padStart(2, '0')}`)}
                                    className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600"
                                >
                                    Current
                                </button>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Status:</label>
                                <select
                                    value={sharedTxStatusFilter}
                                    onChange={(e) => setSharedTxStatusFilter(e.target.value as 'All' | 'Approved' | 'Pending' | 'Rejected')}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                >
                                    <option value="All">All</option>
                                    <option value="Approved">Approved</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Rejected">Rejected</option>
                                </select>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-600 font-medium">Category:</label>
                                <select
                                    value={sharedTxCategoryFilter}
                                    onChange={(e) => setSharedTxCategoryFilter(e.target.value)}
                                    className="p-1.5 border border-slate-300 rounded text-sm"
                                >
                                    <option value="All">All Categories</option>
                                    {[...new Set([...ownerSharedTransactions, ...mySharedBudgetTransactions].map(tx => tx.budget_category).filter(Boolean))].sort().map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        
                        {/* Stats Cards */}
                        {(() => {
                            const [filterYear, filterMonth] = sharedTxMonthFilter.split('-').map(Number);
                            const monthValid = Number.isFinite(filterYear) && Number.isFinite(filterMonth) && filterMonth >= 1 && filterMonth <= 12;
                            const filteredTxs = (ownerSharedTransactions.length > 0 ? ownerSharedTransactions : mySharedBudgetTransactions).filter((tx) => {
                                const txDate = new Date(tx.transaction_date || tx.date);
                                const matchesMonth = monthValid ? (txDate.getFullYear() === filterYear && txDate.getMonth() + 1 === filterMonth) : true;
                                const matchesStatus = sharedTxStatusFilter === 'All' || (tx.status ?? 'Approved') === sharedTxStatusFilter;
                                const matchesCategory = sharedTxCategoryFilter === 'All' || tx.budget_category === sharedTxCategoryFilter;
                                return matchesMonth && matchesStatus && matchesCategory;
                            });
                            
                            const approvedTotal = filteredTxs
                                .filter(tx => (tx.status ?? 'Approved') === 'Approved')
                                .reduce((sum, tx) => sum + txAmountSar(tx), 0);
                            const pendingTotal = filteredTxs
                                .filter(tx => (tx.status ?? 'Approved') === 'Pending')
                                .reduce((sum, tx) => sum + txAmountSar(tx), 0);
                            
                            return (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                                        <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                                            <span className="text-emerald-600 text-xs uppercase tracking-wide">Approved</span>
                                            <p className="font-bold text-emerald-900 text-lg">{formatCurrencyString(approvedTotal, { digits: 0 })}</p>
                                            <span className="text-xs text-emerald-600">{filteredTxs.filter(tx => (tx.status ?? 'Approved') === 'Approved').length} transactions</span>
                                        </div>
                                        <div className="bg-amber-50 rounded-lg p-2 border border-amber-100">
                                            <span className="text-amber-600 text-xs uppercase tracking-wide">Pending</span>
                                            <p className="font-bold text-amber-900 text-lg">{formatCurrencyString(pendingTotal, { digits: 0 })}</p>
                                            <span className="text-xs text-amber-600">{filteredTxs.filter(tx => (tx.status ?? 'Approved') === 'Pending').length} transactions</span>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                            <span className="text-slate-600 text-xs uppercase tracking-wide">Total Transactions</span>
                                            <p className="font-bold text-slate-900 text-lg">{filteredTxs.length}</p>
                                            <span className="text-xs text-slate-600">Showing filtered</span>
                                        </div>
                                        <div className="bg-primary/5 rounded-lg p-2 border border-primary/10">
                                            <span className="text-primary text-xs uppercase tracking-wide">Deducted from Budget</span>
                                            <p className="font-bold text-primary text-lg">{formatCurrencyString(approvedTotal, { digits: 0 })}</p>
                                            <span className="text-xs text-primary/80">Approved only</span>
                                        </div>
                                    </div>
                                    
                                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-slate-50">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-slate-700">Date</th>
                                                    <th className="px-3 py-2 text-left font-medium text-slate-700">Category</th>
                                                    <th className="px-3 py-2 text-left font-medium text-slate-700">Contributor</th>
                                                    <th className="px-3 py-2 text-left font-medium text-slate-700">Description</th>
                                                    <th className="px-3 py-2 text-center font-medium text-slate-700">Status</th>
                                                    <th className="px-3 py-2 text-center font-medium text-slate-700">Deducted</th>
                                                    <th className="px-3 py-2 text-right font-medium text-slate-700">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredTxs.length > 0 ? (
                                                    filteredTxs.sort((a, b) => new Date(b.transaction_date || b.date).getTime() - new Date(a.transaction_date || a.date).getTime()).map((tx, idx) => {
                                                        const isApproved = (tx.status ?? 'Approved') === 'Approved';
                                                        const isPending = (tx.status ?? 'Approved') === 'Pending';
                                                        return (
                                                            <tr key={`${tx.source_transaction_id || idx}`} className="border-t border-slate-100 hover:bg-slate-50">
                                                                <td className="px-3 py-2">{new Date(tx.transaction_date || tx.date).toLocaleDateString()}</td>
                                                                <td className="px-3 py-2 font-medium text-slate-900">{tx.budget_category}</td>
                                                                <td className="px-3 py-2">{tx.contributor_email || tx.contributor_user_id || 'Contributor'}</td>
                                                                <td className="px-3 py-2 text-slate-500">{tx.description || '—'}</td>
                                                                <td className="px-3 py-2 text-center">
                                                                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${isApproved ? 'bg-emerald-100 text-emerald-700' : isPending ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                                                                        {tx.status ?? 'Approved'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-center">
                                                                    <span className={`text-xs ${isApproved ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                                                                        {isApproved ? 'Yes' : 'No'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrencyString(txAmountSar(tx), { digits: 0 })}</td>
                                                            </tr>
                                                        );
                                                    })
                                                ) : (
                                                    <tr>
                                                        <td colSpan={7} className="px-3 py-4 text-center text-slate-500">No transactions found for selected filters</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </SectionCard>
            )}

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {orderedBudgetData.map((budget) => (
                    <button
                        key={budget.id}
                        type="button"
                        className={`text-left bg-gradient-to-br from-white via-slate-50 to-primary/5 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 flex flex-col border border-slate-100 ${expandedCards[budget.id] ? 'md:col-span-2' : ''}`}
                        onClick={() => {
                            if (triggerPageAction) {
                                const periodTag = budgetView.toLowerCase();
                                triggerPageAction('Transactions', `filter-by-budget:${budget.category}:${periodTag}:${budget.year || currentYear}:${budget.month || currentMonth}`);
                            }
                        }}
                    >
                        <div className="flex-grow">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-lg font-semibold text-dark inline-flex items-center gap-1">
                                    {budget.category}
                                    <InfoHint text={getCategoryHint(budget.category)} placement="bottom" />
                                </h3>
                                <span className={`text-[11px] px-2 py-1 rounded ${budget.budgetTier === 'Core' ? 'bg-indigo-100 text-indigo-800' : budget.budgetTier === 'Supporting' ? 'bg-cyan-100 text-cyan-800' : 'bg-slate-100 text-slate-700'}`}>{budget.budgetTier}</span>
                            </div>
                            <div className="mt-4">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-medium text-secondary">{formatCurrencyString(budget.spent, { digits: 0 })}</span>
                                    <span className="text-sm text-gray-500">/ {formatCurrencyString(budget.monthlyLimit, { digits: 0 })}{budgetView === 'Yearly' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/yr)` : budget.period === 'yearly' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/yr)` : budget.period === 'weekly' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/wk)` : budget.period === 'daily' ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/day)` : ''}</span>
                                </div>
                                <ProgressBar value={budget.spent} max={budgetView === 'Yearly' ? (budget.limit ?? 1) : (budget.monthlyLimit ?? 1)} color={budget.colorClass} />
                                <p className={`text-right text-sm mt-1 ${(budgetView === 'Yearly' ? budget.limit - budget.spent : budget.monthlyLimit - budget.spent) >= 0 ? 'text-gray-600' : 'text-danger font-medium'}`}>
                                    {(budgetView === 'Yearly' ? budget.limit - budget.spent : budget.monthlyLimit - budget.spent) >= 0 
                                        ? `${formatCurrencyString(budgetView === 'Yearly' ? budget.limit - budget.spent : budget.monthlyLimit - budget.spent, { digits: 0 })} remaining`
                                        : `${formatCurrencyString(Math.abs(budgetView === 'Yearly' ? budget.limit - budget.spent : budget.monthlyLimit - budget.spent), { digits: 0 })} over`
                                    }
                                </p>
                                <div className="mt-2 flex items-center justify-between text-xs">
                                    <span className={`px-2 py-1 rounded ${budget.utilizationLabel === 'Critical' ? 'bg-rose-100 text-rose-800' : budget.utilizationLabel === 'Watch' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{budget.utilizationLabel}</span>
                                    <span className={budget.trendDirection === 'up' ? 'text-rose-600' : budget.trendDirection === 'down' ? 'text-emerald-600' : 'text-gray-500'}>
                                        {budget.trendDirection === 'up' ? '↑' : budget.trendDirection === 'down' ? '↓' : '→'} {formatCurrencyString(Math.abs(budget.trendDelta ?? 0), { digits: 0 })} vs previous
                                    </span>
                                </div>
                            </div>
                        </div>
                         <div className="border-t mt-4 pt-2 flex justify-end items-center space-x-2">
                            <button type="button" onClick={() => toggleBudgetCardSize(budget.id)} className="p-2 text-gray-400 hover:text-primary" title={expandedCards[budget.id] ? 'Compact card' : 'Expand card'} aria-label={expandedCards[budget.id] ? 'Compact card' : 'Expand card'}>
                                <ChevronRightIcon className={`h-4 w-4 transition-transform ${expandedCards[budget.id] ? 'rotate-90' : ''}`} />
                            </button>
                            <button
                                type="button"
                                disabled={budgetView === 'Yearly'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenModal({ ...budget, limit: budget.displayLimit });
                                }}
                                className="p-2 text-gray-400 hover:text-primary disabled:opacity-40"
                            >
                                <PencilIcon className="h-4 w-4"/>
                            </button>
                            <button
                                type="button"
                                disabled={!isAdmin || budgetView === 'Yearly'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteBudget(budget.category, budget.month, budget.year);
                                }}
                                className="p-2 text-gray-400 hover:text-danger disabled:opacity-40"
                            >
                                <TrashIcon className="h-4 w-4"/>
                            </button>
                        </div>
                    </button>
                ))}
            </div>
             {budgetData.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                    <p className="text-gray-500">No budgets set for this month.</p>
                    {setActivePage && (
                        <p className="mt-2 text-sm text-slate-600">
                            Add a budget above, or{' '}
                            <button type="button" onClick={() => setActivePage('Transactions')} className="text-primary font-medium hover:underline inline-flex items-center gap-1.5">
                                <CreditCardIcon className="h-4 w-4" />
                                track spending in Cash Flow
                            </button>
                            {' '}to compare later on the Plan page.
                        </p>
                    )}
                </div>
            )}

            <BudgetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveBudget} budgetToEdit={budgetToEdit} currentMonth={currentMonth} currentYear={currentYear} />
            {suggestedAdjustments && (
                <Modal isOpen onClose={() => { trackSuggestionFeedback('budget-suggested-adjustments', 'Budgets', false); setSuggestedAdjustments(null); }} title="Suggested budget adjustments">
                    <p className="text-sm text-slate-600 mb-4">Based on your spending history. Apply to update limits.</p>
                    <ul className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                        {suggestedAdjustments.map(({ orig, proposed }) => (
                            <li key={orig.id ?? orig.category} className="flex justify-between items-center text-sm">
                                <span className="font-medium">{orig.category}</span>
                                <span>
                                    <span className="text-slate-500 line-through">{formatCurrencyString(orig.limit)}</span>
                                    {' → '}
                                    <span className="text-emerald-600 font-medium">{formatCurrencyString(proposed.limit)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => { trackSuggestionFeedback('budget-suggested-adjustments', 'Budgets', false); setSuggestedAdjustments(null); }} className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                        <button type="button" onClick={applySuggestedAdjustments} className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90">Apply all</button>
                    </div>
                </Modal>
            )}
        </PageLayout>
    );
};

export default Budgets;
