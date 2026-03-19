-- Optional: original file location in Supabase Storage (private bucket `financial-statements`).
-- App uploads after parse when bucket exists; safe to run without Storage configured.

alter table public.financial_statements
  add column if not exists storage_bucket text,
  add column if not exists storage_path text;

comment on column public.financial_statements.storage_bucket is 'Supabase Storage bucket id (e.g. financial-statements)';
comment on column public.financial_statements.storage_path is 'Object path within bucket, typically {user_id}/{statement_id}/{filename}';
