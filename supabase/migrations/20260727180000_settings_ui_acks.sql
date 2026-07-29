-- Durable UI acknowledgments for reconcile / integrity dismissals (cross-device).
-- Live-data safe: additive jsonb with empty default; no rewrites of existing rows.

alter table if exists public.settings
  add column if not exists ui_acks jsonb not null default '{}'::jsonb;

comment on column public.settings.ui_acks is
  'User dismissals for reconcile/integrity prompts (holdings qty Keep stored/closed, cash balance drift after Apply). Fingerprinted so new drifts resurface.';
