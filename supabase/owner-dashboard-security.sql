begin;

alter table public.shifts
  add column if not exists client_shift_id uuid,
  add column if not exists opening_proof_image text;

create unique index if not exists shifts_client_shift_id_unique
  on public.shifts (client_shift_id);

grant select on public.shifts to service_role;
grant select on public.station_baselines to service_role;

-- Financial data is served through the protected owner API.
-- Supervisor submissions use the minimal function below.

alter table public.shifts enable row level security;

drop policy if exists dong_gas_server_only_read
  on public.shifts;

create policy dong_gas_server_only_read
  on public.shifts
  as restrictive
  for select
  to anon, authenticated
  using (false);

drop policy if exists dong_gas_server_only_update
  on public.shifts;

create policy dong_gas_server_only_update
  on public.shifts
  as restrictive
  for update
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists dong_gas_server_only_delete
  on public.shifts;

create policy dong_gas_server_only_delete
  on public.shifts
  as restrictive
  for delete
  to anon, authenticated
  using (false);

drop policy if exists dong_gas_rpc_only_insert
  on public.shifts;

create policy dong_gas_rpc_only_insert
  on public.shifts
  as restrictive
  for insert
  to anon, authenticated
  with check (false);

revoke select, insert, update, delete
  on public.shifts
  from anon, authenticated;

-- Return only the opening meter required by the supervisor.

create or replace function public.get_main_pump_opening()
returns table (
  opening_meter numeric,
  source text
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select s.closing_meter::numeric as meter
    from public.shifts s
    where s.closing_meter is not null
    order by s.created_at desc, s.id desc
    limit 1
  ),
  baseline as (
    select b.baseline_meter::numeric as meter
    from public.station_baselines b
    where b.pump_name = 'main'
    order by b.id
    limit 1
  )
  select
    l.meter,
    'Previous completed shift'::text
  from latest l

  union all

  select
    b.meter,
    'Owner-configured baseline'::text
  from baseline b
  where not exists (select 1 from latest)

  limit 1;
$$;

revoke all
  on function public.get_main_pump_opening()
  from public, anon, authenticated;

grant execute
  on function public.get_main_pump_opening()
  to anon, authenticated, service_role;

-- Baseline configuration is changed by the owner server API.

alter table public.station_baselines
  enable row level security;

drop policy if exists dong_gas_server_only_baseline_insert
  on public.station_baselines;

create policy dong_gas_server_only_baseline_insert
  on public.station_baselines
  as restrictive
  for insert
  to anon, authenticated
  with check (false);

drop policy if exists dong_gas_server_only_baseline_update
  on public.station_baselines;

create policy dong_gas_server_only_baseline_update
  on public.station_baselines
  as restrictive
  for update
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists dong_gas_server_only_baseline_delete
  on public.station_baselines;

create policy dong_gas_server_only_baseline_delete
  on public.station_baselines
  as restrictive
  for delete
  to anon, authenticated
  using (false);

revoke insert, update, delete
  on public.station_baselines
  from anon, authenticated;

create table if not exists public.owner_dashboard_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.owner_dashboard_audit
  enable row level security;

revoke all
  on public.owner_dashboard_audit
  from public, anon, authenticated;

grant select, insert
  on public.owner_dashboard_audit
  to service_role;

grant usage, select
  on sequence public.owner_dashboard_audit_id_seq
  to service_role;

create or replace function public.owner_set_main_baseline(
  p_meter numeric,
  p_actor uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id public.station_baselines.id%type;
  previous_meter numeric;
  result jsonb;
begin
  if
    p_meter is null
    or p_meter::text in ('NaN', 'Infinity', '-Infinity')
    or p_meter < 0
    or p_meter > 1000000000000
    or p_actor is null
    or p_reason is null
    or length(trim(p_reason)) < 10
    or length(p_reason) > 500
  then
    raise exception 'Invalid baseline change';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('dong-gas-main-baseline')
  );

  if (
    select count(*)
    from public.station_baselines
    where pump_name = 'main'
  ) > 1 then
    raise exception
      'Multiple main baselines exist; review configuration first';
  end if;

  select id, baseline_meter
  into existing_id, previous_meter
  from public.station_baselines
  where pump_name = 'main'
  limit 1
  for update;

  if found then
    update public.station_baselines
    set
      baseline_meter = p_meter,
      updated_at = now()
    where id = existing_id;
  else
    insert into public.station_baselines (
      id, pump_name, baseline_meter, updated_at
    )
    values (
      1, 'main', p_meter, now()
    );
  end if;

  result := jsonb_build_object(
    'baseline_meter', p_meter
  );

  insert into public.owner_dashboard_audit (
    actor_user_id,
    action,
    old_value,
    new_value,
    reason
  )
  values (
    p_actor,
    'main_baseline_updated',
    jsonb_build_object('baseline_meter', previous_meter),
    result,
    trim(p_reason)
  );

  return result;
end;
$$;

revoke all
  on function public.owner_set_main_baseline(numeric, uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.owner_set_main_baseline(numeric, uuid, text)
  to service_role;

-- This preserves the current unauthenticated supervisor workflow.
-- Input validation does not establish a staff member's identity.
-- It permits insert-only submissions, not financial reads or edits.

create or replace function public.submit_supervisor_shift(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  shift_uuid uuid;
  supervisor text;
  open_meter numeric;
  close_meter numeric;
  price numeric;
  cash numeric;
  momo numeric;
  expense numeric;
  opening_photo text;
  closing_photo text;
  inserted_id public.shifts.id%type;
  existing public.shifts%rowtype;
begin
  if
    p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 13000000
  then
    raise exception 'Invalid submission';
  end if;

  shift_uuid := (p_payload->>'client_shift_id')::uuid;
  supervisor := trim(p_payload->>'supervisor_name');
  open_meter := (p_payload->>'opening_meter')::numeric;
  close_meter := (p_payload->>'closing_meter')::numeric;
  price := (p_payload->>'fuel_price')::numeric;
  cash := (p_payload->>'cash_collected')::numeric;
  momo := (p_payload->>'momo_collected')::numeric;
  expense := (p_payload->>'expenses')::numeric;
  opening_photo := p_payload->>'opening_proof_image';
  closing_photo := p_payload->>'proof_image';

  if
    shift_uuid is null
    or supervisor is null
    or length(supervisor) < 1
    or length(supervisor) > 120
    or open_meter is null
    or close_meter is null
    or price is null
    or cash is null
    or momo is null
    or expense is null
    or open_meter < 0
    or open_meter > 1000000000000
    or close_meter <= open_meter
    or close_meter > 1000000000000
    or price <= 0
    or price > 1000000
    or cash < 0
    or cash > 1000000000000
    or momo < 0
    or momo > 1000000000000
    or expense < 0
    or expense > 1000000000000
    or open_meter::text in ('NaN', 'Infinity', '-Infinity')
    or close_meter::text in ('NaN', 'Infinity', '-Infinity')
    or price::text in ('NaN', 'Infinity', '-Infinity')
    or cash::text in ('NaN', 'Infinity', '-Infinity')
    or momo::text in ('NaN', 'Infinity', '-Infinity')
    or expense::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception 'Invalid shift fields';
  end if;

  select *
  into existing
  from public.shifts
  where client_shift_id = shift_uuid;

  if found then
    if
      existing.supervisor_name = supervisor
      and existing.opening_meter::numeric = open_meter
      and existing.closing_meter::numeric = close_meter
      and existing.fuel_price::numeric = price
      and existing.cash_collected::numeric = cash
      and existing.momo_collected::numeric = momo
      and existing.expenses::numeric = expense
    then
      return jsonb_build_object(
        'accepted', true,
        'already_saved', true
      );
    end if;

    raise exception
      'Shift reference conflicts with an existing submission';
  end if;

  if
    opening_photo is null
    or closing_photo is null
    or length(opening_photo) > 6000000
    or length(closing_photo) > 6000000
    or opening_photo !~ '^data:image/(jpeg|png|webp);base64,'
    or closing_photo !~ '^data:image/(jpeg|png|webp);base64,'
  then
    raise exception 'Both meter photos are required';
  end if;

  insert into public.shifts (
    client_shift_id,
    supervisor_name,
    fuel_price,
    opening_meter,
    closing_meter,
    cash_collected,
    momo_collected,
    expenses,
    opening_proof_image,
    proof_image
  )
  values (
    shift_uuid,
    supervisor,
    price,
    open_meter,
    close_meter,
    cash,
    momo,
    expense,
    opening_photo,
    closing_photo
  )
  on conflict (client_shift_id)
  do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select *
    into existing
    from public.shifts
    where client_shift_id = shift_uuid;

    if
      not found
      or existing.supervisor_name is distinct from supervisor
      or existing.opening_meter::numeric is distinct from open_meter
      or existing.closing_meter::numeric is distinct from close_meter
      or existing.fuel_price::numeric is distinct from price
      or existing.cash_collected::numeric is distinct from cash
      or existing.momo_collected::numeric is distinct from momo
      or existing.expenses::numeric is distinct from expense
    then
      raise exception
        'Shift reference conflicts with an existing submission';
    end if;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'already_saved', inserted_id is null
  );
end;
$$;

revoke all
  on function public.submit_supervisor_shift(jsonb)
  from public, anon, authenticated;

grant execute
  on function public.submit_supervisor_shift(jsonb)
  to anon, authenticated, service_role;

commit;