import { supabase } from './supabaseClient';

const LOCAL_KEY = 'finova_kpi_recon_telemetry_v1';

type DriftPayload = {
  page: string;
  userId?: string | null;
  strictMode: boolean;
  hardBlock: boolean;
  mismatchCount: number;
  rows: Array<{
    key: string;
    dashboardValue: number;
    summaryValue: number;
    deltaAbs: number;
    deltaPct: number;
  }>;
};

export type KpiDriftEvent = {
  at: string;
  page: string;
  strictMode: boolean;
  hardBlock: boolean;
  mismatchCount: number;
  keys: string[];
};

function appendLocal(payload: DriftPayload): void {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.unshift({ at: new Date().toISOString(), ...payload });
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(0, 200)));
  } catch {}
}

export async function logKpiReconciliationDrift(payload: DriftPayload): Promise<void> {
  appendLocal(payload);
  if (!supabase) return;
  try {
    const { error } = await supabase.from('kpi_reconciliation_diagnostics').insert({
      user_id: payload.userId ?? null,
      page: payload.page,
      strict_mode: payload.strictMode,
      hard_block: payload.hardBlock,
      mismatch_count: payload.mismatchCount,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (error) {
      const msg = String(error.message ?? '').toLowerCase();
      if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation')) return;
      console.warn('[kpi-drift-telemetry] insert failed:', error.message);
    }
  } catch {}
}

export async function listRecentKpiReconciliationDrift(limit = 8): Promise<KpiDriftEvent[]> {
  const maxRows = Math.max(1, Math.min(30, Number(limit) || 8));
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('kpi_reconciliation_diagnostics')
        .select('created_at, page, strict_mode, hard_block, mismatch_count, payload')
        .order('created_at', { ascending: false })
        .limit(maxRows);
      if (!error && Array.isArray(data)) {
        return data.map((row: any) => {
          const payload = row?.payload ?? {};
          const rows = Array.isArray(payload?.rows) ? payload.rows : [];
          const keys = rows.map((r: any) => String(r?.key ?? '')).filter(Boolean);
          return {
            at: String(row?.created_at ?? new Date().toISOString()),
            page: String(row?.page ?? payload?.page ?? 'Dashboard'),
            strictMode: Boolean(row?.strict_mode ?? payload?.strictMode),
            hardBlock: Boolean(row?.hard_block ?? payload?.hardBlock),
            mismatchCount: Number(row?.mismatch_count ?? payload?.mismatchCount ?? 0),
            keys,
          } as KpiDriftEvent;
        });
      }
    } catch {}
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return (Array.isArray(arr) ? arr : []).slice(0, maxRows).map((row: any) => ({
      at: String(row?.at ?? new Date().toISOString()),
      page: String(row?.page ?? 'Dashboard'),
      strictMode: Boolean(row?.strictMode),
      hardBlock: Boolean(row?.hardBlock),
      mismatchCount: Number(row?.mismatchCount ?? 0),
      keys: Array.isArray(row?.rows) ? row.rows.map((r: any) => String(r?.key ?? '')).filter(Boolean) : [],
    }));
  } catch {
    return [];
  }
}

