-- The Holders Room: sessions, chat, promotion submissions and removals.
-- Same shape as every other collection — the API keeps its working set in memory and writes each change through here.

create table if not exists room_sessions (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists room_sessions_created_at_idx on room_sessions (created_at desc);

create table if not exists room_messages (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists room_messages_created_at_idx on room_messages (created_at desc);

create table if not exists room_promos (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists room_promos_created_at_idx on room_promos (created_at desc);

-- id is the wallet address, so a removal is idempotent
create table if not exists room_bans (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
