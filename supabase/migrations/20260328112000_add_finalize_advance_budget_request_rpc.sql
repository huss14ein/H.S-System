-- Atomically finalize "Advance from next month" budget requests.

create or replace function public.finalize_advance_budget_request(
  p_request_id uuid,
  p_category text,
  p_amount numeric,
  p_from_year integer,
  p_from_month integer,
  p_to_year integer,
  p_to_month integer
)
returns table (
  source_budget_id uuid,
  source_new_limit numeric,
  destination_budget_id uuid,
  destination_new_limit numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_request record;
  v_target_user_id uuid;
  v_src record;
  v_dst record;
  v_amount numeric := coalesce(p_amount, 0);
  v_src_new numeric;
  v_dst_new numeric;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  v_is_admin := coalesce(public.is_admin_user(), false);
  if not v_is_admin then
    raise exception using errcode = '42501', message = 'Only admins can finalize budget requests';
  end if;

  if v_amount <= 0 then
    raise exception using errcode = '22023', message = 'Amount must be > 0';
  end if;

  select *
  into v_request
  from public.budget_requests br
  where br.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Budget request not found';
  end if;

  if coalesce(v_request.status, '') = 'Finalized' then
    raise exception using errcode = '23505', message = 'Budget request already finalized';
  end if;

  if lower(coalesce(v_request.status, '')) <> 'pending' then
    raise exception using errcode = '22023', message = 'Only pending budget requests can be finalized';
  end if;

  v_target_user_id := v_request.user_id;

  select b.*
  into v_src
  from public.budgets b
  where b.user_id = v_target_user_id
    and b.category = p_category
    and b.year = p_from_year
    and b.month = p_from_month
  order by b.id desc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Source budget row not found';
  end if;

  if coalesce(v_src.limit, 0) < v_amount then
    raise exception using errcode = '22023', message = format('Insufficient source budget: available %.2f, requested %.2f', coalesce(v_src.limit, 0), v_amount);
  end if;

  select b.*
  into v_dst
  from public.budgets b
  where b.user_id = v_target_user_id
    and b.category = p_category
    and b.year = p_to_year
    and b.month = p_to_month
  order by b.id desc
  limit 1
  for update;

  v_src_new := greatest(0, coalesce(v_src.limit, 0) - v_amount);
  update public.budgets set limit = v_src_new where id = v_src.id;

  if found and v_dst.id is not null then
    v_dst_new := greatest(0, coalesce(v_dst.limit, 0) + v_amount);
    update public.budgets set limit = v_dst_new where id = v_dst.id;
  else
    insert into public.budgets (
      user_id, category, limit, month, year, period, tier, destination_account_id
    )
    values (
      v_target_user_id,
      p_category,
      v_amount,
      p_to_month,
      p_to_year,
      'monthly',
      coalesce(v_src.tier, 'Optional'),
      v_src.destination_account_id
    )
    returning id, limit into v_dst;
    v_dst_new := v_dst.limit;
  end if;

  update public.budget_requests
  set status = 'Finalized', amount = v_amount
  where id = p_request_id;

  return query
  select v_src.id, v_src_new, v_dst.id, v_dst_new;
end;
$$;

revoke all on function public.finalize_advance_budget_request(uuid, text, numeric, integer, integer, integer, integer) from public;
grant execute on function public.finalize_advance_budget_request(uuid, text, numeric, integer, integer, integer, integer) to authenticated;
