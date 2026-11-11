-- ============================================================
-- The Fat List database. Paste this whole file into
-- Supabase > SQL Editor > New query, then press Run. Safe to run again.
-- ============================================================
create extension if not exists pg_trgm;

create table if not exists coins (
  id text primary key,
  chain text not null,
  address text not null,
  address_lc text generated always as (lower(address)) stored,
  name text not null default '',
  symbol text not null default '',
  image text,
  description text not null default '',
  website text, x text, telegram text, discord text,
  contact text,
  status text not null default 'pending',      -- pending | approved | indexed | rejected | removed
  source text not null default 'submitted',    -- submitted | indexed | admin
  verified boolean not null default false,
  verify_paid boolean not null default false,
  votes integer not null default 0,
  pair_address text, dex_url text,
  price double precision, change24 double precision, mcap double precision,
  liquidity double precision, volume24 double precision, pair_created_at timestamptz,
  market_at timestamptz,
  liquidity_at_listing double precision not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (chain, address_lc)
);
create index if not exists coins_status on coins (status);
create index if not exists coins_market_at on coins (market_at nulls first);
create index if not exists coins_liq on coins (liquidity desc nulls last);
create index if not exists coins_name_trgm on coins using gin (name gin_trgm_ops);
create index if not exists coins_symbol_trgm on coins using gin (symbol gin_trgm_ops);

create table if not exists claims (
  id text primary key,
  coin_id text not null references coins(id) on delete cascade,
  data jsonb not null,
  status text not null default 'pending',      -- unpaid | pending | approved | rejected
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  kind text not null,                          -- promo | boost | verify | claim
  coin_id text not null references coins(id) on delete cascade,
  coin_label text not null,
  label text not null,
  pkg text, pack text, boosts integer, hours integer, days integer,
  start_at timestamptz, end_at timestamptz,
  ad_text text,
  claim_id text,                               -- for kind = 'claim'
  usd numeric not null default 0,
  chain text not null, token text not null, token_address text,
  decimals integer, amount_raw text, amount text, eth_price double precision,
  payer text not null, pay_to text,
  status text not null default 'awaiting',     -- awaiting | paid
  tx_hash text,
  comped boolean not null default false,
  pulled boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  paid_at timestamptz
);
create unique index if not exists orders_tx on orders (chain, tx_hash) where tx_hash is not null;
create index if not exists orders_live on orders (status, end_at);
alter table orders add column if not exists claim_id text;   -- for databases made before claims were paid
alter table orders add column if not exists ad_image text;   -- left side banner picture
alter table orders add column if not exists spot integer;    -- Spotlight spot 1-3

create table if not exists votes (
  coin_id text not null references coins(id) on delete cascade,
  voter text not null, day integer not null,
  primary key (coin_id, voter, day)
);

create table if not exists users (
  address text primary key,
  name text, banned boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists users_name on users (lower(name)) where name is not null;

create table if not exists sessions (token text primary key, address text not null, exp timestamptz not null);
create table if not exists nonces (nonce text primary key, address text not null, issued text not null, host text not null, exp timestamptz not null);

create table if not exists posts (
  id text primary key,
  author text not null,
  title text not null, body text not null,
  coins text[] not null default '{}',
  disclosure boolean not null default false,
  likes integer not null default 0, comments integer not null default 0, reports integer not null default 0,
  removed boolean not null default false, removed_by text,
  created_at timestamptz not null default now()
);
create index if not exists posts_created on posts (created_at desc);
create index if not exists posts_coins on posts using gin (coins);

create table if not exists post_likes (post_id text references posts(id) on delete cascade, address text, primary key (post_id, address));
create table if not exists post_reports (post_id text references posts(id) on delete cascade, address text, primary key (post_id, address));
create table if not exists comments (
  id text primary key, post_id text not null references posts(id) on delete cascade,
  author text not null, text text not null, removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_post on comments (post_id, created_at);

create table if not exists rate (key text primary key, n integer not null, until timestamptz not null);

-- Only the website's server functions talk to these tables. Lock them from the public Supabase API.
do $$ declare t text; begin
  foreach t in array array['coins','claims','orders','votes','users','sessions','nonces','posts','post_likes','post_reports','comments','rate'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
