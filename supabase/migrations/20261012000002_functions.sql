-- Fungsi ingest (service_role) dan RPC dashboard (authenticated).

-- ───────────── ingest ─────────────
-- Menyimpan event. Dedup: (device, ts, status) unik. Transisi dihitung ulang di sekitar
-- baris yang disisipkan, jadi event terlambat tetap masuk di posisi yang benar.
create function public.ingest_event(
  p_device text, p_ts timestamptz, p_status text,
  p_raw jsonb default null, p_suspect boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_prev text; v_next record; v_latest record; v_since timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_device));
  insert into devices (device_id) values (p_device) on conflict do nothing;

  insert into events (device_id, ts, status, raw, ts_suspect)
  values (p_device, p_ts, p_status, p_raw, p_suspect)
  on conflict (device_id, ts, status) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;

  select status into v_prev from events
   where device_id = p_device and (ts, id) < (p_ts, v_id)
   order by ts desc, id desc limit 1;
  update events set is_transition = (v_prev is distinct from p_status) where id = v_id;

  select id, status into v_next from events
   where device_id = p_device and (ts, id) > (p_ts, v_id)
   order by ts, id limit 1;
  if found then
    update events set is_transition = (status is distinct from p_status) where id = v_next.id;
  end if;

  select status, ts into v_latest from events
   where device_id = p_device order by ts desc, id desc limit 1;
  select max(ts) into v_since from events
   where device_id = p_device and is_transition and ts <= v_latest.ts;

  insert into device_status (device_id, current_status, since, last_seen)
  values (p_device, v_latest.status, v_since, now())
  on conflict (device_id) do update
    set current_status = excluded.current_status,
        since          = excluded.since,
        last_seen      = greatest(device_status.last_seen, excluded.last_seen);
  return true;
end $$;

create function public.set_device_online(p_device text, p_online boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_last boolean;
begin
  perform pg_advisory_xact_lock(hashtext(p_device));
  insert into devices (device_id) values (p_device) on conflict do nothing;

  select online into v_last from device_online_log
   where device_id = p_device order by ts desc, id desc limit 1;
  if v_last is distinct from p_online then
    insert into device_online_log (device_id, online) values (p_device, p_online);
  end if;

  insert into device_status (device_id, online) values (p_device, p_online)
  on conflict (device_id) do update set online = excluded.online;
end $$;

create function public.get_mqtt_password() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets
   where id = (select secret_id from public.mqtt_secret where id = 1)
$$;

-- ───────────── konfigurasi MQTT (admin) ─────────────
-- Password masuk Vault; password kosong = pakai yang lama. Tidak pernah dikirim balik.
create function public.save_mqtt_config(
  p_host text, p_port int, p_protocol text, p_username text, p_password text,
  p_topic_status text, p_topic_online text
) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select secret_id into v_secret from mqtt_secret where id = 1;
  if coalesce(p_password, '') <> '' then
    if v_secret is null then
      v_secret := vault.create_secret(p_password, 'presence_mqtt_password');
      insert into mqtt_secret (id, secret_id) values (1, v_secret);
    else
      perform vault.update_secret(v_secret, p_password);
    end if;
  end if;

  insert into mqtt_config (id, host, port, protocol, username, has_password, topic_status, topic_online, updated_by, updated_at)
  values (1, trim(p_host), p_port, p_protocol, nullif(trim(p_username), ''), v_secret is not null,
          trim(p_topic_status), nullif(trim(p_topic_online), ''), auth.uid(), now())
  on conflict (id) do update set
    host = excluded.host, port = excluded.port, protocol = excluded.protocol,
    username = excluded.username, has_password = excluded.has_password,
    topic_status = excluded.topic_status, topic_online = excluded.topic_online,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- ───────────── hitungan dashboard ─────────────
-- Semua RPC ini security invoker: RLS tetap berlaku.

-- Rentang offline yang beririsan dengan [p_from, p_to).
create function public._offline_ranges(p_device text, p_from timestamptz, p_to timestamptz)
returns tstzmultirange language sql stable as $$
  with o as (
    select ts, online, lead(ts) over (order by ts, id) as next_ts
      from device_online_log where device_id = p_device
  )
  select coalesce(range_agg(tstzrange(greatest(ts, p_from), least(coalesce(next_ts, p_to), p_to))),
                  '{}'::tstzmultirange)
    from o
   where not online and ts < p_to and coalesce(next_ts, p_to) > p_from
$$;

-- Interval status (dari transisi) yang dipotong ke [p_from, p_to). Status awal window
-- = transisi terakhir sebelum p_from.
create function public._state_segments(p_device text, p_from timestamptz, p_to timestamptz)
returns table (status text, r tstzrange) language sql stable as $$
  with t as (
    select ts, e.status, lead(ts) over (order by ts, id) as next_ts
      from events e where device_id = p_device and is_transition and ts < p_to
  )
  select t.status, tstzrange(greatest(ts, p_from), least(coalesce(next_ts, p_to), p_to))
    from t where coalesce(next_ts, p_to) > p_from
$$;

create function public._period_stats(p_device text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable as $$
declare
  v_to timestamptz := least(p_to, now());
  v_win numeric := greatest(extract(epoch from (least(p_to, now()) - p_from)), 0);
  v_off tstzmultirange := '{}'::tstzmultirange;
  v_occ numeric := 0; v_offs numeric := 0; v_oc int; v_vc int;
begin
  select count(*) filter (where status = 'occupied'), count(*) filter (where status = 'vacant')
    into v_oc, v_vc
    from events
   where device_id = p_device and is_transition and ts >= p_from and ts < p_to;

  if v_win > 0 then
    v_off := public._offline_ranges(p_device, p_from, v_to);
    select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0) into v_offs from unnest(v_off) x;
    select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0) into v_occ
      from public._state_segments(p_device, p_from, v_to) s,
           lateral unnest(tstzmultirange(s.r) - v_off) x
     where s.status = 'occupied';
  end if;

  return jsonb_build_object(
    'occupied_count', v_oc,
    'vacant_count', v_vc,
    'occupied_seconds', round(v_occ),
    'offline_seconds', round(v_offs),
    'window_seconds', round(v_win),
    'occupancy_rate', case when v_win - v_offs > 0 then round(v_occ / (v_win - v_offs) * 100, 1) end
  );
end $$;

create function public.get_summary(p_device text, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'current', public._period_stats(p_device, p_from, p_to),
    'prev',    public._period_stats(p_device, p_from - (p_to - p_from), p_from)
  )
$$;

create function public.get_timeline(p_device text, p_from timestamptz, p_to timestamptz)
returns table (kind text, start_ts timestamptz, end_ts timestamptz)
language plpgsql stable as $$
declare
  v_to  timestamptz := least(p_to, now());
  v_off tstzmultirange;
begin
  if v_to <= p_from then return; end if;
  v_off := public._offline_ranges(p_device, p_from, v_to);
  return query
    select s.status, lower(x), upper(x)
      from public._state_segments(p_device, p_from, v_to) s,
           lateral unnest(tstzmultirange(s.r) - v_off) x
    union all
    select 'offline', lower(x), upper(x) from unnest(v_off) x
    order by 2;
end $$;

create function public.get_buckets(p_device text, p_from timestamptz, p_to timestamptz, p_bucket interval)
returns table (bucket_start timestamptz, occupied int, vacant int)
language plpgsql stable as $$
begin
  if p_bucket < interval '1 minute' or extract(epoch from (p_to - p_from)) / extract(epoch from p_bucket) > 500 then
    raise exception 'bucket tidak valid';
  end if;
  return query
    select b, coalesce(c.occ, 0)::int, coalesce(c.vac, 0)::int
      from generate_series(p_from, p_to - interval '1 microsecond', p_bucket) b
      left join (
        select date_bin(p_bucket, e.ts, p_from) as bs,
               count(*) filter (where e.status = 'occupied') as occ,
               count(*) filter (where e.status = 'vacant')   as vac
          from events e
         where e.device_id = p_device and e.is_transition and e.ts >= p_from and e.ts < p_to
         group by 1
      ) c on c.bs = b
     order by b;
end $$;

-- ───────────── hak eksekusi ─────────────
revoke all on function
  public.ingest_event(text, timestamptz, text, jsonb, boolean),
  public.set_device_online(text, boolean),
  public.get_mqtt_password(),
  public.save_mqtt_config(text, int, text, text, text, text, text),
  public.is_admin(),
  public._offline_ranges(text, timestamptz, timestamptz),
  public._state_segments(text, timestamptz, timestamptz),
  public._period_stats(text, timestamptz, timestamptz),
  public.get_summary(text, timestamptz, timestamptz),
  public.get_timeline(text, timestamptz, timestamptz),
  public.get_buckets(text, timestamptz, timestamptz, interval)
  from public, anon, authenticated;

grant execute on function
  public.ingest_event(text, timestamptz, text, jsonb, boolean),
  public.set_device_online(text, boolean),
  public.get_mqtt_password()
  to service_role;

grant execute on function
  public.is_admin(),
  public.save_mqtt_config(text, int, text, text, text, text, text),
  public._offline_ranges(text, timestamptz, timestamptz),
  public._state_segments(text, timestamptz, timestamptz),
  public._period_stats(text, timestamptz, timestamptz),
  public.get_summary(text, timestamptz, timestamptz),
  public.get_timeline(text, timestamptz, timestamptz),
  public.get_buckets(text, timestamptz, timestamptz, interval)
  to authenticated;
