-- One free matter per wallet: the record that makes "one" enforceable across restarts.
create table if not exists trials (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists trials_created_at_idx on trials (created_at desc);
