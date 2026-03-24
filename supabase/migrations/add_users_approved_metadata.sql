-- Optional follow-up after add_user_approval.sql: documentation + index for Settings admin query
-- (select pending users where approved = false). Safe to run once; idempotent.

begin;

comment on column public.users.approved is
  'When false, user must be approved by an Admin (Settings) before full app access. New auth signups default to false via handle_new_user trigger.';

create index if not exists idx_public_users_pending_signups
  on public.users (created_at desc)
  where approved = false;

commit;
