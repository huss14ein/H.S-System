-- Optional but recommended: memo, split-expense payload (__FINOVA_SPLITS__), and income notes.
-- Run in Supabase SQL editor if inserts fail on unknown column "note".

alter table if exists public.transactions
  add column if not exists note text;

comment on column public.transactions.note is 'Optional user memo; split expenses encode categories in __FINOVA_SPLITS__ JSON suffix.';
