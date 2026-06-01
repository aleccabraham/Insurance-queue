-- ============================================================
-- Insurance Branch Queue — Supabase Database Setup
-- Run these statements in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Main queue table
create table if not exists queue (
  id          uuid        default gen_random_uuid() primary key,
  token       text        not null,
  name        text        not null,
  phone       text        not null,
  purpose     text        not null check (purpose in ('renewal', 'new')),
  ins_type    text        not null check (ins_type in ('motor', 'health', 'property')),

  -- Priority drives call order on the staff dashboard:
  --   1 = Renewal  (urgent: lapsing policy → customer loses existing coverage)
  --   2 = New policy (less urgent: no existing coverage at risk)
  priority    int         not null default 2,

  status      text        not null default 'waiting'
                          check (status in ('waiting', 'called', 'served')),
  escalated   boolean     default false,
  arrived_at  timestamptz default now(),
  served_at   timestamptz
);

-- 2. Single-row counter for sequential token numbers
create table if not exists token_counter (
  id          int         primary key default 1,
  last_number int         default 100
);

-- Seed the counter if it doesn't exist yet
insert into token_counter (id, last_number)
values (1, 100)
on conflict (id) do nothing;

-- 3. Optional: atomic increment function (avoids race conditions when two
--    customers submit at exactly the same moment).
--    The app falls back gracefully if this function is absent.
create or replace function increment_token_counter()
returns int
language plpgsql
as $$
declare
  new_val int;
begin
  update token_counter
  set last_number = last_number + 1
  where id = 1
  returning last_number into new_val;
  return new_val;
end;
$$;

-- 4. Enable real-time on the queue table
--    Do this in Supabase Dashboard → Database → Replication
--    → toggle ON for the "queue" table.
--    (Cannot be done via SQL; it's a dashboard setting.)
