-- stash web: run once in the Supabase SQL editor of the stash project. Safe to run again.
-- The app connects through DATABASE_URL on the server. It uses no browser database keys, and
-- every table below has row level security with no policies, which keeps Supabase's public
-- Data API out of it.

-- Better Auth accounts and sessions (Google sign-in). Matches Better Auth 1.7's own schema;
-- tests/schema-postgres.test.ts checks that Better Auth finds nothing missing.
create table if not exists public."user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null
);
create table if not exists public."session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references public."user" ("id") on delete cascade
);
create index if not exists "session_userId_idx" on public."session" ("userId");
create table if not exists public."account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references public."user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null
);
create index if not exists "account_userId_idx" on public."account" ("userId");
create table if not exists public."verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null
);
create index if not exists "verification_identifier_idx" on public."verification" ("identifier");

-- Saved links. `record` is the item exactly as the app uses it (src/lib/item.ts), and
-- `dedupe_key` is copied out of it so one account can hold only one live item per page.
-- A deleted item stays as a small tombstone with a null key, so the deletion reaches every device.
create sequence if not exists public.stash_sync_revision;
create table if not exists public.stash_items (
  user_id text not null references public."user" ("id") on delete cascade,
  id uuid not null,
  record jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 32768),
  dedupe_key text check (dedupe_key is null or length(dedupe_key) <= 8192),
  revision bigint not null default nextval('public.stash_sync_revision'),
  primary key (user_id, id)
);
create index if not exists stash_items_user_revision on public.stash_items (user_id, revision);
create unique index if not exists stash_items_user_page on public.stash_items (user_id, dedupe_key) where dedupe_key is not null;

-- One row per account once its first-launch article has been offered, so it never comes back.
create table if not exists public.stash_accounts (
  user_id text primary key references public."user" ("id") on delete cascade,
  seeded_at timestamptz not null default now()
);

-- Shared request counters for the page-details endpoint, keyed by a keyed hash of the address.
create table if not exists public.stash_request_limits (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  requests integer not null check (requests > 0)
);
create index if not exists stash_request_limits_window on public.stash_request_limits (window_start);

alter table public."user" enable row level security;
alter table public."session" enable row level security;
alter table public."account" enable row level security;
alter table public."verification" enable row level security;
alter table public.stash_items enable row level security;
alter table public.stash_accounts enable row level security;
alter table public.stash_request_limits enable row level security;

revoke all on public."user", public."session", public."account", public."verification",
  public.stash_items, public.stash_accounts, public.stash_request_limits from public;
revoke all on sequence public.stash_sync_revision from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public."user", public."session", public."account", public."verification",
      public.stash_items, public.stash_accounts, public.stash_request_limits from anon;
    revoke all on sequence public.stash_sync_revision from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public."user", public."session", public."account", public."verification",
      public.stash_items, public.stash_accounts, public.stash_request_limits from authenticated;
    revoke all on sequence public.stash_sync_revision from authenticated;
  end if;
end $$;
