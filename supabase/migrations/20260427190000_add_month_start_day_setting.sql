-- Adds a global setting to shift the "financial month" boundary (KPIs/Budgets).
-- 1 = calendar month; 2–28 makes the month window start at that day.

alter table if exists public.settings
add column if not exists month_start_day integer not null default 1;

do $$
begin
  begin
    alter table public.settings
    add constraint settings_month_start_day_check check (month_start_day >= 1 and month_start_day <= 28);
  exception
    when duplicate_object then null;
  end;
end $$;

