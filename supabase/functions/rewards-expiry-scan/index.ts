/**
 * Daily scan: flag rewards earns/lots expiring within 30 days; soft-expire past-due open lots.
 * Prefers `rewards_lots.quantity_remaining` (FIFO) when rows exist; falls back to earn txs.
 * Schedule in Supabase dashboard (cron) after deploy — code alone does not schedule.
 * No live loyalty APIs — operates only on user ledger rows.
 *
 * Security: requires `x-rewards-expiry-secret` matching env `REWARDS_EXPIRY_SCAN_SECRET`
 * (same pattern as weekly digest). Never invoke with only the public anon key.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rewards-expiry-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const expectedSecret = Deno.env.get('REWARDS_EXPIRY_SCAN_SECRET');
  const provided =
    req.headers.get('x-rewards-expiry-secret') ??
    // Allow Authorization: Bearer <secret> for cron schedulers that only support Bearer.
    (req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() || null);
  if (!expectedSecret || !provided || provided !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing env' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(today + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 30);
    const endYmd = end.toISOString().slice(0, 10);

    const { data: soonLots } = await admin
      .from('rewards_lots')
      .select('id, user_id, account_id, quantity_remaining, expires_on')
      .gt('quantity_remaining', 0)
      .gte('expires_on', today)
      .lte('expires_on', endYmd)
      .limit(500);

    const { data: soonEarns, error: soonErr } = await admin
      .from('rewards_transactions')
      .select('id, user_id, account_id, amount, expires_on')
      .eq('transaction_type', 'earn')
      .eq('status', 'posted')
      .gte('expires_on', today)
      .lte('expires_on', endYmd)
      .limit(500);

    if (soonErr) {
      return new Response(JSON.stringify({ ok: false, error: soonErr.message }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: pastDueLots } = await admin
      .from('rewards_lots')
      .select('id, user_id, account_id, quantity_remaining, expires_on, earn_tx_id')
      .gt('quantity_remaining', 0)
      .lt('expires_on', today)
      .limit(200);

    let expired = 0;
    for (const lot of pastDueLots ?? []) {
      const amount = Math.abs(Number(lot.quantity_remaining) || 0);
      if (!(amount > 0)) continue;
      const idem = `expire|lot|${lot.id}|${today}`;
      const { error: insErr } = await admin.from('rewards_transactions').insert({
        user_id: lot.user_id,
        account_id: lot.account_id,
        transaction_type: 'expire',
        amount,
        fiat_equivalent: 0,
        effective_date: today,
        idempotency_key: idem,
        reason: 'Auto-expire past due lot',
        status: 'posted',
      });
      if (insErr) continue;
      await admin
        .from('rewards_lots')
        .update({ quantity_remaining: 0 })
        .eq('id', lot.id)
        .eq('user_id', lot.user_id);
      const { data: acc } = await admin
        .from('rewards_accounts')
        .select('current_balance')
        .eq('id', lot.account_id)
        .eq('user_id', lot.user_id)
        .maybeSingle();
      if (acc) {
        const next = Math.max(0, Number(acc.current_balance) - amount);
        await admin
          .from('rewards_accounts')
          .update({ current_balance: next, updated_at: new Date().toISOString() })
          .eq('id', lot.account_id)
          .eq('user_id', lot.user_id);
      }
      expired += 1;
    }

    // Legacy fallback: earn txs with no open lots left (pre-lot data).
    if ((pastDueLots ?? []).length === 0) {
      const { data: pastDue } = await admin
        .from('rewards_transactions')
        .select('id, user_id, account_id, amount, expires_on')
        .eq('transaction_type', 'earn')
        .eq('status', 'posted')
        .lt('expires_on', today)
        .limit(200);

      for (const row of pastDue ?? []) {
        const idem = `expire|auto|${row.id}|${today}`;
        const amount = Math.abs(Number(row.amount) || 0);
        if (!(amount > 0)) continue;
        const { error: insErr } = await admin.from('rewards_transactions').insert({
          user_id: row.user_id,
          account_id: row.account_id,
          transaction_type: 'expire',
          amount,
          fiat_equivalent: 0,
          effective_date: today,
          idempotency_key: idem,
          reason: 'Auto-expire past due earn',
          status: 'posted',
        });
        if (insErr) continue;
        const { data: acc } = await admin
          .from('rewards_accounts')
          .select('current_balance')
          .eq('id', row.account_id)
          .eq('user_id', row.user_id)
          .maybeSingle();
        if (acc) {
          const next = Math.max(0, Number(acc.current_balance) - amount);
          await admin
            .from('rewards_accounts')
            .update({ current_balance: next, updated_at: new Date().toISOString() })
            .eq('id', row.account_id)
            .eq('user_id', row.user_id);
        }
        expired += 1;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        expiringWithin30Days: Math.max((soonLots ?? []).length, (soonEarns ?? []).length),
        autoExpired: expired,
        scannedAt: new Date().toISOString(),
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
