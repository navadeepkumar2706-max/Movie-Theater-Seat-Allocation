-- Movie Theater Seat Allocation — run this once in Supabase SQL Editor.
-- Safe to re-run: objects and demo rows are created idempotently.

create extension if not exists pgcrypto;

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_staff_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.staff_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update
    set full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff_profile on auth.users;
create trigger on_auth_user_created_staff_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_staff_user();

create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  genre text not null,
  rating text not null,
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  poster_tone text not null default 'violet',
  created_at timestamptz not null default now()
);

create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  row_count integer not null check (row_count between 1 and 20),
  seats_per_row integer not null check (seats_per_row between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references public.screens(id) on delete cascade,
  row_label text not null,
  seat_number integer not null check (seat_number > 0),
  zone text not null check (zone in ('front', 'standard', 'premium', 'accessible')),
  unique (screen_id, row_label, seat_number)
);

create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete restrict,
  screen_id uuid not null references public.screens(id) on delete restrict,
  starts_at timestamptz not null,
  language text not null default 'English',
  format text not null default 'Standard',
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.group_requests (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  label text not null,
  group_size integer not null check (group_size between 1 and 30),
  preferred_zone text not null default 'any'
    check (preferred_zone in ('any', 'front', 'standard', 'premium', 'accessible')),
  prefer_together boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'allocated')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.allocations (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  seat_id uuid not null references public.seats(id) on delete restrict,
  group_request_id uuid not null references public.group_requests(id) on delete cascade,
  allocated_by uuid references auth.users(id) on delete set null,
  allocated_at timestamptz not null default now(),
  released_at timestamptz
);

-- This partial unique index is the final line of defense against concurrent
-- allocation requests from different staff members.
create unique index if not exists allocations_one_active_seat_per_show
  on public.allocations (show_id, seat_id)
  where released_at is null;

create index if not exists group_requests_show_created_idx
  on public.group_requests (show_id, created_at desc);
create index if not exists allocations_group_active_idx
  on public.allocations (group_request_id)
  where released_at is null;

alter table public.staff_profiles enable row level security;
alter table public.movies enable row level security;
alter table public.screens enable row level security;
alter table public.seats enable row level security;
alter table public.shows enable row level security;
alter table public.group_requests enable row level security;
alter table public.allocations enable row level security;

drop policy if exists "staff can read own profile" on public.staff_profiles;
create policy "staff can read own profile"
  on public.staff_profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "authenticated staff can manage movies" on public.movies;
create policy "authenticated staff can manage movies"
  on public.movies for all to authenticated
  using (true) with check (true);

drop policy if exists "authenticated staff can manage screens" on public.screens;
create policy "authenticated staff can manage screens"
  on public.screens for all to authenticated
  using (true) with check (true);

drop policy if exists "authenticated staff can manage seats" on public.seats;
create policy "authenticated staff can manage seats"
  on public.seats for select to authenticated
  using (true);

drop policy if exists "authenticated staff can manage shows" on public.shows;
create policy "authenticated staff can manage shows"
  on public.shows for all to authenticated
  using (true) with check (true);

drop policy if exists "authenticated staff can manage group requests" on public.group_requests;
create policy "authenticated staff can manage group requests"
  on public.group_requests for all to authenticated
  using (true) with check (true);

drop policy if exists "authenticated staff can read allocations" on public.allocations;
create policy "authenticated staff can read allocations"
  on public.allocations for select to authenticated
  using (true);

create or replace function public.create_screen_with_seats(
  p_name text,
  p_row_count integer,
  p_seats_per_row integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_screen_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to create a screen';
  end if;
  if p_row_count < 1 or p_row_count > 20 or p_seats_per_row < 1 or p_seats_per_row > 30 then
    raise exception 'Screen dimensions must be within the supported range';
  end if;

  insert into public.screens (name, row_count, seats_per_row)
  values (trim(p_name), p_row_count, p_seats_per_row)
  returning id into v_screen_id;

  insert into public.seats (screen_id, row_label, seat_number, zone)
  select
    v_screen_id,
    chr(64 + row_number),
    seat_number,
    case
      when seat_number in (1, p_seats_per_row) then 'accessible'
      when row_number = 1 then 'front'
      when row_number >= ceil(p_row_count * 0.65) then 'premium'
      else 'standard'
    end
  from generate_series(1, p_row_count) as rows(row_number)
  cross join generate_series(1, p_seats_per_row) as columns(seat_number);

  return v_screen_id;
end;
$$;

create or replace function public.allocate_group_seats(
  p_group_request_id uuid,
  p_seat_ids uuid[]
)
returns setof public.allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.group_requests%rowtype;
  v_valid_count integer;
  v_unique_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to allocate seats';
  end if;

  select * into v_group
  from public.group_requests
  where id = p_group_request_id
  for update;
  if not found then
    raise exception 'Group request not found';
  end if;
  if v_group.status <> 'pending' then
    raise exception 'Group request already has an allocation';
  end if;
  if coalesce(cardinality(p_seat_ids), 0) <> v_group.group_size then
    raise exception 'The seat count must match the requested group size';
  end if;

  select count(distinct chosen.id)
  into v_unique_count
  from unnest(p_seat_ids) as requested(id)
  join public.seats chosen on chosen.id = requested.id;
  if v_unique_count <> v_group.group_size then
    raise exception 'Seat selection is invalid or contains duplicates';
  end if;

  select count(*)
  into v_valid_count
  from public.seats chosen
  join public.shows current_show on current_show.id = v_group.show_id
    and current_show.screen_id = chosen.screen_id
  where chosen.id = any(p_seat_ids);
  if v_valid_count <> v_group.group_size then
    raise exception 'All selected seats must belong to this show screen';
  end if;

  -- A competing allocation that wins first causes the unique index to reject
  -- this statement. PostgreSQL rolls the function call back atomically.
  return query
    insert into public.allocations (show_id, seat_id, group_request_id, allocated_by)
    select v_group.show_id, chosen.id, v_group.id, auth.uid()
    from public.seats chosen
    where chosen.id = any(p_seat_ids)
    returning *;

  update public.group_requests
  set status = 'allocated'
  where id = v_group.id;
end;
$$;

create or replace function public.release_seat(p_allocation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_released integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to release seats';
  end if;

  update public.allocations
  set released_at = now()
  where id = p_allocation_id and released_at is null
  returning group_request_id into v_group_id;
  get diagnostics v_released = row_count;
  if v_released = 0 then
    raise exception 'This seat is already available';
  end if;

  if not exists (
    select 1 from public.allocations
    where group_request_id = v_group_id and released_at is null
  ) then
    update public.group_requests set status = 'pending' where id = v_group_id;
  end if;
  return true;
end;
$$;

revoke all on function public.create_screen_with_seats(text, integer, integer) from public, anon;
revoke all on function public.allocate_group_seats(uuid, uuid[]) from public, anon;
revoke all on function public.release_seat(uuid) from public, anon;
grant execute on function public.create_screen_with_seats(text, integer, integer) to authenticated;
grant execute on function public.allocate_group_seats(uuid, uuid[]) to authenticated;
grant execute on function public.release_seat(uuid) to authenticated;

grant select, insert, update, delete on public.movies, public.screens, public.shows, public.group_requests to authenticated;
grant select on public.seats, public.allocations, public.staff_profiles to authenticated;
grant usage on schema public to authenticated;

-- Sample catalogue and two screens.
insert into public.movies (id, title, genre, rating, duration_minutes, poster_tone)
values
  ('10000000-0000-4000-8000-000000000001', 'The Last Meridian', 'Sci-fi adventure', 'PG-13', 128, 'violet'),
  ('10000000-0000-4000-8000-000000000002', 'Paper Moons', 'Romance', 'PG', 104, 'rose'),
  ('10000000-0000-4000-8000-000000000003', 'Neon Pursuit', 'Action thriller', 'R', 116, 'amber')
on conflict (id) do nothing;

insert into public.screens (id, name, row_count, seats_per_row)
values
  ('20000000-0000-4000-8000-000000000001', 'Grand Hall', 8, 12),
  ('20000000-0000-4000-8000-000000000002', 'Studio 2', 8, 10)
on conflict (id) do nothing;

insert into public.seats (screen_id, row_label, seat_number, zone)
select screen.id, chr(64 + row_number), seat_number,
  case
    when seat_number in (1, screen.seats_per_row) then 'accessible'
    when row_number = 1 then 'front'
    when row_number >= ceil(screen.row_count * 0.65) then 'premium'
    else 'standard'
  end
from public.screens screen
cross join generate_series(1, screen.row_count) as rows(row_number)
cross join generate_series(1, screen.seats_per_row) as columns(seat_number)
where screen.id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
)
on conflict (screen_id, row_label, seat_number) do nothing;

insert into public.shows (id, movie_id, screen_id, starts_at, language, format)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    date_trunc('hour', now()) + interval '4 hours',
    'English',
    'IMAX'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    date_trunc('hour', now()) + interval '6 hours',
    'English',
    'Standard'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    date_trunc('hour', now()) + interval '2 hours',
    'Hindi',
    'Dolby Atmos'
  )
on conflict (id) do nothing;

insert into public.group_requests (
  id, show_id, label, group_size, preferred_zone, prefer_together, status
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Patel family',
    4,
    'premium',
    true,
    'allocated'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    'Film club',
    6,
    'standard',
    true,
    'pending'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000002',
    'Jones party',
    2,
    'any',
    true,
    'allocated'
  )
on conflict (id) do nothing;

insert into public.allocations (show_id, seat_id, group_request_id)
select group_row.show_id, seat.id, group_row.id
from (values
  ('40000000-0000-4000-8000-000000000001'::uuid, 'G', 5),
  ('40000000-0000-4000-8000-000000000001'::uuid, 'G', 6),
  ('40000000-0000-4000-8000-000000000001'::uuid, 'G', 7),
  ('40000000-0000-4000-8000-000000000001'::uuid, 'G', 8),
  ('40000000-0000-4000-8000-000000000003'::uuid, 'F', 5),
  ('40000000-0000-4000-8000-000000000003'::uuid, 'F', 6)
) seed(group_id, row_label, seat_number)
join public.group_requests group_row on group_row.id = seed.group_id
join public.shows current_show on current_show.id = group_row.show_id
join public.seats seat
  on seat.screen_id = current_show.screen_id
  and seat.row_label = seed.row_label
  and seat.seat_number = seed.seat_number
on conflict do nothing;
