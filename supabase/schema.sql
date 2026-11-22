-- BBCDM Christmas Eve Classic (2026). Run in a NEW Supabase project SQL editor.
create table if not exists public.players (
  name text primary key,
  handicap numeric(6,2) check (handicap between -10 and 60)
);
create table if not exists public.player_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_name text unique not null references public.players(name)
);
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('director','committee','historian'))
);
create table if not exists public.events (
  id text primary key,
  title text not null,
  status text not null default 'registration' check (status in ('registration','draw','live','final')),
  draw_published boolean not null default false,
  championship_finalised boolean not null default false
);
create table if not exists public.pairs (
  id text primary key,
  player_a text not null references public.players(name),
  player_b text not null references public.players(name),
  group_no integer not null default 1 check (group_no between 1 and 18),
  start_hole integer not null default 1 check (start_hole between 1 and 18),
  locked boolean not null default false,
  published boolean not null default false,
  team_handicap numeric(6,2),
  created_at timestamptz not null default now(),
  constraint distinct_pair_members check (player_a<>player_b)
);
create table if not exists public.hole_scores (
  pair_id text not null references public.pairs(id) on delete cascade,
  hole integer not null check (hole between 1 and 18),
  strokes integer not null check (strokes between 1 and 20),
  selected_drive text not null references public.players(name),
  penalty integer not null default 0 check (penalty between 0 and 20),
  submitted_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(pair_id,hole)
);
create table if not exists public.score_audit (
  id bigint generated always as identity primary key,
  pair_id text not null,
  hole integer not null,
  original jsonb,
  replacement jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create table if not exists public.historical_results (
  id bigint generated always as identity primary key,
  tournament_year integer not null check (tournament_year between 2020 and 2100),
  position text,
  score numeric(10,2),
  team_members text[] not null,
  verification text not null check (verification in ('confirmed','pending','unknown')),
  result_status text not null check (result_status in ('finished','DNF'))
);
create table if not exists public.marker_assignments (
  pair_id text not null references public.pairs(id) on delete cascade,
  marker_player text not null references public.players(name),
  primary key(pair_id,marker_player)
);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users a where a.user_id=auth.uid());
$$;
create or replace function public.is_player_of(target_pair text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_accounts a join public.pairs p on p.id=target_pair
   where a.user_id=auth.uid() and a.player_name in (p.player_a,p.player_b));
$$;
create or replace function public.is_marker_for(target_pair text) returns boolean language sql stable security definer set search_path = public as $$
 select exists (select 1 from public.player_accounts a join public.marker_assignments m on m.marker_player=a.player_name where m.pair_id=target_pair and a.user_id=auth.uid());
$$;
create or replace function public.assert_valid_drive() returns trigger language plpgsql as $$
begin
 if not exists (select 1 from public.pairs p where p.id=new.pair_id and new.selected_drive in (p.player_a,p.player_b)) then
   raise exception 'Selected drive must belong to a golfer in this pair';
 end if;
 new.updated_at=now(); new.submitted_by=auth.uid(); return new;
end;$$;
drop trigger if exists score_validation on public.hole_scores;
create trigger score_validation before insert or update on public.hole_scores for each row execute function public.assert_valid_drive();
create or replace function public.log_score_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.score_audit(pair_id,hole,original,replacement,changed_by)
 values(new.pair_id,new.hole,case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),auth.uid());
 return new;
end;$$;
drop trigger if exists score_audit_trg on public.hole_scores;
create trigger score_audit_trg after insert or update on public.hole_scores for each row execute function public.log_score_change();
-- Recalculate handicaps before the round starts. Lock them once event status becomes live.
create or replace function public.update_team_handicaps() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (select status from public.events where id='bbcdm-2026') in ('registration','draw') then
   update public.pairs p set team_handicap=case when a.handicap is null or b.handicap is null then null
   else round((least(a.handicap,b.handicap)*0.35 + greatest(a.handicap,b.handicap)*0.15)::numeric,2) end
   from public.players a, public.players b where p.player_a=a.name and p.player_b=b.name and new.name in (a.name,b.name);
 end if;return new;
end;$$;
drop trigger if exists handicap_refresh on public.players;
create trigger handicap_refresh after update of handicap on public.players for each row execute function public.update_team_handicaps();
-- Atomically replace pair draw. Restricted to admins.
create or replace function public.replace_draw(new_pairs jsonb) returns void language plpgsql security definer set search_path=public as $$
declare rec jsonb; names text[]:=array[]::text[];
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 if (select status from public.events where id='bbcdm-2026') in ('live','final') then raise exception 'Draw locked after tournament start';end if;
 for rec in select value from jsonb_array_elements(new_pairs) loop
  if (rec->>'player_a')=any(names) or (rec->>'player_b')=any(names) then raise exception 'Duplicate player';end if;
  names:=names || array[rec->>'player_a',rec->>'player_b'];
 end loop;
 delete from public.pairs; -- cascades former scorecards only before event begins
 for rec in select value from jsonb_array_elements(new_pairs) loop
  insert into public.pairs(id,player_a,player_b,group_no,start_hole,locked,published,team_handicap)
  values(rec->>'id',rec->>'player_a',rec->>'player_b',(rec->>'group_no')::integer,(rec->>'start_hole')::integer,(rec->>'locked')::boolean,(rec->>'published')::boolean,(rec->>'team_handicap')::numeric);
 end loop;
end;$$;
-- Row level security
alter table public.players enable row level security;
alter table public.player_accounts enable row level security;
alter table public.admin_users enable row level security;
alter table public.events enable row level security;
alter table public.pairs enable row level security;
alter table public.hole_scores enable row level security;
alter table public.score_audit enable row level security;
alter table public.historical_results enable row level security;
alter table public.marker_assignments enable row level security;
create policy "players_public_read" on public.players for select to anon,authenticated using(true);
create policy "players_admin_update" on public.players for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "accounts_owner_or_admin_read" on public.player_accounts for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "accounts_admin_manage" on public.player_accounts for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admins_own_role_read" on public.admin_users for select to authenticated using(user_id=auth.uid());
create policy "events_public_read" on public.events for select to anon,authenticated using(true);
create policy "events_admin_update" on public.events for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "pairs_visibility" on public.pairs for select to anon,authenticated using((select draw_published from public.events where id='bbcdm-2026') or public.is_admin());
create policy "pairs_admin_manage" on public.pairs for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "scores_read" on public.hole_scores for select to anon,authenticated using((select draw_published from public.events where id='bbcdm-2026') or public.is_admin());
create policy "scores_insert" on public.hole_scores for insert to authenticated with check((public.is_admin() or public.is_player_of(pair_id) or public.is_marker_for(pair_id)) and (select status from public.events where id='bbcdm-2026')='live');
create policy "scores_update" on public.hole_scores for update to authenticated using((public.is_admin() or public.is_player_of(pair_id) or public.is_marker_for(pair_id)) and (select status from public.events where id='bbcdm-2026')='live') with check((public.is_admin() or public.is_player_of(pair_id) or public.is_marker_for(pair_id)) and (select status from public.events where id='bbcdm-2026')='live');
create policy "audit_admin_read" on public.score_audit for select to authenticated using(public.is_admin());
create policy "historical_public_read" on public.historical_results for select to anon,authenticated using(true);
create policy "historical_admin_write" on public.historical_results for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "markers_read" on public.marker_assignments for select to authenticated using(public.is_admin() or public.is_marker_for(pair_id));
create policy "markers_admin_write" on public.marker_assignments for all to authenticated using(public.is_admin()) with check(public.is_admin());
-- Enable realtime publication when supported
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.events,public.players,public.pairs,public.hole_scores; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
