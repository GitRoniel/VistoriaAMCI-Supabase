-- Stub mínimo do ambiente Supabase para testes locais
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
create publication supabase_realtime;
-- Storage (só o necessário para as políticas dos relatórios da revistoria)
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null,
  owner uuid, metadata jsonb default '{}'::jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, delete on storage.objects to authenticated;
