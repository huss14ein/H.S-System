-- Run this once before (or when) you get:
--   ERROR: 42P13: cannot change return type of existing function
--   HINT: Use DROP FUNCTION approve_pending_transaction(uuid) first.
--
-- Then re-run your migration that creates approve_pending_transaction and reject_pending_transaction.

drop function if exists public.approve_pending_transaction(uuid);
drop function if exists public.reject_pending_transaction(uuid, text);
