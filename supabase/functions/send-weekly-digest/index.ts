/**
 * Run `supabase functions deploy send-weekly-digest` from the **repo root** so relative imports into
 * `/services` bundle with the app’s shared net-worth math (`digestFinancialData` / `weeklyDigestNetWorthSar`).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { buildFinancialDataForWeeklyDigest } from "../../../services/digestFinancialData.ts";
import { computeWeeklyDigestPersonalNetWorthSar } from "../../../services/weeklyDigestNetWorthSar.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

interface WeeklyDigestPayload {
  userName: string;
  periodEnd: string;
  budgetSummary: {
    totalBudget: number;
    totalSpent: number;
    percentUsed: number;
    overCategories: string[];
  };
  netWorth: number;
  alerts: string[];
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Email template renderer
function renderEmailTemplate(payload: WeeklyDigestPayload): string {
  const percentUsedColor = payload.budgetSummary.percentUsed > 100 ? '#b91c1c' : '#15803d';
  const safeName = escapeHtml(payload.userName);
  const safePeriodEnd = escapeHtml(payload.periodEnd);
  const safeOverList = payload.budgetSummary.overCategories.map(escapeHtml).join(', ');

  const overCategoriesHtml = payload.budgetSummary.overCategories.length > 0
    ? `<p style="margin: 12px 0 0; font-size: 13px; color: #b91c1c;">Over budget: ${safeOverList}</p>`
    : '';

  const alertsHtml = payload.alerts.length > 0
    ? `
      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Alerts</h2>
        <ul style="margin: 0; padding-left: 20px; color: #64748b; font-size: 14px; line-height: 1.6;">
          ${payload.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join('')}
        </ul>
      </section>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Your weekly Finova summary</title>
</head>
<body style="margin:0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding: 24px; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;">
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; padding: 24px 24px 28px;">
      <h1 style="margin:0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">Weekly summary</h1>
      <p style="margin: 8px 0 0; opacity: 0.95; font-size: 14px;">${safePeriodEnd}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 20px; color: #334155; font-size: 15px;">Hi ${safeName},</p>
      <p style="margin: 0 0 20px; color: #64748b; font-size: 14px; line-height: 1.5;">Here's your financial snapshot for the past week.</p>
      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Budgets</h2>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px;">
          <p style="margin: 0 0 4px; font-size: 13px; color: #64748b;">Spent vs budget</p>
          <p style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">${payload.budgetSummary.totalSpent} / ${payload.budgetSummary.totalBudget}</p>
          <p style="margin: 8px 0 0; font-size: 13px; color: ${percentUsedColor};">${payload.budgetSummary.percentUsed}% of budget used</p>
        </div>
        ${overCategoriesHtml}
      </section>
      <section style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Net worth</h2>
        <p style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">${payload.netWorth}</p>
      </section>
      ${alertsHtml}
      <p style="margin: 24px 0 0; font-size: 13px; color: #94a3b8;">You're receiving this because Weekly Email Reports are enabled in Settings. Open the app to see full details.</p>
    </div>
  </div>
</body>
</html>`;
}

/** Align with `services/householdBudgetEngine.monthlyEquivalentFromBudgetLimit` and Budgets page — compare MTD spend to monthly-equivalent caps. */
function monthlyEquivalentFromLimit(limit: number, period?: string): number {
  const n = Number(limit) || 0;
  const p = period ?? 'monthly';
  if (p === 'yearly') return n / 12;
  if (p === 'weekly') return n * (52 / 12);
  if (p === 'daily') return n * (365 / 12);
  return n;
}

// Calculate budget summary from user data (month-to-date to match budget period)
async function calculateBudgetSummary(supabase: any, userId: string, periodEnd: Date): Promise<{
  totalBudget: number;
  totalSpent: number;
  percentUsed: number;
  overCategories: string[];
}> {
  const year = periodEnd.getFullYear();
  const month = periodEnd.getMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = periodEnd.toISOString().split('T')[0];

  // Get budgets for current month
  const { data: budgets } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month);

  // Get transactions for month-to-date (same period as budget limits)
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .gte('date', monthStart)
    .lte('date', monthEnd);

  const isInternalTransfer = (t: { category?: string }) => {
    const c = String(t.category ?? '').trim().toLowerCase();
    return c === 'transfer' || c === 'transfers';
  };

  const expenseTx = (transactions || []).filter(
    (t: any) => t.amount < 0 && !isInternalTransfer(t)
  );

  const totalBudget = (budgets || []).reduce(
    (sum: number, b: any) => sum + monthlyEquivalentFromLimit(b.limit ?? 0, b.period),
    0
  );
  const totalSpent = expenseTx.reduce((sum: number, t: any) => sum + Math.abs(t.amount || 0), 0);
  const percentUsed = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // Aggregate by budget_category (maps to budget.category); fallback to category if unset
  const categorySpending = new Map<string, number>();
  expenseTx.forEach((t: any) => {
    const cat = (t.budget_category || t.category || '').trim() || 'Other';
    categorySpending.set(cat, (categorySpending.get(cat) || 0) + Math.abs(t.amount || 0));
  });

  const overCategories: string[] = [];
  (budgets || []).forEach((b: any) => {
    const monthlyEq = monthlyEquivalentFromLimit(b.limit ?? 0, b.period);
    const spent = categorySpending.get(b.category) || 0;
    if (monthlyEq > 0 && spent > monthlyEq) {
      overCategories.push(b.category);
    }
  });

  return { totalBudget, totalSpent, percentUsed, overCategories };
}

/** Matches app `CurrencyContext` / `toSAR` default; override via WEEKLY_DIGEST_SAR_PER_USD or SAR_PER_USD. */
const DEFAULT_SAR_PER_USD = 3.75;

function sarPerUsd(): number {
  const n = Number(Deno.env.get('WEEKLY_DIGEST_SAR_PER_USD') ?? Deno.env.get('SAR_PER_USD'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SAR_PER_USD;
}

/**
 * Personal net worth (SAR) — uses the same pipeline as the app:
 * `buildFinancialDataForWeeklyDigest` → `computeWeeklyDigestPersonalNetWorthSar`
 * (`computePersonalNetWorthBreakdownSAR` + FX from `wealth_ultra_config` / env + investment ledger cash).
 */
async function calculateNetWorth(supabase: any, userId: string): Promise<number> {
  const fallbackFx = sarPerUsd();

  const [
    { data: accountsRaw, error: eAcc },
    { data: assetsRaw, error: eAst },
    { data: liabilitiesRaw, error: eLiab },
    { data: portfoliosRaw, error: ePort },
    { data: commodityHoldingsRaw, error: eComm },
    { data: investmentTransactionsRaw, error: eTx },
    { data: wealthUltraUser, error: eWuUser },
    { data: wealthUltraGlobal, error: eWuGlobal },
  ] = await Promise.all([
    supabase.from('accounts').select('*').eq('user_id', userId),
    supabase.from('assets').select('*').eq('user_id', userId),
    supabase.from('liabilities').select('*').eq('user_id', userId),
    supabase.from('investment_portfolios').select('*, holdings(*)').eq('user_id', userId),
    supabase.from('commodity_holdings').select('*').eq('user_id', userId),
    supabase.from('investment_transactions').select('*').eq('user_id', userId),
    supabase.from('wealth_ultra_config').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('wealth_ultra_config').select('*').is('user_id', null).limit(1).maybeSingle(),
  ]);

  if (eAcc) console.error('weekly-digest accounts:', eAcc.message);
  if (eAst) console.error('weekly-digest assets:', eAst.message);
  if (eLiab) console.error('weekly-digest liabilities:', eLiab.message);
  if (ePort) console.error('weekly-digest investment_portfolios:', ePort.message);
  if (eComm) console.error('weekly-digest commodity_holdings:', eComm.message);
  if (eTx) console.error('weekly-digest investment_transactions:', eTx.message);
  if (eWuUser) console.warn('weekly-digest wealth_ultra_config (user):', eWuUser.message);
  if (eWuGlobal) console.warn('weekly-digest wealth_ultra_config (global):', eWuGlobal.message);

  const data = buildFinancialDataForWeeklyDigest({
    accountsRaw: (accountsRaw ?? []) as Record<string, unknown>[],
    assetsRaw: (assetsRaw ?? []) as Record<string, unknown>[],
    liabilitiesRaw: (liabilitiesRaw ?? []) as Record<string, unknown>[],
    portfoliosRaw: (portfoliosRaw ?? []) as Record<string, unknown>[],
    commodityHoldingsRaw: (commodityHoldingsRaw ?? []) as Record<string, unknown>[],
    investmentTransactionsRaw: (investmentTransactionsRaw ?? []) as Record<string, unknown>[],
    wealthUltraUserRow: wealthUltraUser ? (wealthUltraUser as Record<string, unknown>) : null,
    wealthUltraGlobalRow: wealthUltraGlobal ? (wealthUltraGlobal as Record<string, unknown>) : null,
  });

  return computeWeeklyDigestPersonalNetWorthSar(data, fallbackFx);
}

type BudgetSummaryRow = {
  totalBudget: number;
  totalSpent: number;
  percentUsed: number;
  overCategories: string[];
};

/** Build alert lines from an already-computed budget summary (avoids duplicate DB queries vs recalculating). */
function getAlerts(budgetSummary: BudgetSummaryRow): string[] {
  const alerts: string[] = [];
  if (budgetSummary.percentUsed > 100) {
    alerts.push(`Budget exceeded by ${budgetSummary.percentUsed - 100}%`);
  }
  if (budgetSummary.overCategories.length > 0) {
    alerts.push(`Over budget in: ${budgetSummary.overCategories.join(', ')}`);
  }
  return alerts;
}

serve(async (req: Request) => {
  // Security: Require a secret header to prevent unauthorized calls
  const authHeader = req.headers.get('x-weekly-digest-secret');
  const expectedSecret = Deno.env.get('WEEKLY_DIGEST_SECRET');
  
  if (!expectedSecret || authHeader !== expectedSecret) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const emailApiKey = Deno.env.get('RESEND_API_KEY') || Deno.env.get('SENDGRID_API_KEY');
    const emailFrom = Deno.env.get('EMAIL_FROM') || 'noreply@finova.app';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    if (!emailApiKey) {
      throw new Error('Email API key (RESEND_API_KEY or SENDGRID_API_KEY) not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all users with email enabled
    const { data: settings } = await supabase
      .from('settings')
      .select('user_id, enable_emails')
      .eq('enable_emails', true);

    if (!settings || settings.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No users with email enabled', sent: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const periodEnd = new Date();
    const periodEndStr = periodEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

    let sent = 0;
    let errors = 0;

    for (const setting of settings) {
      try {
        // Get user email from auth.users
        const { data: authUser } = await supabase.auth.admin.getUserById(setting.user_id);
        if (!authUser?.user?.email) {
          console.error(`No email found for user ${setting.user_id}`);
          errors++;
          continue;
        }

        const userName = authUser.user.user_metadata?.full_name || authUser.user.email?.split('@')[0] || 'User';
        const userEmail = authUser.user.email;

        // Calculate digest data
        const budgetSummary = await calculateBudgetSummary(supabase, setting.user_id, periodEnd);
        const netWorth = await calculateNetWorth(supabase, setting.user_id);
        const alerts = getAlerts(budgetSummary);

        const payload: WeeklyDigestPayload = {
          userName,
          periodEnd: periodEndStr,
          budgetSummary,
          netWorth,
          alerts,
        };

        const htmlBody = renderEmailTemplate(payload);

        // Send email via Resend (preferred) or SendGrid
        const emailProvider = Deno.env.get('RESEND_API_KEY') ? 'resend' : 'sendgrid';
        
        if (emailProvider === 'resend') {
          const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${emailApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: emailFrom,
              to: userEmail,
              subject: `Your weekly Finova summary - ${periodEndStr}`,
              html: htmlBody,
            }),
          });

          if (!resendResponse.ok) {
            const errorText = await resendResponse.text();
            console.error(`Resend error for ${userEmail}:`, errorText);
            errors++;
            continue;
          }
        } else {
          // SendGrid
          const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${emailApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: userEmail }] }],
              from: { email: emailFrom },
              subject: `Your weekly Finova summary - ${periodEndStr}`,
              content: [{ type: 'text/html', value: htmlBody }],
            }),
          });

          if (!sendgridResponse.ok) {
            const errorText = await sendgridResponse.text();
            console.error(`SendGrid error for ${userEmail}:`, errorText);
            errors++;
            continue;
          }
        }

        sent++;
      } catch (error) {
        console.error(`Error processing user ${setting.user_id}:`, error);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Weekly digest sent', 
        sent, 
        errors,
        total: settings.length 
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in weekly digest function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
