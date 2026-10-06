-- Company.md control plane schema v1.
-- One table per collection: the API keeps its working set in memory and writes every change through here.
-- `data` holds the full record as served by the API; the extra columns exist for operators' queries and indexes.

create table if not exists jobs (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists jobs_created_at_idx on jobs (created_at desc);
create table if not exists submissions (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists submissions_created_at_idx on submissions (created_at desc);
create table if not exists attempts (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists attempts_created_at_idx on attempts (created_at desc);
create table if not exists orders (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists orders_created_at_idx on orders (created_at desc);
create table if not exists oracle (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists oracle_created_at_idx on oracle (created_at desc);
create table if not exists schedules (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists schedules_created_at_idx on schedules (created_at desc);
create table if not exists runs (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists runs_created_at_idx on runs (created_at desc);
create table if not exists workflows (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists workflows_created_at_idx on workflows (created_at desc);
create table if not exists launches (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists launches_created_at_idx on launches (created_at desc);
create table if not exists policies (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists policies_created_at_idx on policies (created_at desc);
create table if not exists assurances (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists assurances_created_at_idx on assurances (created_at desc);
create table if not exists sites (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists sites_created_at_idx on sites (created_at desc);
create table if not exists enrollments (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists enrollments_created_at_idx on enrollments (created_at desc);
create table if not exists pairings (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists pairings_created_at_idx on pairings (created_at desc);
create table if not exists seats (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists seats_created_at_idx on seats (created_at desc);
create table if not exists feedback (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists feedback_created_at_idx on feedback (created_at desc);
create table if not exists documents (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists documents_created_at_idx on documents (created_at desc);
create table if not exists bundles (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists bundles_created_at_idx on bundles (created_at desc);
create table if not exists artifacts (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists artifacts_created_at_idx on artifacts (created_at desc);
create table if not exists fuzz (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists fuzz_created_at_idx on fuzz (created_at desc);
create table if not exists epochs (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists epochs_created_at_idx on epochs (created_at desc);
create table if not exists events (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists events_created_at_idx on events (created_at desc);
create table if not exists kv (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists kv_created_at_idx on kv (created_at desc);
create table if not exists nonces (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists nonces_created_at_idx on nonces (created_at desc);

create index if not exists jobs_state_idx on jobs ((data->>'state'));
create index if not exists jobs_paid_by_idx on jobs ((data->>'paidBy'));
create index if not exists orders_payer_idx on orders ((data->>'payer'));
create index if not exists orders_scope_key_idx on orders ((data->>'scopeHash'), (data->>'requestKey'));
create index if not exists oracle_status_idx on oracle ((data->>'status'));
create index if not exists schedules_owner_idx on schedules ((data->>'owner'));
create index if not exists attempts_token_idx on attempts ((data->>'tokenId'));
create index if not exists submissions_job_idx on submissions ((data->>'jobId'));
create unique index if not exists sites_label_live_idx on sites ((data->>'label'), (data->>'id'));
create index if not exists enrollments_token_idx on enrollments ((data->>'tokenId'));
