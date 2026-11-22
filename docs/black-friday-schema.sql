-- Black Friday Command Center — Optional PostgreSQL / Supabase Persistent Schema
-- Out of the box, the server uses atomic file persistence + rolling backups + GitHub Actions
-- black-friday-data snapshot sync. If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
-- create this table to mirror complete state in Supabase PostgreSQL.

create table if not exists public.black_friday_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Optional normalized reporting tables for external SQL analytics:
create table if not exists public.bf_price_observations (
  id bigserial primary key,
  canonical_key text not null,
  retailer_id text not null,
  retailer_name text not null,
  source_id text not null,
  price numeric(10, 2) not null,
  regular_price numeric(10, 2),
  shipping_cost numeric(10, 2),
  all_in_total numeric(10, 2),
  availability_status text not null default 'unverified',
  condition text not null default 'new',
  url text,
  observed_at timestamptz not null default now()
);

create index if not exists idx_bf_price_obs_key_time
  on public.bf_price_observations (canonical_key, observed_at desc);

create table if not exists public.bf_wishlist_items (
  id text primary key,
  profile_id text not null,
  name text not null,
  brand text,
  model_number text,
  upc text,
  gtin text,
  asin text,
  preferred_price numeric(10, 2),
  max_price numeric(10, 2),
  recipient text,
  priority text not null default 'standard',
  status text not null default 'monitoring',
  source_url text,
  canonical_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
