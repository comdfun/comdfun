-- cICM — Company Inference Capital Markets. Credit bought with $COMD and spent on model calls.
--
-- Four tables, one shape, because the control plane keeps its working set in memory and writes each change
-- through: the row is the record and `data` is the whole of it. The indexes are the three questions actually
-- asked at runtime — whose account is this, which key is this, and has this transaction already been credited.

create table if not exists icm_accounts (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
-- one account per owner, enforced here as well as in the ledger: two accounts for one wallet would split a balance
create unique index if not exists icm_accounts_owner_idx on icm_accounts ((data->>'owner'));

create table if not exists icm_keys (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
-- a key is found by the hash of the secret presented, on every single call
create unique index if not exists icm_keys_hash_idx on icm_keys ((data->>'hash'));
create index if not exists icm_keys_account_idx on icm_keys ((data->>'accountId'));

create table if not exists icm_deposits (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
-- the reference is what stops a replayed block crediting the same payment twice
create unique index if not exists icm_deposits_ref_idx on icm_deposits ((data->>'ref'));
create index if not exists icm_deposits_account_idx on icm_deposits ((data->>'accountId'));

create table if not exists icm_charges (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists icm_charges_account_idx on icm_charges ((data->>'accountId'));
-- the operator's two standing questions: what is still held, and what ended in an unknown state
create index if not exists icm_charges_state_idx on icm_charges ((data->>'state'), created_at desc);
