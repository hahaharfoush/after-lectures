-- Events students add from screenshots, and a log used to rate-limit the
-- functions that read screenshots (Gemini quota) and add events.

create table public.submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  status      text not null default 'live' check (status in ('live', 'hidden')),
  title       text not null check (char_length(title) between 3 and 140),
  society     text check (char_length(society) <= 80),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  location    text check (char_length(location) <= 120),
  campus      text check (char_length(campus) <= 40),
  price       text check (char_length(price) <= 60),
  tags        text[] not null default '{}',
  description text check (char_length(description) <= 1500),
  source_url  text check (char_length(source_url) <= 300),
  read_by     text,       -- the model that read the screenshot, if one was used
  ip_hash     text        -- salted hash, only for spotting abuse
);

create index submissions_upcoming on public.submissions (starts_at) where status = 'live';

-- Anyone may read live events. Nobody can write directly: new events come in
-- through the add-event function, which validates them first.
alter table public.submissions enable row level security;
create policy "live events are public" on public.submissions
  for select to anon, authenticated using (status = 'live');

create table public.usage (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('read', 'add')),
  ip_hash     text not null
);
create index usage_recent on public.usage (kind, created_at);

-- No policies: only the functions (service role) touch this table.
alter table public.usage enable row level security;
