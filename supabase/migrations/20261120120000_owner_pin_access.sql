-- Owner PIN access
create table if not exists public.owner_pin (
  id integer primary key check (id = 1),
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.owner_pin enable row level security;

-- No public policies: only the service role may read or update this table.
