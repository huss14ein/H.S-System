/**
 * Supabase Edge Function: process pending reconciliation_runs (targeted symbol replay metadata).
 * Deploy: `supabase functions deploy reconciliation-replay` from repo root.
 *
 * Heavy holdings replay remains client/DataContext-driven today; this worker marks runs
 * completed/blocked from metadata and writes audit rows so multi-device status stays durable.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase env" }), { status: 500 });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as { runId?: string };
    let query = admin
      .from("reconciliation_runs")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: true })
      .limit(10);
    if (body.runId) query = query.eq("id", body.runId);

    const { data: runs, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    const processed: string[] = [];
    for (const run of runs ?? []) {
      await admin
        .from("reconciliation_runs")
        .update({ status: "running" })
        .eq("id", run.id)
        .eq("user_id", user.id);

      const meta = (run.metadata ?? {}) as Record<string, unknown>;
      const blocked = Boolean(meta.blocked) || Boolean(meta.missingMarks);
      const status = blocked ? "blocked" : "completed";
      const errorMessage = blocked
        ? String(meta.errorMessage ?? "Replay blocked — missing historical marks or locked month.")
        : null;

      await admin
        .from("reconciliation_runs")
        .update({
          status,
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("user_id", user.id);

      await admin.from("reconciliation_audit_events").insert({
        user_id: user.id,
        kind: blocked ? "error" : "adjustment",
        mechanism: "reconcile_quantity",
        entity_type: run.entity_type ?? "holding",
        entity_id: Array.isArray(run.entity_ids) && run.entity_ids[0] ? String(run.entity_ids[0]) : "batch",
        effective_date: run.effective_from,
        run_id: run.id,
        adjustment_id: run.adjustment_id,
        summary: blocked
          ? `Replay blocked for run ${run.id}: ${errorMessage}`
          : `Replay run ${run.id} marked ${status} (client applies holdings patch).`,
        metadata: meta,
      });
      processed.push(String(run.id));
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500 });
  }
});
