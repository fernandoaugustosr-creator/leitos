begin;

create table if not exists public.app_state (
  id text primary key,
  payload jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_state_payload_or_data_check check (payload is not null or data is not null)
);

alter table public.app_state add column if not exists payload jsonb;
alter table public.app_state add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.app_state add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists app_state_updated_at_idx on public.app_state (updated_at desc);

create or replace function public.sync_app_state_columns()
returns trigger
language plpgsql
as $$
begin
  if new.payload is null and new.data is null then
    raise exception 'payload or data must be informed';
  end if;

  if new.payload is null then
    new.payload := new.data;
  elsif new.data is null then
    new.data := new.payload;
  else
    new.data := new.payload;
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_sync_app_state_columns on public.app_state;

create trigger trg_sync_app_state_columns
before insert or update on public.app_state
for each row
execute function public.sync_app_state_columns();

alter table public.app_state enable row level security;

drop policy if exists "app_state_select" on public.app_state;
drop policy if exists "app_state_insert" on public.app_state;
drop policy if exists "app_state_update" on public.app_state;

create policy "app_state_select"
on public.app_state
for select
to anon, authenticated
using (true);

create policy "app_state_insert"
on public.app_state
for insert
to anon, authenticated
with check (true);

create policy "app_state_update"
on public.app_state
for update
to anon, authenticated
using (true)
with check (true);

commit;
