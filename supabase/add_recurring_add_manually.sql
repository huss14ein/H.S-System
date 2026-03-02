-- Flag to control whether recurring transaction is auto-recorded on the day or added manually only.
-- Default false = auto-record on dayOfMonth when the day arrives.

alter table public.recurring_transactions
  add column if not exists add_manually boolean not null default false;

comment on column public.recurring_transactions.add_manually is 'If true, do not auto-record on day; user applies manually. If false, system records on day_of_month.';
