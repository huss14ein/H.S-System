/**
 * Investor Copilot ActionCards — advice / suggestions / recommendations with confirmable CTAs.
 * Shared by page coaches, Live Advisor, Feed, Executive Summary, and specialist engines.
 */
import type { FinancialData, Page } from '../types';
import type { AiPersonalWealthGrounding } from './aiPersonalWealthGrounding';
import { buildZakatTradeAdvice } from './zakatTradeAdvisor';

export type AiActionKind =
  | 'wealth'
  | 'goal'
  | 'trade'
  | 'budget'
  | 'debt'
  | 'recovery'
  | 'zakat'
  | 'ops';

export type AiActionSeverity = 'info' | 'watch' | 'urgent';

export type AiActionCta = {
  page: Page | string;
  action?: string;
  payload?: Record<string, unknown>;
  label?: string;
};

export type AiActionCard = {
  id: string;
  kind: AiActionKind;
  severity: AiActionSeverity;
  title: string;
  /** Advice / why this matters for this user. */
  rationale: string;
  /** Preferred recommendation impact in SAR when estimable. */
  impactSar?: number;
  cta: AiActionCta;
  /** true when seeded from deterministic rules (offline / LLM down). */
  rulesBased?: boolean;
};

export type AiInsightWithActions = {
  markdown: string;
  actionCards: AiActionCard[];
  source: 'ai' | 'rules' | 'mixed';
};

const KINDS = new Set<AiActionKind>([
  'wealth',
  'goal',
  'trade',
  'budget',
  'debt',
  'recovery',
  'zakat',
  'ops',
]);

const SEVERITIES = new Set<AiActionSeverity>(['info', 'watch', 'urgent']);

/** System addendum for generative surfaces — advice-first + ActionCards JSON. */
export const AI_ACTION_CARDS_SYSTEM_ADDENDUM = `ADVICE MANDATE (NON-NEGOTIABLE):
You are the user's Investor Copilot inside Finova. Every substantive reply must include:
1) Advice — what the situation means for THIS user (cite ground-truth numbers only).
2) Suggestions — 1–3 options when trade-offs exist.
3) Recommendations — the preferred next Finova action with estimable SAR impact when possible.

Never end with chart commentary alone. Prefer concrete Finova actions (Record Trade, Budgets, Goals, Recovery, Rebalancer, Zakat, Liabilities) over generic market talk.
Educational decision-support only — propose; user confirms. Never claim you executed a ledger write.

After your brief Markdown, append a fenced JSON block exactly like:
\`\`\`json
{"actionCards":[{"id":"unique","kind":"wealth|goal|trade|budget|debt|recovery|zakat|ops","severity":"info|watch|urgent","title":"...","rationale":"...","impactSar":0,"cta":{"page":"Investments","action":"open-trade-modal","label":"Open Record Trade"}}]}
\`\`\`
Return 2–4 actionCards when data supports action; otherwise return "actionCards":[].`;

export function actionCardsPromptFooter(seedCards: AiActionCard[] = []): string {
  const seed =
    seedCards.length > 0
      ? `\nSeeded rule cards (refine/rank; do not invent conflicting SAR figures):\n${JSON.stringify(seedCards.slice(0, 5))}`
      : '';
  return `\n${AI_ACTION_CARDS_SYSTEM_ADDENDUM}${seed}`;
}

function asKind(v: unknown): AiActionKind {
  const s = String(v || '').toLowerCase() as AiActionKind;
  return KINDS.has(s) ? s : 'ops';
}

function asSeverity(v: unknown): AiActionSeverity {
  const s = String(v || '').toLowerCase() as AiActionSeverity;
  return SEVERITIES.has(s) ? s : 'info';
}

export function normalizeAiActionCard(raw: unknown, index = 0): AiActionCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = String(o.title ?? '').trim();
  const rationale = String(o.rationale ?? o.description ?? o.why ?? '').trim();
  if (!title) return null;
  const ctaRaw = (o.cta && typeof o.cta === 'object' ? o.cta : {}) as Record<string, unknown>;
  const page = String(ctaRaw.page ?? o.page ?? 'Dashboard').trim() || 'Dashboard';
  const action = ctaRaw.action != null ? String(ctaRaw.action) : undefined;
  const label = ctaRaw.label != null ? String(ctaRaw.label) : undefined;
  const payload =
    ctaRaw.payload && typeof ctaRaw.payload === 'object'
      ? (ctaRaw.payload as Record<string, unknown>)
      : undefined;
  const impact =
    o.impactSar != null && Number.isFinite(Number(o.impactSar)) ? Number(o.impactSar) : undefined;
  return {
    id: String(o.id ?? `card-${index}-${title.slice(0, 24)}`).slice(0, 80),
    kind: asKind(o.kind ?? o.category),
    severity: asSeverity(o.severity ?? o.priority),
    title: title.slice(0, 120),
    rationale: (rationale || title).slice(0, 400),
    impactSar: impact,
    cta: { page, action, payload, label },
    rulesBased: o.rulesBased === true,
  };
}

export function validateAiActionCards(raw: unknown): AiActionCard[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { actionCards?: unknown }).actionCards)
      ? (raw as { actionCards: unknown[] }).actionCards
      : [];
  const out: AiActionCard[] = [];
  for (let i = 0; i < list.length; i++) {
    const card = normalizeAiActionCard(list[i], i);
    if (card) out.push(card);
  }
  return dedupeAiActionCards(out).slice(0, 5);
}

/** Prefer higher severity; drop duplicate CTA targets. */
export function dedupeAiActionCards(cards: AiActionCard[]): AiActionCard[] {
  const severityRank: Record<AiActionSeverity, number> = { urgent: 3, watch: 2, info: 1 };
  const sorted = [...cards].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || (b.impactSar ?? 0) - (a.impactSar ?? 0),
  );
  const seen = new Set<string>();
  const out: AiActionCard[] = [];
  for (const c of sorted) {
    const key = `${c.cta.page}|${c.cta.action ?? ''}|${c.kind}|${c.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function mergeAiActionCards(...groups: AiActionCard[][]): AiActionCard[] {
  return dedupeAiActionCards(groups.flat()).slice(0, 5);
}

/**
 * Split model Markdown that may end with a ```json actionCards fence.
 */
export function splitInsightAndActionCards(raw: string): AiInsightWithActions {
  const text = String(raw ?? '').trim();
  if (!text) return { markdown: '', actionCards: [], source: 'ai' };

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let markdown = text;
  let actionCards: AiActionCard[] = [];
  let match: RegExpExecArray | null;
  const fences: { full: string; body: string }[] = [];
  while ((match = fenceRe.exec(text)) != null) {
    fences.push({ full: match[0], body: match[1] });
  }
  for (let i = fences.length - 1; i >= 0; i--) {
    const body = fences[i].body.trim();
    try {
      const parsed = JSON.parse(body);
      if (
        parsed &&
        (Array.isArray(parsed.actionCards) ||
          (Array.isArray(parsed) && parsed[0]?.title) ||
          parsed.cta ||
          parsed.kind)
      ) {
        actionCards = validateAiActionCards(
          Array.isArray(parsed.actionCards) ? parsed : Array.isArray(parsed) ? parsed : { actionCards: [parsed] },
        );
        markdown = markdown.replace(fences[i].full, '').trim();
        break;
      }
    } catch {
      /* keep looking */
    }
  }

  return {
    markdown,
    actionCards,
    source: actionCards.some((c) => c.rulesBased) && actionCards.every((c) => c.rulesBased) ? 'rules' : 'ai',
  };
}

export function formatInsightWithActionCards(markdown: string, cards: AiActionCard[]): string {
  const md = String(markdown ?? '').trim();
  if (!cards.length) return md;
  const block = `\n\n\`\`\`json\n${JSON.stringify({ actionCards: cards }, null, 0)}\n\`\`\``;
  return `${md}${block}`;
}

function fmtSar(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0';
}

/**
 * Deterministic recommendation seeds from wealth grounding + optional page hints.
 * Always useful when LLM is down.
 */
export function buildRuleBasedActionCards(
  grounding: AiPersonalWealthGrounding,
  data?: FinancialData | null,
  page?: string,
): AiActionCard[] {
  const cards: AiActionCard[] = [];
  const g = grounding;

  if (g.emergencyFundMonths != null && g.emergencyFundMonths < 2) {
    cards.push({
      id: 'rules-ef-low',
      kind: 'wealth',
      severity: 'urgent',
      title: 'Rebuild emergency cash',
      rationale: `Liquidity covers ~${g.emergencyFundMonths.toFixed(1)} months. Target at least 2–3 months before aggressive new buys.`,
      impactSar: Math.max(0, (g.monthlyExpensesSar || 0) * 3 - (g.liquidCashSar || 0)),
      cta: { page: 'Accounts', label: 'Review cash accounts' },
      rulesBased: true,
    });
  }

  if ((g.investableCashSar ?? 0) > 5000 && (g.fundedNotDeployedSar ?? 0) > 1000) {
    cards.push({
      id: 'rules-deploy-idle',
      kind: 'wealth',
      severity: 'watch',
      title: 'Deploy idle investable cash',
      rationale: `~${fmtSar(g.investableCashSar ?? 0)} SAR tradable cash sits on platforms; funded-not-deployed ~${fmtSar(g.fundedNotDeployedSar)} SAR.`,
      impactSar: g.fundedNotDeployedSar,
      cta: { page: 'Investments', action: 'investment-tab:Investment Plan', label: 'Open Investment Plan' },
      rulesBased: true,
    });
  }

  if ((g.topConcentrationPct ?? 0) >= 25) {
    cards.push({
      id: 'rules-concentration',
      kind: 'trade',
      severity: 'watch',
      title: 'Trim concentration risk',
      rationale: `Largest holding is ~${(g.topConcentrationPct ?? 0).toFixed(0)}% of investments. Consider a trim via Record Trade.`,
      cta: { page: 'Investments', action: 'open-trade-modal', label: 'Open Record Trade' },
      rulesBased: true,
    });
  }

  for (const line of g.overspentBudgetLines.slice(0, 2)) {
    const cat = line.split(':')[0]?.trim() || 'Budget';
    cards.push({
      id: `rules-budget-${cat.slice(0, 24)}`,
      kind: 'budget',
      severity: 'urgent',
      title: `Cut or reallocate ${cat}`,
      rationale: line,
      cta: { page: 'Budgets', action: `budgets-advance-from-next-month:${encodeURIComponent(cat)}`, label: 'Open Budgets' },
      rulesBased: true,
    });
  }

  if ((g.totalDebtSar ?? 0) > 0 && g.monthlyPnLSar < 0) {
    cards.push({
      id: 'rules-debt-cashflow',
      kind: 'debt',
      severity: 'watch',
      title: 'Review debt vs negative month P&L',
      rationale: `Total debt ~${fmtSar(g.totalDebtSar ?? 0)} SAR while this month net is ${fmtSar(g.monthlyPnLSar)} SAR. Check payoff vs invest trade-off.`,
      impactSar: g.totalDebtSar,
      cta: { page: 'Liabilities', label: 'Open Liabilities' },
      rulesBased: true,
    });
  }

  if (g.unpaidInstallmentsHint) {
    cards.push({
      id: 'rules-installments',
      kind: 'debt',
      severity: 'watch',
      title: 'Check installment schedule',
      rationale: g.unpaidInstallmentsHint,
      cta: { page: 'Liabilities', label: 'Open Liabilities' },
      rulesBased: true,
    });
  }

  if (page === 'goals' || page === 'summary' || page === 'dashboard') {
    if (g.goalsProgress && /0%|under|behind|gap/i.test(g.goalsProgress)) {
      cards.push({
        id: 'rules-goals-fund',
        kind: 'goal',
        severity: 'watch',
        title: 'Re-prioritize goal funding',
        rationale: `Goals status: ${g.goalsProgress.slice(0, 180)}`,
        cta: { page: 'Goals', label: 'Open Goals' },
        rulesBased: true,
      });
    }
  }

  if (page === 'investments' || page === 'recovery' || !page) {
    if ((g.platformsDailyPnLSar ?? 0) < -500) {
      cards.push({
        id: 'rules-recovery-vs-buy',
        kind: 'recovery',
        severity: 'watch',
        title: 'Recovery vs new buys',
        rationale: `Platforms daily P/L ~${fmtSar(g.platformsDailyPnLSar ?? 0)} SAR. Review Recovery Plan before adding risk.`,
        impactSar: Math.abs(g.platformsDailyPnLSar ?? 0),
        cta: { page: 'Recovery Plan', action: 'investment-tab:Recovery Plan', label: 'Open Recovery' },
        rulesBased: true,
      });
    }
  }

  if (page === 'zakat' || page === 'summary') {
    const zakat = data ? buildZakatTradeAdvice(data, g.sarPerUsd) : { suggestions: [] };
    for (const s of zakat.suggestions.slice(0, 2)) {
      cards.push({
        id: `rules-zakat-${s.symbol}`,
        kind: 'zakat',
        severity: 'info',
        title: `Zakat note: ${s.symbol}`,
        rationale: s.impactDescription || s.reason,
        cta: { page: 'Zakat', label: 'Open Zakat' },
        rulesBased: true,
      });
    }
  }

  if ((g.dividendRunRateSar ?? 0) > 0 && (page === 'investments' || page === 'dashboard' || !page)) {
    cards.push({
      id: 'rules-dividends',
      kind: 'wealth',
      severity: 'info',
      title: 'Review dividend income plan',
      rationale: `Trailing dividend run-rate ~${fmtSar(g.dividendRunRateSar ?? 0)} SAR. Decide reinvest vs cash.`,
      impactSar: g.dividendRunRateSar,
      cta: { page: 'Investments', action: 'investment-tab:Dividend Tracker', label: 'Dividend Tracker' },
      rulesBased: true,
    });
  }

  return dedupeAiActionCards(cards).slice(0, 5);
}

/** Map FeedItem type → ActionCard kind for proactive feed. */
export function feedTypeToActionKind(type: string): AiActionKind {
  switch (String(type || '').toUpperCase()) {
    case 'BUDGET':
      return 'budget';
    case 'GOAL':
      return 'goal';
    case 'INVESTMENT':
      return 'trade';
    case 'SAVINGS':
      return 'wealth';
    default:
      return 'ops';
  }
}

export function feedItemToActionCard(
  item: { type: string; title: string; description: string; emoji?: string },
  index: number,
): AiActionCard {
  const kind = feedTypeToActionKind(item.type);
  const pageByKind: Record<AiActionKind, Page | string> = {
    wealth: 'Dashboard',
    goal: 'Goals',
    trade: 'Investments',
    budget: 'Budgets',
    debt: 'Liabilities',
    recovery: 'Recovery Plan',
    zakat: 'Zakat',
    ops: 'Wealth Analytics',
  };
  const actionByKind: Partial<Record<AiActionKind, string>> = {
    trade: 'open-trade-modal',
    recovery: 'investment-tab:Recovery Plan',
    budget: 'budgets-focus-requests',
  };
  return {
    id: `feed-${index}-${kind}`,
    kind,
    severity: kind === 'budget' ? 'watch' : 'info',
    title: item.title,
    rationale: item.description,
    cta: {
      page: pageByKind[kind],
      action: actionByKind[kind],
      label: `Open ${pageByKind[kind]}`,
    },
  };
}
