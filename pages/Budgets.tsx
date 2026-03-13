import React, { useMemo, useState, useContext, useEffect } from 'react';
import ProgressBar from '../components/ProgressBar';
import { DataContext } from '../context/DataContext';
import Modal from '../components/Modal';
import { Budget, type Page } from '../types';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { DocumentDuplicateIcon } from '../components/icons/DocumentDuplicateIcon';
import Combobox from '../components/Combobox';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import { AuthContext } from '../context/AuthContext';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import {
    buildHouseholdBudgetPlan,
    buildHouseholdEngineInputFromData,
    HOUSEHOLD_ENGINE_PROFILES,
    HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS,
    type HouseholdEngineProfile,
    type HouseholdMonthlyOverride,
} from '../services/householdBudgetEngine';
import {
    predictFutureMonths,
    analyzeScenario,
    generateCommonScenarios,
    detectAnomalies,
    type PredictiveForecast,
    type ScenarioAnalysis,
    type BudgetAnomaly,
} from '../services/householdBudgetAnalytics';



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
            setCategory('');
            setLimit('');
            setLimitPeriod('Monthly');
            setTier('Optional');
        }
    }, [budgetToEdit, isOpen]);

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
        onClose();
    };
    


    return (
        <Modal isOpen={isOpen} onClose={onClose} title={budgetToEdit ? 'Edit Budget' : 'Add Budget'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700 flex items-center">Category <InfoHint text="Budget category (e.g. Food, Housing). One budget per category per month; spending is tracked against this." /></label>
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
}

const Budgets: React.FC<BudgetsProps> = ({ triggerPageAction }) => {
    const { data, loading, dataResetKey, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrencyString } = useFormatCurrency();
    const [isAdmin, setIsAdmin] = useState(false);
    const [permittedCategories, setPermittedCategories] = useState<string[]>([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [requestAmount, setRequestAmount] = useState('');
    const [requestAmountPeriod, setRequestAmountPeriod] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [requestNote, setRequestNote] = useState('');
    const [requestType, setRequestType] = useState<'NewCategory' | 'IncreaseLimit'>('NewCategory');
    const [requestCategoryId, setRequestCategoryId] = useState('');
    const [governanceCategories, setGovernanceCategories] = useState<Array<{ id: string; name: string; monthly_limit?: number }>>([]);
    const [budgetRequests, setBudgetRequests] = useState<any[]>([]);
    const [requestSearch, setRequestSearch] = useState('');
    const [requestSort, setRequestSort] = useState<'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow'>('Newest');
    const [requestStatusFilter, setRequestStatusFilter] = useState<'All' | 'Pending' | 'Finalized' | 'Rejected'>('All');
    const [historyItemsToShow, setHistoryItemsToShow] = useState(10);
    const [historyCollapsed, setHistoryCollapsed] = useState(true);
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
    const [predictiveForecasts, setPredictiveForecasts] = useState<PredictiveForecast[]>([]);
    const [scenarios, setScenarios] = useState<ScenarioAnalysis[]>([]);
    const [anomalies, setAnomalies] = useState<BudgetAnomaly[]>([]);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
                if (parsed?.profile && ['Conservative', 'Moderate', 'Growth'].includes(parsed.profile)) {
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
                if (profile?.profile && ['Conservative', 'Moderate', 'Growth'].includes(profile.profile)) {
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
        const incomeByMonth = Array(12).fill(0);
        (data?.transactions ?? []).forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== currentYear || t.type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
        });
        const incomeWithData = incomeByMonth.filter((v) => v > 0);
        const suggested = incomeWithData.length > 0 ? Math.round(incomeWithData.reduce((a, b) => a + b, 0) / incomeWithData.length) : 0;

        const input = buildHouseholdEngineInputFromData(
            (data?.transactions ?? []) as Array<{ date: string; type?: string; amount?: number }>,
            (data?.accounts ?? []) as Array<{ type?: string; balance?: number }>,
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
        return buildHouseholdBudgetPlan(input);
    }, [data?.transactions, data?.accounts, data?.goals, currentYear, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary]);

    const suggestedMonthlySalary = useMemo(() => {
        const incomeByMonth = Array(12).fill(0);
        (data?.transactions ?? []).forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== currentYear || t.type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
        });
        const withData = incomeByMonth.filter((v) => v > 0);
        return withData.length > 0 ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;
    }, [data?.transactions, currentYear]);


    React.useEffect(() => {
        const riskProfile = String((data as any)?.settings?.riskProfile || '').toLowerCase();
        if (engineProfile === 'Moderate') {
            if (riskProfile.includes('conservative')) setEngineProfile('Conservative');
            if (riskProfile.includes('aggressive') || riskProfile.includes('growth')) setEngineProfile('Growth');
        }
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

        (data?.transactions ?? [])
            .filter((t) => t.type === 'expense' && (t.status ?? 'Approved') === 'Approved' && !!t.budgetCategory)
            .forEach((t) => {
                const txDate = new Date(t.date);
                const amount = Math.abs(t.amount);
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
            const amount = Math.abs(Number(tx.amount) || 0);
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

        const scopedBudgets = [...ownScopedBudgets, ...syntheticRestrictedBudgets];

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
    }, [data?.transactions, data?.budgets, currentYear, currentMonth, isAdmin, permittedCategories, budgetView, ownerSharedTransactions, governanceCategories, auth?.user?.id]);

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
                const amount = Math.abs(Number(tx.amount) || 0);
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
                const amount = Math.abs(Number(tx.amount) || 0);
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
    }, [sharedBudgets, mySharedBudgetTransactions, ownerSharedTransactions, sharedConsumedByOwnerCategory, budgetView, currentYear, currentMonth, auth?.user?.id]);

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

    const updateMonthlyOverride = (month: number, patch: Partial<HouseholdMonthlyOverride>) => {
        setHouseholdOverrides((prev) => {
            const existing = prev.find((o) => o.month === month) || { month };
            const next = { ...existing, ...patch };
            const merged = [...prev.filter((o) => o.month !== month), next].sort((a, b) => a.month - b.month);
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
        const allTx = (data?.transactions ?? []).filter((t) => t.type === 'expense' && !!t.budgetCategory);
        if (allTx.length === 0) {
            alert('No expense history with budget categories found to smart-fill from.');
            return;
        }
        const now = new Date(currentYear, currentMonth - 1, 1);
        const threeMonthsAgo = new Date(now);
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const byCategory = new Map<string, { total: number; months: Set<string> }>();
        allTx.forEach((t) => {
            const d = new Date(t.date);
            if (d < threeMonthsAgo || d > now) return;
            const cat = t.budgetCategory!;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const entry = byCategory.get(cat) || { total: 0, months: new Set<string>() };
            entry.total += Math.abs(t.amount);
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

        if (requestType === 'IncreaseLimit' && !requestCategoryId) {
            alert('Please select a category for an increase request.');
            return;
        }

        const selectedCategoryName =
            requestType === 'IncreaseLimit' && requestCategoryId
                ? (availableIncreaseCategories.find((opt) => opt.value === requestCategoryId)?.category ??
                   (requestCategoryId.startsWith('OWN::') ? requestCategoryId.replace('OWN::', '') : ''))
                : '';

        const duplicateMatch = budgetRequests.some((r) => {
            if (r.status !== 'Pending' || r.request_type !== requestType) return false;
            if (requestType === 'NewCategory') {
                return String(r.category_name || '').trim().toLowerCase() === newCategoryName.trim().toLowerCase();
            }
            // IncreaseLimit: match by category_id when present, otherwise by category_name for shared-category requests
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

        const periodTag = requestAmountPeriod === 'Monthly'
            ? ''
            : `[Requested period: ${requestAmountPeriod}; Raw: ${enteredAmount}]`;
        const mergedNote = [periodTag, requestNote.trim()].filter(Boolean).join(' ').trim() || null;

        const isSharedSelection = requestType === 'IncreaseLimit' && requestCategoryId.startsWith('SHARED::');

        const payloadBase = {
            user_id: auth.user.id,
            request_type: requestType,
            category_id: requestType === 'IncreaseLimit' && !isSharedSelection ? (requestCategoryId.replace('OWN::', '') || null) : null,
            category_name: requestType === 'NewCategory'
                ? newCategoryName.trim()
                : (requestType === 'IncreaseLimit' && isSharedSelection ? selectedCategoryName || null : null),
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

        const categoryLabel = resolveRequestCategory(request);
        if (!window.confirm(`Finalize ${request.request_type} for ${categoryLabel} with ${formatCurrencyString(amount, { digits: 0 })}?`)) {
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
        if (request.request_type === 'IncreaseLimit') {
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

        const { error: requestUpdateError } = await supabase
            .from('budget_requests')
            .update({ status: 'Finalized', amount })
            .eq('id', request.id);
        if (requestUpdateError) {
            alert(`Failed to finalize request: ${requestUpdateError.message}`);
            return;
        }

        setBudgetRequests(prev => prev.map((r) => r.id === request.id ? { ...r, status: 'Finalized', amount } : r));
        
        // Refresh budgets data to show newly created budgets from finalized requests
        // The DataContext will automatically refresh when budgets are added/updated via addBudget/updateBudget
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
            if (!normalizedQuery) return true;
            const combinedText = `${r.request_type} ${resolveRequestCategory(r)} ${r.note || ''} ${r.request_note || ''}`.toLowerCase();
            return combinedText.includes(normalizedQuery);
        });

        const sorted = [...filtered].sort((a, b) => {
            if (requestSort === 'Oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            if (requestSort === 'AmountHigh') return Number(b.amount || 0) - Number(a.amount || 0);
            if (requestSort === 'AmountLow') return Number(a.amount || 0) - Number(b.amount || 0);
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });

        return sorted;
    }, [budgetRequests, requestSearch, requestSort, requestStatusFilter, governanceCategories]);

    const pendingRequests = useMemo(() => sortedFilteredRequests.filter((r) => r.status === 'Pending'), [sortedFilteredRequests]);
    const allRespondedRequests = useMemo(() => budgetRequests.filter((r) => r.status !== 'Pending').sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()), [budgetRequests]);
    const visibleHistoryRequests = useMemo(() => allRespondedRequests.slice(0, historyItemsToShow), [allRespondedRequests, historyItemsToShow]);
    const hasMoreHistory = historyItemsToShow < allRespondedRequests.length;

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout
            title={`Budgets (${budgetView})`}
            description="Set limits by category and track spending. Core and essential categories feed into your emergency fund target (Summary & Dashboard)."
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
                    <button type="button" disabled={!isAdmin} onClick={handleSmartFillBudgets} className="btn-ghost flex items-center gap-2 disabled:opacity-50">
                        <SparklesIcon className="h-5 w-5" />
                        Smart-fill from history
                    </button>
                    <button type="button" disabled={!isAdmin} onClick={handleCopyBudgets} className="btn-ghost flex items-center gap-2 disabled:opacity-50"><DocumentDuplicateIcon className="h-5 w-5"/>Copy Last Month</button>
                    <button type="button" disabled={!isAdmin} onClick={() => handleOpenModal()} className="btn-primary disabled:opacity-50">Add Budget</button>
                </div>
            }
        >
            <div className={budgetSubPage === 'household' ? 'hidden' : 'space-y-6'}>
            <SectionCard>
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

            <SectionCard title="Budget Intelligence">
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

            {!isAdmin && (() => {
                const selectedCategoryName = (() => {
                    if (requestType !== 'IncreaseLimit' || !requestCategoryId) return '';
                    const fromOptions = availableIncreaseCategories.find((opt) => opt.value === requestCategoryId);
                    if (fromOptions) return fromOptions.category;
                    return requestCategoryId.startsWith('OWN::') ? requestCategoryId.replace('OWN::', '') : '';
                })();
                const currentBudgetRow = requestType === 'IncreaseLimit' && selectedCategoryName ? budgetData.find(b => b.category === selectedCategoryName) : null;
                const currentLimit = currentBudgetRow?.monthlyLimit ?? 0;
                const currentSpent = currentBudgetRow?.spent ?? 0;
                return (
                    <div className="bg-gradient-to-br from-white via-primary/5 to-indigo-50 rounded-lg shadow p-5 border border-primary/20">
                        <h2 className="text-lg font-semibold mb-3 flex items-center">Request Budget Change <InfoHint text="Submit new-category or limit-increase proposals with context notes for admin approval." /></h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Request type</label>
                                <select value={requestType} onChange={(e) => setRequestType(e.target.value as any)} className="w-full p-2 border rounded">
                                    <option value="NewCategory">New Category</option>
                                    <option value="IncreaseLimit">Increase Limit</option>
                                </select>
                            </div>
                            {requestType === 'NewCategory' ? (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Category name</label>
                                    <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Travel, Education" className="w-full p-2 border rounded" />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Category to increase</label>
                                    <select value={requestCategoryId} onChange={(e) => setRequestCategoryId(e.target.value)} className="w-full p-2 border rounded">
                                        <option value="">Select category</option>
                                        {availableIncreaseCategories.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    {currentBudgetRow && (
                                        <p className="mt-1 text-xs text-gray-600">Current limit: {formatCurrencyString(currentLimit, { digits: 0 })} · Spent this period: {formatCurrencyString(currentSpent, { digits: 0 })}</p>
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
                        <p className="mt-3 text-xs text-gray-500">Amounts are normalized to a monthly limit for approval. Duplicate pending requests for the same category are blocked. Admins also see the original amount and period.</p>
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
                                    <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
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
                                    <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
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
                                        <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
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
                                    {historyCollapsed ? '▼ Expand' : '▲ Collapse'}
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
                                                        <td className="py-2 px-2">{r.request_type}</td>
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
            <SectionCard title="Household Budget Engine">
                <p className="text-sm text-slate-700 font-medium">
                    Fully auto-builds from your transactions, accounts, goals, and risk profile to project monthly cash flow and goal routing. Manual inputs are optional overrides only.
                </p>
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
                        <p className="text-xs text-slate-500 mt-1 max-w-[200px]">{HOUSEHOLD_ENGINE_PROFILES[engineProfile].description}</p>
                        {householdBudgetEngine.suggestedProfile && householdBudgetEngine.suggestedProfile !== engineProfile && (
                            <p className="text-xs text-amber-700 mt-1">Suggested: {householdBudgetEngine.suggestedProfile} (income variance)</p>
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
                            {householdBudgetEngine.months.filter((m) => (m.validationErrors?.length || 0) > 0).slice(0, 3).map((m) => (
                                <li key={`vv-${m.month}`}>Month {m.month}: {(m.validationErrors || []).join(' ')}</li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="mt-4 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={async () => {
                            if (!isAdmin) {
                                alert('Only admins can create budgets from household engine.');
                                return;
                            }
                            if (!window.confirm(`This will create/update budgets for ${currentYear}-${currentMonth} based on the household engine output. Existing budgets for this month will be updated. Continue?`)) {
                                return;
                            }
                            const currentMonthPlan = householdBudgetEngine.months.find((m) => m.month === currentMonth);
                            if (!currentMonthPlan) {
                                alert('No household engine plan available for current month.');
                                return;
                            }
                            const buckets = currentMonthPlan.buckets || {};
                            const existingBudgets = (data?.budgets ?? []).filter((b) => b.year === currentYear && b.month === currentMonth);
                            const categoryMap: Record<string, string> = {
                                'Fixed Obligations': 'Housing',
                                'Household Essentials': 'Food',
                                'Household Operations': 'Utilities',
                                'Transport': 'Transportation',
                                'Personal Support': 'Personal Care',
                                'Reserve Savings': 'Savings & Investments',
                                'Emergency Savings': 'Savings & Investments',
                                'Goal Savings': 'Savings & Investments',
                                'Kids Future Savings': 'Education',
                                'Retirement Savings': 'Savings & Investments',
                                'Investing': 'Savings & Investments',
                            };
                            let created = 0;
                            let updated = 0;
                            for (const [bucketName, amount] of Object.entries(buckets)) {
                                if (!amount || amount <= 0) continue;
                                const category = categoryMap[bucketName] || bucketName;
                                const existing = existingBudgets.find((b) => b.category === category);
                                if (existing) {
                                    updateBudget({ ...existing, limit: amount });
                                    updated++;
                                } else {
                                    addBudget({
                                        category,
                                        limit: amount,
                                        month: currentMonth,
                                        year: currentYear,
                                        period: 'monthly',
                                        tier: ['Fixed Obligations', 'Household Essentials', 'Household Operations', 'Transport'].includes(bucketName) ? 'Core' : 'Optional',
                                    });
                                    created++;
                                }
                            }
                            alert(`Household engine budgets applied: ${created} created, ${updated} updated.`);
                        }}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!isAdmin}
                    >
                        Apply Household Engine Budgets to Current Month
                    </button>
                    <InfoHint text="Creates or updates budgets for the current month based on household engine calculations. Only admins can trigger this." />
                </div>
                <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50">
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
                                        return (
                                            <tr key={`hh-month-${month}`} className="border-b border-slate-100">
                                                <td className="py-1 pr-2">{label}</td>
                                                <td className="py-1 pr-2"><input type="number" value={ov?.salary ?? ''} onChange={(e) => updateMonthlyOverride(month, { salary: Number(e.target.value) || undefined })} className="w-20 p-1 border rounded" /></td>
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

            <SectionCard title="Budget sharing">
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

                                        <h4 className="mt-3 text-base font-semibold text-slate-900">{budget.category}</h4>

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
                <SectionCard title="Admin: Approved Budgets & Shared Account Tracking">
                    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                        <h3 className="text-sm font-semibold text-indigo-900 mb-2">Approved Budgets Overview</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                            <div>
                                <span className="text-indigo-600">Total Approved Budgets:</span>
                                <span className="font-semibold text-indigo-900 ml-2">{budgetData.filter(b => b.spent > 0 || b.monthlyLimit > 0).length}</span>
                            </div>
                            <div>
                                <span className="text-indigo-600">Total Budget Limit:</span>
                                <span className="font-semibold text-indigo-900 ml-2">{formatCurrencyString(budgetData.reduce((sum, b) => sum + b.monthlyLimit, 0), { digits: 0 })}</span>
                            </div>
                            <div>
                                <span className="text-indigo-600">Total Spent:</span>
                                <span className="font-semibold text-indigo-900 ml-2">{formatCurrencyString(budgetData.reduce((sum, b) => sum + b.spent, 0), { digits: 0 })}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                        <h3 className="text-sm font-semibold text-emerald-900 mb-2">Shared Account Transaction Tracking</h3>
                        <p className="text-xs text-emerald-700 mb-2">
                            Transactions from shared accounts that affect shared budgets are tracked below. Only approved transactions are counted in budget totals.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div>
                                <span className="text-emerald-600">Shared Transactions (Owner View):</span>
                                <span className="font-semibold text-emerald-900 ml-2">{ownerSharedTransactions.filter(tx => (tx.status ?? 'Approved') === 'Approved').length}</span>
                            </div>
                            <div>
                                <span className="text-emerald-600">Total from Shared Accounts:</span>
                                <span className="font-semibold text-emerald-900 ml-2">
                                    {formatCurrencyString(
                                        ownerSharedTransactions
                                            .filter(tx => (tx.status ?? 'Approved') === 'Approved')
                                            .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0),
                                        { digits: 0 }
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>
                </SectionCard>
            )}

            {(ownerSharedTransactions.length > 0 || mySharedBudgetTransactions.length > 0) && (
                <SectionCard title="Shared-budget transaction visibility">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <p className="text-xs text-slate-500">
                            Owner view: you can see contributors' transactions for budgets you shared. Approved rows are counted in budget totals, while Pending rows stay visible for tracking.
                        </p>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-600 font-medium">Filter by month:</label>
                            <input
                                type="month"
                                value={sharedTxMonthFilter}
                                onChange={(e) => setSharedTxMonthFilter(e.target.value)}
                                className="p-1.5 border border-slate-300 rounded text-sm"
                            />
                        </div>
                    </div>
                    {(() => {
                        const [filterYear, filterMonth] = sharedTxMonthFilter.split('-').map(Number);
                        const filteredTxs = (ownerSharedTransactions.length > 0 ? ownerSharedTransactions : mySharedBudgetTransactions).filter((tx) => {
                            const txDate = new Date(tx.transaction_date || tx.date);
                            return txDate.getFullYear() === filterYear && txDate.getMonth() + 1 === filterMonth;
                        });
                        return (
                            <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Date</th>
                                            <th className="px-3 py-2 text-left">Category</th>
                                            <th className="px-3 py-2 text-left">Contributor</th>
                                            <th className="px-3 py-2 text-left">Description</th>
                                            <th className="px-3 py-2 text-left">Status</th>
                                            <th className="px-3 py-2 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTxs.length > 0 ? (
                                            filteredTxs.map((tx, idx) => (
                                                <tr key={`${tx.source_transaction_id || idx}`} className="border-t border-slate-100">
                                                    <td className="px-3 py-2">{new Date(tx.transaction_date || tx.date).toLocaleDateString()}</td>
                                                    <td className="px-3 py-2">{tx.budget_category}</td>
                                                    <td className="px-3 py-2">{tx.contributor_email || tx.contributor_user_id || 'Contributor'}</td>
                                                    <td className="px-3 py-2">{tx.description || '—'}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={`text-xs px-2 py-0.5 rounded ${(tx.status ?? 'Approved') === 'Approved' ? 'bg-emerald-100 text-emerald-700' : (tx.status ?? 'Approved') === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                                                            {tx.status ?? 'Approved'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyString(Math.abs(Number(tx.amount) || 0), { digits: 0 })}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">No transactions found for selected month</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}
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
                                <h3 className="text-lg font-semibold text-dark">{budget.category}</h3>
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
                </div>
            )}

            <BudgetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveBudget} budgetToEdit={budgetToEdit} currentMonth={currentMonth} currentYear={currentYear} />
        </PageLayout>
    );
};

export default Budgets;
