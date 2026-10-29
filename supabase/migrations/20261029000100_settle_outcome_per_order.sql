-- Each simulated settlement chooses its own outcome; retain seat integrity.
create or replace function public.settle_order (p_order_id uuid, p_force_fail boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_order public.orders;
  v_registration_status text;
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to settle orders';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.member_id = v_member;
  if not found then
    raise exception 'ORDER_NOT_FOUND_OR_NOT_YOURS';
  end if;

  if v_order.status <> 'pending' then
    return v_order.status;  -- idempotent no-op (scenario 15)
  end if;

  -- The registration is locked before the decision, so a concurrent
  -- cancel_registration either lands first (seen here) or waits.
  select r.status into v_registration_status
  from public.event_registrations r
  where r.id = v_order.registration_id
  for update;
  if not found then
    raise exception 'REGISTRATION_NOT_FOUND';
  end if;
  if v_registration_status = 'cancelled' then
    -- Refuse the charge instead of taking money for a released seat. The
    -- order stays 'pending' on purpose: register_for_event revives the
    -- cancelled registration and reuses this very order (0011's
    -- one-open-order index), so the member pays exactly once and only
    -- while actually holding a seat.
    raise exception 'REGISTRATION_CANCELLED: register again before paying';
  end if;

  -- Re-read after taking the registration lock: another settle may have
  -- completed while this call waited. Settled outcomes are immutable.
  select * into v_order from public.orders where id = p_order_id;
  if v_order.status <> 'pending' then
    return v_order.status;
  end if;

  if p_force_fail then
    update public.orders set status = 'failed' where id = v_order.id;
    update public.event_registrations
    set status = 'payment_failed'
    where id = v_order.registration_id and status in ('pending', 'payment_failed');
    return 'failed';
  end if;

  update public.orders set status = 'succeeded' where id = v_order.id;
  update public.event_registrations
  set status = 'confirmed'
  where id = v_order.registration_id and status in ('pending', 'payment_failed');
  return 'succeeded';
end;
$$;

drop function public.settle_order (uuid);
revoke execute on function public.settle_order (uuid, boolean) from public;
grant execute on function public.settle_order (uuid, boolean) to anon, authenticated, service_role;

-- Keep the legacy switch only for service-role fixtures.
revoke execute on function public.set_payment_stub_force_fail (boolean) from public, anon, authenticated;
grant execute on function public.set_payment_stub_force_fail (boolean) to service_role;
