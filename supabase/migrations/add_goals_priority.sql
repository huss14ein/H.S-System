-- Goals: persist priority (app DataContext.goalPayloadVariants / normalizeGoalRow).
-- Without this column, updates fall back to payloads without priority and reload defaults to Medium.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'goals'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'goals' and column_name = 'priority'
  ) then
    alter table public.goals
      add column priority text not null default 'Medium'
        check (priority in ('High', 'Medium', 'Low'));
  end if;
end $$;

comment on column public.goals.priority is 'Funding priority for surplus routing (High | Medium | Low). Matches Goal.priority in the app.';
