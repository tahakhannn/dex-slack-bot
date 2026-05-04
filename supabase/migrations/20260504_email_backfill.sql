-- Email backfill migration
-- Adds unique constraint on employees.email to prevent duplicates

-- Ensure email column exists on employees table
alter table if exists public.employees
  add column if not exists email text;

-- Add unique index (only for non-null emails to allow multiple nulls)
create unique index if not exists idx_employees_email_unique
  on public.employees (email)
  where email is not null;
