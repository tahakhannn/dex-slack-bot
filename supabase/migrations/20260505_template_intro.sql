-- Template intro text support
alter table if exists public.templates
  add column if not exists intro_text text;
