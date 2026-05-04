alter table if exists public.employees
  add column if not exists email text;

create table if not exists public.event_overrides (
  id text primary key,
  workspace_id text,
  slack_id text not null,
  type text not null check (type in ('birthday', 'anniversary')),
  date date not null,
  custom_message text,
  gif_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_event_overrides_date
  on public.event_overrides (date);

create index if not exists idx_event_overrides_slack_type_date
  on public.event_overrides (slack_id, type, date);
