# Strategic Roadmap: Platform Intelligence & Best-in-Class Investment System

*Expert-level strategies and logical approaches to enhance system intelligence, optimize decision-making, and establish a highly efficient, adaptive investment platform.*

---

## 1. Decision intelligence

### 1.1 Unified decision score (single “what to do next”)
**Idea:** One composite score per decision dimension (e.g. “deploy cash”, “rebalance”, “trim”, “hold”) so the system can rank and explain the next best action.

- **Deploy score:** Combine (a) Core sleeve drift (under target → higher score), (b) household stress (healthy → higher), (c) cash reserve vs target, (d) monthly deployment budget remaining. Output: “Deploy now: 72 — Core -5% vs target; reserve OK; 40% of monthly budget left.”
- **Rebalance score:** Combine sleeve drift magnitude, concentration index, and whether orders are already over budget. Prioritize “trim overweight sleeve first” vs “add to underweight” by impact on risk and drift.
- **Trim score:** Combine unrealized gain %, concentration, and sleeve-over-target. Surfaces “trim these 3 first” with a single priority number (e.g. risk-adjusted gain per position).
- **Implementation:** Add a small “decision layer” that consumes existing engine outputs (allocations, `deployableCash`, `stressSignals`, `orders`, `alerts`) and exposes a single ranked list of recommended actions with scores and short reasons. No new engines; pure aggregation + rules.

### 1.2 Scenario-aware decision limits
**Idea:** Every major decision (e.g. “how much to deploy”, “max new Spec buy”) is computed under multiple scenarios (base, stress, growth) so the system never suggests an action that is optimal in base but dangerous in stress.

- Use existing **scenario hooks** (e.g. `scenarioCashCap`, `scenarioTargetOverrides`) not only for display but to *constrain* recommended orders and deployment amounts.
- Rule: “Recommended deploy = min(deploy_base, deploy_stress)”; show “In a stress scenario, deploy would be capped at X.”
- Ensures the platform is **robust by design**: one set of actions that stays valid across scenarios.

### 1.3 Explainability for every number
**Idea:** Every material metric (deployable cash, risk score, rebalance urgency, portfolio health) has a one-line “why” and an optional drill-down.

- **Deployable cash:** “Household stress (caution) capped deploy to X; reserve Y% kept.”
- **Risk score (position):** “+35 Spec sleeve, +20 concentration, +15 loss >20%.”
- **Rebalance urgency:** “Core -6% vs target; Spec +4% over cap.”
- Implementation: extend existing `alerts` / `portfolioHealth` with optional `reasonCodes` or a small “explain” API that takes an indicator ID and returns a short sentence. Surfaces in UI as tooltips or a “Why this number?” panel.

---

## 2. Risk and capital efficiency

### 2.1 Drawdown-aware risk and circuit breakers
**Idea:** Add **drawdown** (peak-to-trough) at portfolio and sleeve level. Use it to soften deployment and block new speculative adds when drawdown exceeds a threshold.

- **Metrics:** Rolling max portfolio value (e.g. 12-month) and current drawdown %. Same for Spec sleeve alone.
- **Rules:** If portfolio drawdown > 15%, reduce monthly deployment by a factor (e.g. 0.5). If Spec drawdown > 25%, no new Spec buys until recovery or user override.
- **Integration:** Feed drawdown into `runCashPlanner` or a pre-step that sets `scenarioCashCap` / a “stress” multiplier. Alerts: “Portfolio in drawdown (X%); deployment reduced.”

### 2.2 Tax-aware placement and loss harvesting
**Idea:** Even without full tax modeling, the system can support better placement and loss discipline.

- **Placement hints:** Tag accounts as “tax-advantaged” vs “taxable”. In UI (or in order generation), prefer placing income-generating holdings in tax-advantaged and growth in taxable when the user has both. Optional: “Placement suggestion: move X to ISA for dividend tax efficiency.”
- **Loss harvesting prompts:** When a position has unrealized loss and the user is in “trim” or “rebalance” flow, surface: “You have an unrealized loss on [ticker]. Consider realising losses to offset gains (tax rules apply).” No automatic execution; education + nudge.
- **Implementation:** Add optional `accountType` and `unrealizedLoss` to the data model; one new alert type “tax_loss_harvest_candidate” when loss % is above a threshold (e.g. -10%) and position is in taxable account.

### 2.3 Capital efficiency ranking as a first-class lever
**Idea:** You already have **capital efficiency ranking**. Make it drive order sizing and deployment priority, not just display.

- **Rule:** When deploying to Core, allocate more to positions that rank higher on capital efficiency (e.g. better risk-adjusted return or lower risk score for same sleeve).
- **Order sizing:** Scale “planned added shares” by a factor derived from (e.g. 1 / riskScore) so high-risk positions get smaller add size, all else equal.
- **UI:** “This month’s deployment: 60% to [A], 40% to [B] by capital efficiency and drift.”

---

## 3. Adaptive behaviour

### 3.1 Regime detection (optional)
**Idea:** Classify the environment (e.g. “low vol”, “stress”, “recovery”) from available data (e.g. portfolio drawdown, household stress, market volatility if you add it) and adapt thresholds.

- **Example:** In “stress” regime, lower the drift threshold that triggers rebalance alerts (e.g. 5% instead of 8%) so the user is prompted earlier; in “low vol”, allow slightly larger drift before alerting.
- **Implementation:** Simple state machine: inputs = (household stress, portfolio drawdown, optional volatility proxy); output = regime. Config (e.g. in Wealth Ultra) holds thresholds per regime; engine reads regime and picks the set of thresholds.

### 3.2 Household–investment feedback loop
**Idea:** Close the loop between household cashflow and investment so the system never recommends deployment that would worsen household stress in the next N months.

- **Already in place:** Household stress → `suggestedMaxInvestmentFromHousehold` → shared constraints → `cappedDeployableCash`. Extend with **forward-looking** check: “If we deploy X this month, will projected reserve pool stay above min in 3 months?” Use household engine’s projected balances.
- **Rule:** Recommended deploy = min(cappedDeployableCash, max_deploy_that_keeps_reserve_above_min_over_horizon). Display: “Deployment capped so your reserve stays above Y for the next 3 months.”

### 3.3 Learning from user actions (implicit preferences)
**Idea:** Without heavy ML, use simple counters and ratios to adapt to user behaviour.

- **Examples:** (1) User often ignores “trim” alerts for a given sleeve → reduce trim alert frequency for that sleeve or raise the gain threshold. (2) User always deploys less than suggested → nudge “You often deploy 70% of suggested; use 100% this month?” (3) User never adds to Spec when in breach → after 2 consecutive months, suggest “Consider trimming Spec to target so you can add again when ready.”
- **Implementation:** Persist (e.g. in Supabase) last 20–50 “alert shown” vs “action taken” (deploy Y/N, trim Y/N). A small “preference” layer adjusts thresholds or message tone. Kept simple and transparent (e.g. “Based on your past choices, we’re suggesting…”).

---

## 4. Integration and data quality

### 4.1 Single source of truth for “investable cash”
**Idea:** One number that all engines use: “cash available for investment” = f(accounts, household reserve, budget limits, goals). Everyone reads from the same pipeline.

- **Flow:** Accounts (raw balances) → household engine (reserve, stress) → shared constraints → Wealth Ultra `cashAvailable` and optional `scenarioCashCap`. No page or engine should compute “how much I can invest” independently.
- **UI:** One “Investable cash” KPI with tooltip explaining the cap (e.g. “Capped by household stress” or “Capped by budget limit”).

### 4.2 Benchmark and context (optional but powerful)
**Idea:** Compare portfolio or sleeve performance to a simple benchmark (e.g. index or “risk-free” rate) so the system can say “Core sleeve +12% vs benchmark +8%” and “Spec sleeve -5% vs benchmark +3%”.

- **Data:** One benchmark series (e.g. S&P 500 or local index) stored or fetched (e.g. same as prices). Compute period return for portfolio and for benchmark.
- **Use:** (1) In alerts: “Core underperformed benchmark by X% over 6 months — review allocation.” (2) In capital efficiency: adjust ranking by alpha (return minus benchmark) not just return. (3) In reports: “You beat the benchmark by Y% in normalised terms.”

### 4.3 Quality and consistency checks
**Idea:** Automated checks so bad data doesn’t drive bad decisions.

- **Stale prices:** If a position has no price update in 7 days, flag “Stale price: [ticker]; orders may use outdated levels.”
- **Inconsistent totals:** If sum of holding values ≠ account total (when both exist), flag for reconciliation.
- **Negative or zero quantities:** Block order generation for that position until data is fixed.
- **Implementation:** A small “data quality” module that runs before the engine; outputs warnings and optionally a “degraded mode” (e.g. no new orders, display-only) until resolved.

---

## 5. Execution and discipline

### 5.1 Order staging and approval workflow
**Idea:** Support a two-step flow: “engine suggests orders” → “user reviews and approves” → “export or send to broker”. Reduces impulsive execution and aligns with “best-in-class” control.

- **Model:** Orders have status: `suggested` | `approved` | `executed` | `cancelled`. Only `approved` orders are exportable or sent. UI: “5 suggested orders; 2 approved. Approve all / Approve selected / Edit and approve.”
- **Audit:** Log who approved and when (if multi-user or admin). Keeps the system compliant and transparent.

### 5.2 Rebalance policy as a first-class rule
**Idea:** You have **rebalance policy** (e.g. threshold, calendar). Make it drive both alerts and the “next action” recommendation.

- **Rule:** “If drift > X% or calendar rebalance date passed, recommend rebalance; otherwise recommend deploy (or hold).” So the top recommendation is either “Rebalance now” or “Deploy to Core” or “Hold,” with a clear reason.
- **Calendar:** Optional “next rebalance date” (e.g. quarterly). When within 7 days, raise rebalance priority and show “Scheduled rebalance in 5 days.”

### 5.3 Limits and guardrails
**Idea:** Hard limits that the engine never overrides, only warns.

- **Max deployment per month:** Even if the engine suggests more, cap at a user-defined or system default (e.g. 2× monthly salary or 10% of portfolio).
- **Max new Spec per month:** Cap new Spec buy amount or count; when Spec is in breach, 0 until rebalanced.
- **Max single order size:** No order larger than X% of portfolio or X% of daily volume (if you have volume data). Prevents one-click oversized trades.
- **Implementation:** Config (Wealth Ultra or user settings); engine and order generator read limits and clip suggestions; alerts when a suggestion was clipped and why.

---

## 6. Summary: priorities for best-in-class, adaptive intelligence

| Priority | Strategy | Impact |
|----------|----------|--------|
| High | Unified decision score + explainability | One clear “what to do next” and “why”; less noise, better decisions. |
| High | Scenario-aware limits (stress/growth) | Robustness; no recommendations that break in bad times. |
| High | Drawdown-aware deployment and Spec circuit breaker | Protects capital in downturns; feels institutional. |
| High | Single source of truth for investable cash | Consistency across household, budget, and investment; no conflicting numbers. |
| Medium | Capital efficiency driving order sizing and deployment split | Better risk-adjusted deployment. |
| Medium | Tax-aware hints and loss-harvesting prompts | Adds clear value for taxable accounts. |
| Medium | Household–investment forward-looking cap | Ensures deployment never compromises reserve over horizon. |
| Medium | Order staging and rebalance policy as first-class rule | Control and discipline; aligns with “best-in-class” execution. |
| Lower | Regime detection and adaptive thresholds | Smoother behaviour across environments. |
| Lower | Implicit learning from user actions | Personalisation without heavy ML. |
| Lower | Benchmark comparison and data quality checks | Trust and context; fewer errors. |

Implementing the **high-priority** items first will already position the platform as highly efficient and adaptive; the rest can follow in phases. All strategies are designed to build on your existing engines (Wealth Ultra, household budget, shared constraints, alerts) rather than replace them.
