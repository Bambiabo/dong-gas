-- Shared active shift
-- One live shift per station/main pump. Completed shifts remain in public.shifts.

create table if not exists public.active_shifts (
  id uuid primary key default gen_random_uuid(),
  station text not null default 'Dong Gas',
  pump_name text not null default 'main',
  shift_id uuid not null unique,
  supervisor_name text not null,
  fuel_price numeric not null check (fuel_price > 0),
  opening_meter numeric not null check (opening_meter >= 0),
  opening_source text not null default 'Supervisor entered opening meter',
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists active_shifts_station_pump_live
  on public.active_shifts (station, pump_name)
  where closed_at is null;

alter table public.active_shifts enable row level security;

create policy "Authenticated supervisors can read the live shift"
  on public.active_shifts
  for select
  to authenticated
  using (true);

create policy "Authenticated supervisors can open one live shift"
  on public.active_shifts
  for insert
  to authenticated
  with check (
    closed_at is null
    and not exists (
      select 1
      from public.active_shifts existing
      where existing.station = active_shifts.station
        and existing.pump_name = active_shifts.pump_name
        and existing.closed_at is null
    )
  );

create policy "Authenticated supervisors can update the live shift"
  on public.active_shifts
  for update
  to authenticated
  using (closed_at is null)
  with check (closed_at is null);

create or replace function public.close_active_shift(
  p_shift_id uuid,
  p_closing_meter numeric,
  p_cash numeric,
  p_momo numeric,
  p_expenses numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active public.active_shifts;
begin
  select * into active
  from public.active_shifts
  where shift_id = p_shift_id
    and closed_at is null
  for update;

  if not found then
    raise exception 'This shift has already been closed or is not active.';
  end if;

  if p_closing_meter <= active.opening_meter then
    raise exception 'Closing meter must exceed opening meter.';
  end if;

  if p_cash < 0 or p_momo < 0 or p_expenses < 0 then
    raise exception 'Collection amounts cannot be negative.';
  end if;

  update public.active_shifts
  set closed_at = now(),
      updated_at = now()
  where id = active.id;
end;
$$;

revoke all on function public.close_active_shift(uuid, numeric, numeric, numeric, numeric) from anon;
grant execute on function public.close_active_shift(uuid, numeric, numeric, numeric, numeric) to authenticated;
