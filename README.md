# Presence Monitoring Dashboard

Dashboard web untuk melihat okupansi ruangan (terisi/kosong) dari sensor presence 24 GHz
lewat Shelly 2PM → MQTT. Tanpa Docker; target server 1 GB RAM / 2 CPU.

```
Shelly ──MQTT──▶ ingest (Node, systemd) ──REST──▶ Supabase (Postgres/Auth/Realtime/Vault)
                                                       ▲
                                  web (static, nginx) ─┘  login + RLS
```

| Folder | Isi |
|---|---|
| `supabase/migrations/` | Skema, RLS, fungsi hitungan (SQL) |
| `ingest/` | Service MQTT → Supabase (satu-satunya dependency: `mqtt`) |
| `web/` | Frontend React + Vite + Tailwind + ECharts (hasil build = file statis) |
| `deploy/` | Unit systemd dan contoh nginx |

## 1. Supabase (cloud)

1. Buat project di supabase.com.
2. **Authentication → Providers → Email**: matikan *Allow new users to sign up* (invite-only).
3. **Authentication → URL Configuration**: isi *Site URL* dengan URL dashboard (dipakai link reset password).
4. Jalankan dua file di `supabase/migrations/` berurutan lewat **SQL Editor** (tanpa Docker).
   Alternatif: `supabase link` lalu `supabase db push` (CLI tanpa Docker cukup untuk ini).
5. **Authentication → Users → Invite user** untuk setiap pengguna. Jadikan admin pertama:
   ```sql
   update public.profiles set role = 'admin'
   where user_id = (select id from auth.users where email = 'anda@contoh.com');
   ```
6. **Settings → API Keys**: catat Project URL, *publishable key* `sb_publishable_...` (untuk web), dan *secret key* `sb_secret_...` (untuk ingest — rahasia). Key legacy `anon`/`service_role` akan di-deprecate Supabase; keduanya jenis key masih diterima, tapi pakai yang baru.

## 2. Ingest (di server)

```bash
cd ingest
cp .env.example .env     # isi SUPABASE_URL dan SUPABASE_SECRET_KEY
npm ci && npm run build
```

Pasang service (sesuaikan path/user di file unit):

```bash
sudo cp deploy/presence-ingest.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now presence-ingest
journalctl -u presence-ingest -f
```

Batas memori: heap Node 96 MB, `MemoryMax=200M`, `CPUQuota=50%`. Ingest memakai polling
(config 5 dtk, tes koneksi 2 dtk), bukan websocket Realtime, agar ringan. Pesan yang gagal
dikirim ke Supabase disimpan di antrean disk (`ingest/data/queue.jsonl`) dan dikirim ulang.

Broker MQTT diatur dari dashboard (menu **Konfigurasi MQTT**, khusus admin), bukan dari `.env`.

## 3. Web

Build di laptop (server tidak perlu Node untuk web):

```bash
cd web
cp .env.example .env     # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
npm ci && npm run build  # hasil: web/dist
```

Salin `web/dist/` ke server, sajikan lewat nginx (lihat `deploy/nginx.conf`; perlu fallback
SPA ke `index.html`). Pakai HTTPS.

## Catatan perilaku

- Hitungan "jadi terisi/kosong" menghitung **transisi**, bukan jumlah pesan; pesan duplikat
  atau berstatus sama berturut-turut tidak menambah hitungan.
- Periode sebelumnya = rentang dengan panjang sama tepat sebelum window terpilih.
- Waktu offline (dari topic online) dikecualikan dari persentase okupansi.
- Jam perangkat yang melenceng > 5 menit ditandai `ts_suspect`.
- Semua waktu ditampilkan dalam WIB (UTC+7) di browser mana pun.
- Password MQTT disimpan di Supabase Vault dan tidak pernah dikirim balik ke browser.

## Pengujian

`cd ingest && npm test` (parser). Logika SQL, alur ingest, dan UI sudah diuji dengan PGlite,
broker + REST tiruan, dan Chrome headless, **belum** dengan project Supabase atau broker asli.
