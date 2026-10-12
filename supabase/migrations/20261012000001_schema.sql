-- Presence Monitoring — skema, RLS, grants.
-- Jalankan di Supabase cloud (SQL Editor, atau `supabase db push`).

-- ───────────── profiles & role ─────────────
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'viewer' check (role in ('admin', 'viewer')),
  display_name text
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;

-- ───────────── data sensor ─────────────
create table public.devices (
  device_id  text primary key,
  room_name  text,
  created_at timestamptz not null default now()
);

create table public.events (
  id            bigint generated always as identity primary key,
  device_id     text not null references public.devices(device_id) on delete cascade,
  ts            timestamptz not null,
  status        text not null check (status in ('occupied', 'vacant')),
  is_transition boolean not null default false,
  ts_suspect    boolean not null default false,
  received_at   timestamptz not null default now(),
  raw           jsonb,
  unique (device_id, ts, status)
);
create index events_device_ts_idx on public.events (device_id, ts);
create index events_device_transition_idx on public.events (device_id, ts) where is_transition;

create table public.device_status (
  device_id      text primary key references public.devices(device_id) on delete cascade,
  current_status text check (current_status in ('occupied', 'vacant')),
  since          timestamptz,
  online         boolean not null default true,
  last_seen      timestamptz
);

create table public.device_online_log (
  id        bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  online    boolean not null,
  ts        timestamptz not null default now()
);
create index online_log_device_ts_idx on public.device_online_log (device_id, ts);

-- ───────────── konfigurasi MQTT ─────────────
create table public.mqtt_config (
  id           int primary key default 1 check (id = 1),
  host         text not null,
  port         int  not null check (port between 1 and 65535),
  protocol     text not null check (protocol in ('mqtt', 'mqtts', 'ws', 'wss')),
  username     text,
  has_password boolean not null default false,
  topic_status text not null,
  topic_online text,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Referensi ke Vault; hanya service_role (tanpa policy, tanpa grant).
create table public.mqtt_secret (
  id        int primary key default 1 check (id = 1),
  secret_id uuid not null
);

create table public.ingest_status (
  id            int primary key default 1 check (id = 1),
  state         text not null default 'unconfigured'
                check (state in ('unconfigured', 'connected', 'reconnecting', 'error')),
  last_message_at timestamptz,
  last_error    text,
  msg_count     bigint not null default 0,
  invalid_count bigint not null default 0,
  devices       text[] not null default '{}',
  recent        jsonb not null default '[]',
  updated_at    timestamptz not null default now()
);
insert into public.ingest_status (id) values (1);

create table public.mqtt_test_requests (
  id              bigint generated always as identity primary key,
  requested_by    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload         jsonb not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'running', 'done', 'failed')),
  steps           jsonb not null default '[]',
  sample_messages jsonb not null default '[]',
  created_at      timestamptz not null default now()
);

-- ───────────── RLS ─────────────
alter table public.profiles           enable row level security;
alter table public.devices            enable row level security;
alter table public.events             enable row level security;
alter table public.device_status      enable row level security;
alter table public.device_online_log  enable row level security;
alter table public.mqtt_config        enable row level security;
alter table public.mqtt_secret        enable row level security;
alter table public.ingest_status      enable row level security;
alter table public.mqtt_test_requests enable row level security;

create policy profiles_read   on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy devices_read   on public.devices for select to authenticated using (true);
create policy devices_update on public.devices for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy events_read        on public.events            for select to authenticated using (true);
create policy device_status_read on public.device_status    for select to authenticated using (true);
create policy online_log_read    on public.device_online_log for select to authenticated using (true);

create policy mqtt_config_read  on public.mqtt_config   for select to authenticated using (public.is_admin());
create policy ingest_status_read on public.ingest_status for select to authenticated using (public.is_admin());

create policy test_read   on public.mqtt_test_requests for select to authenticated using (public.is_admin());
create policy test_insert on public.mqtt_test_requests for insert to authenticated
  with check (public.is_admin() and requested_by = auth.uid());

-- ───────────── grants (anon tidak punya akses apa pun) ─────────────
revoke all on public.profiles, public.devices, public.events, public.device_status,
  public.device_online_log, public.mqtt_config, public.mqtt_secret, public.ingest_status,
  public.mqtt_test_requests from anon, authenticated;

grant select on public.profiles, public.devices, public.events, public.device_status,
  public.device_online_log, public.mqtt_config, public.ingest_status, public.mqtt_test_requests
  to authenticated;
grant update (role, display_name) on public.profiles to authenticated;
grant update (room_name)          on public.devices  to authenticated;
grant insert (payload)            on public.mqtt_test_requests to authenticated;

-- ───────────── Realtime ─────────────
-- Dashboard hanya perlu events + device_status. (Config/tes dibaca ingest lewat polling.)
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.device_status;
