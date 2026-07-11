#!/usr/bin/env node
/**
 * Read-only Sukuk production diagnostics.
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/diagnose-sukuk-positions.mjs
 * Optional: USER_ID=<uuid> to scope one user.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.USER_ID?.trim() || null;
const sarPerUsd = Number(process.env.SAR_PER_USD) > 0 ? Number(process.env.SAR_PER_USD) : 3.75;

if (!url || !key) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read-only service role).');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function toSar(amount, currency) {
  const n = Math.max(0, Number(amount) || 0);
  if (!(n > 0)) return 0;
  return currency === 'USD' ? n * sarPerUsd : n;
}

function sumPositionsSar(rows) {
  return (rows ?? []).reduce((sum, r) => {
    if (String(r.status ?? 'active').toLowerCase() !== 'active') return sum;
    const principal = Number(r.outstanding_principal ?? 0);
    if (!(principal > 0)) return sum;
    return sum + toSar(principal, r.currency === 'USD' ? 'USD' : 'SAR');
  }, 0);
}

async function fetchAll(table, select, filter) {
  let q = supabase.from(table).select(select);
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function main() {
  console.log('=== Sukuk positions diagnostic (read-only) ===\n');
  console.log(`Supabase: ${url}`);
  if (userId) console.log(`User scope: ${userId}`);
  console.log(`SAR/USD: ${sarPerUsd}\n`);

  const userFilter = userId ? (q) => q.eq('user_id', userId) : (q) => q;

  let positions = [];
  let legacyAssets = [];
  try {
    positions = await fetchAll(
      'sukuk_positions',
      'id,user_id,name,status,currency,outstanding_principal,issue_date,maturity_date',
      userFilter,
    );
  } catch (e) {
    console.warn('sukuk_positions table:', e.message);
    console.warn('→ Run migration supabase/migrations/20260627120000_sukuk_positions.sql\n');
  }

  try {
    legacyAssets = await fetchAll(
      'assets',
      'id,user_id,name,type,value',
      (q) => {
        let qq = q.eq('type', 'Sukuk');
        if (userId) qq = qq.eq('user_id', userId);
        return qq;
      },
    );
  } catch (e) {
    console.warn('assets (legacy Sukuk):', e.message);
  }

  const active = positions.filter((p) => String(p.status).toLowerCase() === 'active');
  const completed = positions.filter((p) => String(p.status).toLowerCase() === 'completed');
  const exposureSar = sumPositionsSar(positions);

  console.log('Counts');
  console.log(`  sukuk_positions (active):   ${active.length}`);
  console.log(`  sukuk_positions (completed): ${completed.length}`);
  console.log(`  legacy assets.type=Sukuk:   ${legacyAssets.length}`);
  console.log(`  Active exposure (SAR):      ${exposureSar.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`);

  if (legacyAssets.length > 0) {
    console.warn('⚠ Legacy Sukuk rows still in assets — migration backfill may be incomplete.');
    legacyAssets.slice(0, 5).forEach((a) => {
      console.warn(`   - ${a.id} ${a.name} value=${a.value}`);
    });
    if (legacyAssets.length > 5) console.warn(`   … and ${legacyAssets.length - 5} more`);
    console.log('');
  }

  if (active.length > 0) {
    console.log('Sample active positions:');
    active.slice(0, 8).forEach((p) => {
      const sar = toSar(p.outstanding_principal, p.currency === 'USD' ? 'USD' : 'SAR');
      console.log(`  ${p.name} | ${p.currency} ${p.outstanding_principal} → SAR ${Math.round(sar)} | mat ${p.maturity_date}`);
    });
  }

  const ok = legacyAssets.length === 0;
  console.log(`\nStatus: ${ok ? 'OK' : 'ACTION NEEDED'} (legacy assets should be 0 after migration)`);
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
