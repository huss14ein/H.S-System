-- KPI reconciliation drift telemetry (Dashboard strict mode).
create table if not exists public.kpi_reconciliation_diagnostics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid null references auth.users(id) on delete set null,
  page text not null default 'Dashboard',
  strict_mode boolean not null default true,
  hard_block boolean not null default false,
  mismatch_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb
);

alter table public.kpi_reconciliation_diagnostics enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_reconciliation_diagnostics'
      and policyname = 'kpi_recon_diag_select_own'
  ) then
    create policy kpi_recon_diag_select_own
      on public.kpi_reconciliation_diagnostics
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_reconciliation_diagnostics'
      and policyname = 'kpi_recon_diag_insert_own'
  ) then
    create policy kpi_recon_diag_insert_own
      on public.kpi_reconciliation_diagnostics
      for insert
      with check (auth.uid() = user_id or user_id is null);
  end if;
end $$;

