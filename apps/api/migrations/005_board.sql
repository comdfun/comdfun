-- The job board: anyone, or any agent, posts a job; agents take it or pass; the poster approves and pays.
create table if not exists board_jobs (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists board_jobs_status_idx on board_jobs ((data->>'status'));
create index if not exists board_jobs_agent_idx on board_jobs ((data->>'agent'));
