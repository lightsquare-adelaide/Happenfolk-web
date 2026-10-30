-- Seat integrity on the registration/payment state machine.
--
-- Audit finding A2 (26 October 2026): 0011's register_for_event checked
-- capacity only on the brand-new-registration branch. Reviving a
-- CANCELLED registration took a seat with no capacity check at all, so
-- the sequence "register, cancel, let somebody else take the last seat,
-- register again" oversold the event. The event row is already taken
-- FOR UPDATE at that point, so both branches can share one check and
-- still be serialised against concurrent callers.
--
-- Audit finding A8 (26 October 2026): settle_order never looked at the
-- registration, so a pending order belonging to a cancelled
-- registration settled to 'succeeded' — money taken, seat already
-- released. The second UPDATE in 0008 then matched nothing
-- ('cancelled' is not in its status list) and the pair was left
-- inconsistent: a paid order attached to a cancelled seat.
--
-- Audit finding A9 (26 October 2026) is documented, not changed:
-- 'payment_failed' registrations keep their seat. See the comment on
-- the capacity check below.

create or replace function public.register_for_event (p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_event public.events;
  v_registration public.event_registrations;
  v_has_registration boolean;
  v_seats_taken int;
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to register for events';
  end if;

  -- FOR UPDATE serialises registrations for this event: concurrent callers
  -- queue here, so each one's capacity count sees every earlier insert.
  select * into v_event
  from public.events e
  where e.id = p_event_id and e.status = 'published'
  for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND_OR_NOT_PUBLISHED';
  end if;

  select * into v_registration
  from public.event_registrations r
  where r.event_id = p_event_id and r.member_id = v_member;
  v_has_registration := found;

  -- One capacity gate for every path that is about to occupy a seat:
  -- a first registration and a revived cancelled one. A registration
  -- that is already pending/confirmed/payment_failed takes no NEW seat,
  -- so re-running the RPC (retry, duplicate delivery) is still
  -- idempotent and cannot be turned away by a full house it already sits
  -- in.
  if (not v_has_registration) or v_registration.status = 'cancelled' then
    if v_event.capacity is not null then
      select count(*) into v_seats_taken
      from public.event_registrations r
      where r.event_id = p_event_id
        and r.status in ('pending', 'confirmed', 'payment_failed');

      -- Documented tradeoff (audit A9), behaviour unchanged from 0008:
      -- 'payment_failed' counts as an occupied seat, so a declined
      -- payment does not silently hand the seat to the next caller while
      -- the member is still on the retry path. The seat is released by
      -- cancel_registration. Releasing it on a timer belongs to a real
      -- payment provider (Future Implementation tier) and is not part of
      -- the stub gateway's contract; tests/payments/05 pins the current
      -- policy so a change is a deliberate one.
      if v_seats_taken >= v_event.capacity then
        raise exception 'EVENT_FULL';
      end if;
    end if;
  end if;

  if not v_has_registration then
    insert into public.event_registrations (event_id, member_id, status)
    values (
      p_event_id,
      v_member,
      case when v_event.price_cents > 0 then 'pending' else 'confirmed' end
    )
    returning * into v_registration;
  elsif v_registration.status = 'cancelled' then
    update public.event_registrations
    set status = case when v_event.price_cents > 0 then 'pending' else 'confirmed' end
    where id = v_registration.id
    returning * into v_registration;
  end if;

  if v_event.price_cents > 0 and v_registration.status in ('pending', 'payment_failed') then
    insert into public.orders (registration_id, member_id, amount_cents, status)
    values (v_registration.id, v_member, v_event.price_cents, 'pending')
    on conflict (registration_id) where status = 'pending' do nothing;
  end if;

  return v_registration.id;
end;
$$;

create or replace function public.settle_order (p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_order public.orders;
  v_registration_status text;
  v_force_fail boolean;
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

  select force_fail into v_force_fail
  from public.payment_stub_settings where id = true;

  if v_force_fail then
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
