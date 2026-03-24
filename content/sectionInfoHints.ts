/**
 * Central registry for SectionCard hints — add or edit copy here instead of scattering long strings in TSX.
 * SectionCard resolves: explicit infoHint → infoHintKey → title match (incl. patterns) → hintPreset → default.
 */

export type SectionHintPreset =
  | 'dataDerived'
  | 'illustrative'
  | 'engine'
  | 'localDevice'
  | 'chart'
  | 'form';

const PRESETS: Record<SectionHintPreset, string> = {
  dataDerived:
    'Derived from your Finova data and settings. Updates when your data changes. Educational context only—not financial advice.',
  illustrative:
    'Illustrative model from your inputs; not a guarantee of future results or personalized advice.',
  engine:
    'Rule-based engine output from your portfolio and plan inputs. Use as a checklist; confirm decisions in context.',
  localDevice: 'Stored only on this browser/device—not synced to the server unless noted elsewhere.',
  chart: 'Visualization from your linked data. Use alongside tables and detail pages for decisions.',
  form: 'Edit values here; related pages and engines read these preferences where wired.',
};

/** Shown when a section has a title but no specific copy in the registry (opt-in via autoHint). */
export const DEFAULT_SECTION_HINT =
  'Section content reflects your Finova data or this screen’s defaults. Educational—not financial advice.';

/** Normalize section titles for lookup (lowercase, collapse spaces, straight quotes). */
export function normalizeSectionTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’‘]/g, "'");
}

/** Semantic keys for programmatic use (dynamic titles, tests). Prefix: `key.` */
export const SECTION_HINT_KEYS: Record<string, string> = {
  'key.forecast.scenarioComparison':
    'Run Conservative, Base, and Aggressive presets (adjust assumptions first) so each row fills in. Active preset is highlighted.',
  'key.recovery.holdingDetail':
    'Recovery actions and ladders for this holding—export or use as a checklist with your broker.',
};

/**
 * Primary map: normalized title → hint. Add new sections here (one line per unique title).
 */
const HINTS_BY_TITLE: Record<string, string> = {
  // Forecast
  'forecast methodology':
    'Deterministic model: starting net worth and investment balance use your current data (personal scope). Each month adds your savings contribution, then applies compound return on the full investment balance. Savings growth uses your annual % converted to an equivalent monthly step (smooth, not once per calendar year). Other assets, property, and liabilities are held constant after the starting snapshot—so long-horizon net worth is an approximation. Not financial advice.',
  'forecast assumptions':
    'Sliders drive the same projection engine: monthly compounding, annual investment return expressed as a monthly rate, and annual savings increase % applied smoothly each month. Compare presets and use Auto-fill from history for data-driven defaults.',
  'projection chart':
    'Net worth and investment value paths from your last Run Forecast. Dashed horizontal lines mark goal targets in currency space—rough guide only; use the Goals page for funding detail.',
  'goal outlook':
    'Checks whether projected net worth crosses a simple threshold from each goal’s current vs target amount—illustrative only; does not model day-by-day funding. Use the Goals page for detail.',
  'forecast confidence band':
    'Uncertainty band around projected net worth: wider when your 12‑month savings history is volatile or the horizon is long. Use low/base/high as a sanity check—not a formal statistical forecast.',
  'uncertainty band (heuristic)':
    'Low/base/high spread from your last run, scaled by savings volatility and horizon—illustrates sensitivity, not a statistical confidence interval.',
  results:
    'Appears before the first successful run in this session. Use Run Forecast after setting horizon, savings, and growth assumptions.',
  'stress test (illustrative)':
    'How to use: move the sliders to stress-test rough cash survival—months without income, a market shock applied to ~30% of liquid cash, and a one-off bill. Benefit: see whether your liquid balances and spending pace could cover a bad patch before you change real allocations. Uses your Checking+Savings total and a recent expense estimate from transactions. Strategy lens and lump sum vs DCA are short educational comparisons, not personalized advice.',
  'scenario timeline':
    'Story-style milestones from your last forecast run and goals (same horizon)—a readable narrative, not a separate simulation. Helps you spot when big funding or life events might intersect the path.',

  // Analysis
  'salary vs expense coverage':
    'Compares detected recurring income (largest monthly credits) to average external expenses over 6 months. Benefit: quick read on whether typical spend fits your salary signal—heuristic, not payroll-grade.',
  'spend intelligence':
    'Merchants, salary detection, subscription-like spend, and BNPL mentions from your transactions. Use to spot where money goes, recurring leaks, and data-quality follow-ups (categorize, verify).',
  'possible refund pairs':
    'Heuristic: expense and income with similar amounts within 14 days—often refunds or chargebacks. Verify in Transactions before relying on it for reconciliation.',
  'spending by budget category':
    'Distribution of categorized spend—see which budget buckets dominate and where to cut or reallocate.',
  'monthly income vs. expense':
    'Trend of income vs expenses over time—spot months you ran hot or built surplus; pairs with Forecast and Budgets.',
  'current financial position':
    'High-level assets vs liabilities view from your data—orientation for net worth before drilling into Accounts or Summary.',

  // Wealth Ultra
  'wealth ultra engine':
    'Central allocation workspace: combines your investments, investment plan, and accounts into targets, sleeve drift, suggested orders, and deployment. Use it to see what to rebalance, what cash can fund buys, and how policy (Core/Upside/Spec) lines up—not broker execution.',
  'alerts & recommendations':
    'Prioritized engine messages: drift, cash, concentration, and policy. Treat as a review queue—address critical items first, then warnings. Good for a weekly portfolio pass.',
  'engine intelligence & decision summary':
    'IQ score and ranked actions summarize drift, alerts, cash compliance, and spec discipline. Guardrails show whether key rules (e.g. cash, limits) are healthy—use to decide what to fix this cycle.',
  'sleeve allocation & drift analysis':
    'Current vs target weights for Core, Upside, and Spec. Drift above ~5% flags rebalancing need; aligns with Generated Orders and your plan targets.',
  'generated orders':
    'Suggested BUY/SELL limits from drift and policy. Export JSON or use as a checklist at your broker. Finova does not link to broker APIs — nothing is executed automatically.',
  'next move — monthly deployment':
    'How much the engine suggests deploying this month and optional focus ticker, consistent with deployable cash and your monthly plan. Use before you place trades.',
  'speculative sleeve status':
    'Whether speculative risk is within policy. Over limit or policy lock disables new Spec buys until allocation is back in range—protects concentration risk.',
  'all positions':
    'Holdings with sleeve, strategy mode, value, and P&L %. Sorted by return for quick review; pair with drift and alerts for what to trim or add.',
  'top gainers':
    'Largest positive P&L names—useful for reviewing winners; combine with concentration and targets before adding more size.',
  'top losers':
    'Largest negative P&L names—review your notes and risk tier before selling; may still be within plan if intentional.',
  'capital efficiency ranking':
    'Ranks positions by return adjusted for risk tier (higher tiers get more weight). Higher score = more return per unit of assumed risk—good for spotting efficient vs crowded names.',
  'exception history':
    'Recent critical/warning alerts stored on this device for audit—what changed in posture over time. Clears when no new exceptions.',
  'risk distribution':
    'Capital split across Low/Med/High/Spec tiers—sanity check for concentration and whether risk matches your intent.',

  // Safety & rules (Risk & Trading Hub)
  'months of expenses covered':
    'How many months your checking + savings could cover essential spending. A common target is 3–6 months.',
  'emergency runway':
    'Months of essential expenses covered by checking + savings (positive balances). From the same emergency fund logic as Goals and Dashboard.',
  'buy readiness':
    'A simple score from 0–100: higher = conditions are better for buying (e.g. enough runway).',
  'sample scores (rules)':
    'buyScore / sellScore from decisionEngine using your runway and sample position/cash needs. Tune gates in Settings → trading policy.',
  'your safety rules':
    'Rules you set to avoid impulsive trades. Edit in Settings.',
  'trading policy (this device)':
    'Runway, position caps, large-sell acknowledgment, and cashflow blocks. Presets apply conservative, moderate, or aggressive defaults. Changes auto-save to this browser after about 1.5 seconds. Record Trade and investment flows use these rules when you log activity.',
  'portfolio return (simplified)':
    'How your investments performed over time, considering deposits and withdrawals. Not audited.',
  'approx. mwrr (cashflows)':
    'Money-weighted style return from investment buy/sell flows and current holdings value. Simplified; not a certified performance report.',
  'why did net worth change?':
    'Breaks down your net worth change into: money you added/withdrew vs market moves and other changes.',
  'net worth attribution (dashboard snapshots)':
    'Needs two local snapshots (newest vs previous in list). Explains NW change as personal cashflows vs residual (markets, debt, other). Create snapshots from Dashboard (admin) or below.',
  'net worth snapshots':
    'Save snapshots of your net worth over time to compare and see how it changed.',
  'snapshots & history':
    'Snapshots are saved on this device. “Create snapshot now” stores today’s computed net worth. Use “Fill last 2 dates” to auto-select the two most recent snapshot days for compare.',
  'when to review':
    'Suggested checklists for different timeframes—daily, weekly, monthly, etc.',
  'review cadence':
    'Auto-built from your data: e.g. daily flags stale market data and debt stress; weekly flags uncategorized spend; monthly nudges snapshot + budget categories. No manual refresh button needed.',

  // Notes & ideas (Financial Journal)
  'add an investment idea':
    'Write why you bought it, when to check back, and what would change your mind. Helps you stay disciplined and avoid emotional trades. Stored only on this device.',
  'thesis tracker':
    'Write why you bought it, when to check back, and what would change your mind. Helps you stay disciplined. Stored only on this device.',
  'quick note':
    'Jot down a decision, reminder, or life event—anything you want to remember.',
  'your saved ideas':
    'Record actual return % and reflection when you sell. Helps you learn what worked and spot recurring mistakes.',
  'thesis review & outcomes':
    'Record actual return % and reflection when you sell. Helps you learn what worked.',
  'note history':
    'Chronological list of your notes. Browse past entries for accountability.',
  history:
    'Chronological list of your notes. Browse past entries for accountability.',
  'new entry':
    'Jot down a decision, reminder, or life event.',

  // Sell priority (Liquidation Planner)
  'your investments, ranked by review priority':
    'Higher scores indicate when you might want to look at trimming—e.g. if one holding is too big, or your notes say it\'s time to revisit. Not financial advice.',
  'ranked positions (higher = review trim first)':
    'Rule-based sell urgency from concentration, idea validity (Notes & ideas), and need-cash signals—higher score means review trimming first if you need liquidity or to reduce size. Positions with expired review dates get a boost. Not a recommendation to sell; confirm in Investments.',

  // Behind the numbers (Logic & Engines)
  'quick links':
    'Jump to related tools: Safety & rules, Forecast, Settings.',
  'how to use this page':
    'Everything here recalculates when your Finova data changes. Net worth snapshots (local) also refresh when you return to this tab. Use the (!) buttons on each card for what the numbers mean and limits. Not financial advice.',
  'returns & benchmarks':
    'Uses your last two saved net worth snapshots for simple return. Benchmark line uses a fixed 8% example unless you extend it. TWRR line is a small demo of linked sub-period returns. For full attribution, use Safety & rules.',
  'strategy comparison':
    'Ranks illustrative scenarios from your current net worth (not a forecast promise). Allocation models blend your plan core+upside weights with generic balanced/conservative examples.',
  'cash & liquidity':
    'Runway merges household stress + liquid cash vs expenses. Bucket demo uses a fixed SAR 5,000 surplus example; sweeps use inferred operating/reserve/investable buckets from your emergency fund and net worth.',
  fx: 'Currency mix is from checking/savings balances in your base currency today. The USD→SAR line is a fixed-rate illustration; live FX is in Currency settings and investment plan.',
  seasonality:
    'Adjusts this month’s expense using built-in seasonal patterns (e.g. tuition months). Tune by editing seasonality in Forecast/Plan flows later; here it’s automatic from defaults + your core monthly expense estimate.',
  'retirement & sensitivity':
    'Uses ~35% of net worth as retirement corpus placeholder, 3% inflation, 25 years, and your monthly plan budget as contribution. Sensitivity nudges expected return ±2% to show corpus range.',
  'insurance (baseline)':
    'Placeholder coverage needs vs empty policies—add real policies in your records to use renewal alerts. For carrier pricing, use external tools.',
  'probabilistic planning':
    'Monte Carlo uses seeded simulation for stable refresh. Needs at least one goal; uses goal savings % and plan monthly budget slice. p10/p50/p90 are outcome percentiles, not guarantees.',
  'planning assumptions':
    'Demo inflation/return knobs to show validateAssumptionsEngine. Replace with your Forecast assumptions when wiring settings.',
  'behavioral & explainability':
    'Plain-language buy/goal explanations from rule outputs. Cooldown and drawdown guards are samples—wire real last-trade dates in trading flows for production use.',
  'order planning (demo ladder)':
    'Example buy tranches at 0%, 5%, 10% below a notional $100 price. Record Trade uses related helpers for real symbols and sizes.',
  'ux guardrails':
    'Microcopy and validation helpers for forms. Reuse fieldHintEngine and userInputGuard on new modals for consistent UX.',
  'corporate actions (demo)':
    'Shows how a 2:1 split adjusts share count and average cost. Cash dividends leave quantity/cost unchanged in this simple model.',
  'risk lane':
    'Combines household cashflow stress, emergency months, and Wealth Ultra performance snapshots into Cautious / Balanced / Opportunity with a suggested risk profile.',
  'next best actions':
    'Prioritized suggestions from cross-engine signals (cash, goals, risk). Follow links to the right page; scores reflect urgency—tackle top items when you’re unsure what to do next.',
  'shock drill & scenario timeline':
    'Shock drill picks a template (e.g. market crash) and blends household budget + portfolio value deltas. Timeline is narrative from goals + horizon, not a second simulation.',
  'engine integration (cross-engine)':
    'buildUnifiedFinancialContext merges cash, risk, and household signals from your transactions, accounts, budgets, goals, and holdings—then runCrossEngineAnalysis emits alerts and recommendations.',
  'lifestyle guardrails & provisioning':
    'Gates discretionary spend when EF, runway, savings rate, or goal slippage fail thresholds. Provision line shows spreading a demo 6k cost over six months.',

  // Misc pages (common SectionCard titles)
  'statement history':
    'Parsed uploads and processing status—use to audit imports and re-open files.',
  'debt intelligence':
    'Heuristics from liabilities and cash—review minimums, rates, and stress alongside Accounts.',
  'what i owe': 'Active debts and negative balances you owe—tie to payoff plans on Liabilities.',
  "what i'm owed": 'Receivables and positive liability rows—follow up collections separately from spending.',
  'expense breakdown': 'Category mix from your filtered transactions—spot drivers of spend.',
  'transaction history':
    'Filtered ledger for the month and account. Transfers appear as two lines (out/income legs); they do not count in the Income / Expenses / Net Flow cards above—only external salary, spend, etc. Category Transfer or Transfers marks internal moves.',
  'zakatable assets': 'Items included in Zakat calculation per your settings—verify against Shariah guidance you follow.',
  'deductible liabilities': 'Offsets applied before net zakatable amount—confirm with your scholar or policy.',
  calculation: 'Computed zakatable amount from inputs—educational; confirm methodology with qualified guidance.',
  notifications:
    'Email summaries and in-app alerts driven by your budgets, goals, approvals, and data-quality checks. Toggle matches your Settings snapshot; enable weekly email when you want a scheduled digest.',
  'activity log (this device)': 'Local audit trail of creates/updates/deletes. Filter by entity, search, export CSV, or clear.',
  'reports & export': 'Backup and export options for your data.',
  'data management': 'Reset, import/export, and retention controls for your workspace.',
  'user profile': 'Identity and role used for admin features and approvals.',
  'user approvals': 'Pending signups or requests requiring admin action.',
  'financial preferences': 'Risk profile, budget/drift thresholds, presets. Guides AI and plan suggestions.',
  'enhanced default parameters': 'Advanced defaults for engines and forms.',
  'decision preview (rules)':
    'Live buy score and capital-rank preview: largest holding weight, max sleeve drift (same Core/Upside/Spec math as Wealth Ultra), trading policy max position, and runway. Financial preferences drift % is your alert threshold (shown under the sleeve drift tile). Lump-sum tracks ~15% of liquid until you edit it. Updates when data or settings change.',
  'settings snapshot': 'Quick read of key settings—open subsections to edit.',
  'overall goal progress': 'Aggregate progress across goals—drill into each goal for funding detail.',
  'savings allocation strategy': 'Suggested split across goals from engine heuristics—adjust to your priorities.',
  'system funding suggestions': 'Where extra cash might go first—suggestions only.',
  'funding waterfall (suggested order)': 'Priority order for applying surplus—customize on Goals.',
  'bonus / windfall allocation ideas': 'Ideas for one-off inflows—not automatic transfers.',
  'goal conflict & feasibility': 'Flags competing goals or impossible timelines—resolve tradeoffs on Goals.',

  // Investment Plan
  'control tower (household, budget & wealth ultra constraints)':
    'Cross-engine alerts: household cashflow, budget limits, and Wealth Ultra rules in one place—act on critical items first.',
  'how investment planning works':
    'Overview of monthly plan, planned trades, and how engines connect—read once when onboarding.',
  'strategy guides': 'Playbooks and constraints for how Finova suggests sizing and timing—educational.',
  'ai rebalance candidates': 'Symbols the AI or rules flag for rebalance—confirm in AI Rebalancer and Wealth Ultra.',
  'plan vs ai alignment': 'Compare your plan targets to AI-suggested weights—resolve gaps in Investments or plan.',
  'investment plans': 'Your saved monthly plans and scenarios—private per user.',
  'weak cashflow — pause low-priority funding?':
    'Signal that cashflow may not support all goals—review Budgets and income before cutting goals.',
  'budget intelligence': 'Forecasts and signals from budget engines—pair with Budgets tab actions.',
  'recurring bills & price benchmarks': 'Recurring spend detection and benchmark hints.',
  'cashflow signals (household & budget engines)': 'Household stress and budget variance signals in one view.',
  'household budget engine': 'Bulk templates and engine-driven budget updates—scoped to household tab.',
  'budget sharing': 'Shared categories and visibility—coordinate with co-managers.',
  'admin: approved budgets & shared account tracking': 'Admin view of approved requests and shared account links.',
  'shared budget transactions': 'Mirror of spend against shared categories—filter by month and status.',
  'recovery plan performance statistics': 'Track recovery ladder and performance for qualifying positions.',
  'positions in loss': 'Holdings underwater—use Recovery Plan tools to plan next steps.',
  'draft orders (export to broker)': 'Suggested orders from recovery/draft flows—export JSON; not sent to a broker.',
  'plan health': 'Checks plan vs portfolio and constraints—fix issues in Investment Plan and Investments.',
  'section temporarily unavailable': 'This block failed to load or is gated—retry or navigate elsewhere.',
  'execution history': 'Record of trades or executions you logged—audit trail for review.',
  'physical assets': 'Property, vehicles, and non-broker assets—feeds net worth on Summary.',
  'sukuk in finova': 'Sukuk holdings and income—track separately from equities where applicable.',
  'salary & planning experts':
    'Seven AI planners for salary, cash flow, wealth, debt, automation, independence, and lifestyle. Fields prefill from Transactions, Budgets, Goals, Investment Plan, and Liabilities when available—edit before Run analysis. Use Copy prompt to paste into any chat. Outputs are educational—not financial advice.',
  'salary allocation expert':
    'Splits your take-home into essentials, savings, investing, and discretionary spend from your numbers and main goal. Good for a monthly budget envelope. Verify amounts against your real bills.',
  'cash flow analyst':
    'Reads your expense breakdown and savings rate, then suggests structural changes (not just “spend less”). More accurate with a detailed category list.',
  '5-year wealth growth plan':
    'Illustrative compounding over five years from salary, monthly investment, and net worth. Uses conservative-to-moderate return assumptions—treat as a scenario, not a forecast.',
  'debt elimination strategy':
    'Compares payoff paths (e.g. avalanche vs snowball) from your debt list. Add interest rates for the most accurate ordering; missing rates are guessed by the model.',
  'salary → investment automation':
    'Designs a boring, repeatable monthly invest-from-salary workflow and asset mix by risk. Saudi-aware examples (Sukuk, funds, ETFs) may appear in the answer—confirm products with your broker or advisor.',
  'financial freedom / independence timeline':
    'Uses FIRE-style math (expenses × portfolio multiple, safe withdrawal) with simplified growth assumptions. Timeline is illustrative; taxes and life changes are not modeled in full.',
  'lifestyle upgrade without slowing wealth':
    'Proposes swaps that raise daily satisfaction while keeping or improving your savings rate—often cutting low-joy spend first. Needs honest salary and expense inputs.',
  'we recovered from a page error': 'The app caught an error here; you can recover or reload. Report if it persists.',
  'system recovery mode': 'A global error was handled—navigation and data may be limited until refresh.',
};

function matchPatternHint(title: string): string | undefined {
  const n = normalizeSectionTitle(title);
  if (/^scenario comparison \(\d+-year horizon\)$/.test(n)) {
    return SECTION_HINT_KEYS['key.forecast.scenarioComparison'];
  }
  if (/—\s.+recovery plan$/.test(n)) {
    return SECTION_HINT_KEYS['key.recovery.holdingDetail'];
  }
  return undefined;
}

export function lookupHintForTitle(title: string | undefined): string | undefined {
  if (!title || !title.trim()) return undefined;
  const direct = HINTS_BY_TITLE[normalizeSectionTitle(title)];
  if (direct) return direct;
  return matchPatternHint(title);
}

export function resolveSectionInfoHint(options: {
  title?: string;
  /** Explicit override (highest priority after noHint). */
  infoHint?: string;
  /** Registry key: `SECTION_HINT_KEYS` or `HINTS_BY_TITLE` normalized title. */
  infoHintKey?: string;
  hintPreset?: SectionHintPreset;
  /** Opt out of any hint. */
  noHint?: boolean;
  /**
   * When true (default), titled sections without a registry hit show DEFAULT_SECTION_HINT.
   * Set false for dense UIs where only registry-backed sections should show (!).
   */
  autoHint?: boolean;
}): string | undefined {
  const { title, infoHint, infoHintKey, hintPreset, noHint, autoHint = true } = options;
  if (noHint) return undefined;
  if (infoHint?.trim()) return infoHint.trim();
  if (infoHintKey) {
    const fromSemantic = SECTION_HINT_KEYS[infoHintKey];
    if (fromSemantic) return fromSemantic;
    const fromTitleAsKey = HINTS_BY_TITLE[normalizeSectionTitle(infoHintKey)];
    if (fromTitleAsKey) return fromTitleAsKey;
  }
  const fromTitle = lookupHintForTitle(title);
  if (fromTitle) return fromTitle;
  if (hintPreset && PRESETS[hintPreset]) return PRESETS[hintPreset];
  if (autoHint !== false && title?.trim()) return DEFAULT_SECTION_HINT;
  return undefined;
}
