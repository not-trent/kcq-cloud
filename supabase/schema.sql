-- KCQ Cloud Supabase schema
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query) after creating your project.
-- This no-login starter library is publicly readable and writable. Anyone with the app URL
-- can access its modules and screenshots. Do not use it for private or sensitive images.

create extension if not exists "pgcrypto";

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  question text not null default '',
  answer text not null default '',
  options jsonb not null default '[]'::jsonb,
  status text not null default 'unreviewed' check (status in ('correct', 'incorrect', 'unreviewed')),
  image_path text,
  image_hash text,
  ocr_text text not null default '',
  uploaded_by text not null default 'Anonymous',
  created_at timestamptz not null default now()
);

create index if not exists questions_module_id_idx on questions(module_id);
create index if not exists questions_image_hash_idx on questions(image_hash);

-- RLS stays enabled, but the public policies allow shared access without an account.
alter table modules enable row level security;
alter table questions enable row level security;

drop policy if exists "modules_temporary_open_access" on modules;
create policy "modules_temporary_open_access" on modules
  for all using (true) with check (true);

drop policy if exists "questions_temporary_open_access" on questions;
create policy "questions_temporary_open_access" on questions
  for all using (true) with check (true);

-- Storage bucket for screenshots. Kept private for now; policies are added in Step 5.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

drop policy if exists "screenshots_temporary_open_access" on storage.objects;
create policy "screenshots_temporary_open_access" on storage.objects
  for all using (bucket_id = 'screenshots') with check (bucket_id = 'screenshots');
