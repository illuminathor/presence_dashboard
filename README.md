# Presence Monitoring Dashboard

Dashboard web untuk melihat okupansi ruangan (terisi/kosong) dari sensor presence 24 GHz
lewat Shelly 2PM → MQTT. Tanpa Docker, tanpa layanan eksternal; target server 1 GB RAM / 2 CPU.

```
Shelly ──MQTT──▶ server (Node, 1 proses) ──▶ SQLite (server/data/presence.db)
                     ├─ API + login (cookie sesi)
                     └─ melayani web (web/dist) + update live (SSE)
```

| Folder | Isi |
|---|---|
| `server/` | MQTT, SQLite, API, login, penghitungan; satu dependency: `mqtt` |
| `web/` | Frontend React + Vite + Tailwind + ECharts (hasil build = file statis, dilayani server) |
| `deploy/` | Unit systemd (user), contoh nginx, `deploy.sh` |

Butuh **Node ≥ 22.13** (memakai `node:sqlite` bawaan, tanpa modul native).

## Setup awal di server (sekali)

```bash
git clone https://github.com/illuminathor/presence_dashboard.git ~/presence_dashboard
cd ~/presence_dashboard
cp server/.env.example server/.env        # opsional: ubah PORT/HOST

mkdir -p ~/.config/systemd/user && cp deploy/presence.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable presence

sudo loginctl enable-linger $USER         # service tetap jalan setelah logout/reboot
```

Build dan start pertama:

```bash
./deploy/deploy.sh
```

Buat akun admin pertama (password acak dicetak; bisa juga diberi sendiri sebagai argumen terakhir):

```bash
cd server && npm run user -- add admin@contoh.com admin
```

Buka `http://IP-server:3000` (set `HOST=0.0.0.0` di `server/.env` untuk akses langsung, lalu
`systemctl --user restart presence`), login, lalu buka **Konfigurasi MQTT**: isi data broker →
**Tes koneksi** → **Simpan**. Beri nama ruangan di bagian *Nama ruangan*.

### HTTPS (disarankan)
Pakai nginx sebagai reverse proxy (`deploy/nginx.conf`) dan certbot:

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/presence.conf   # ganti server_name
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dashboard.contoh.com
```

## Update

Push dari laptop, lalu di server: `~/presence_dashboard/deploy/deploy.sh`
(git pull → build web → tes + build server → restart). Build web memakai heap maksimal 512 MB;
kalau kehabisan memori di server 1 GB, tambahkan swap 1 GB.

## User & password

- Akun tidak bisa mendaftar sendiri; admin membuatnya di menu **User** (atau lewat CLI).
- Lupa password: admin menggantinya di menu User, atau di server
  `cd server && npm run user -- passwd email@contoh.com`.
- CLI lain: `npm run user -- list`, `npm run user -- add <email> viewer`.

## Data & backup

Semua data ada di satu file: `server/data/presence.db` (mode WAL, jadi ada juga `-wal`/`-shm`).
Backup yang aman saat server jalan:

```bash
sqlite3 ~/presence_dashboard/server/data/presence.db ".backup '/path/backup.db'"
```

Berisi password MQTT (teks biasa) dan hash password user, jadi file dibuat dengan izin `600`;
jangan di-commit atau dibagikan.

## Catatan perilaku

- Hitungan "jadi terisi/kosong" menghitung **transisi**, bukan jumlah pesan; pesan duplikat
  atau berstatus sama berturut-turut tidak menambah hitungan.
- Periode sebelumnya = rentang dengan panjang sama tepat sebelum window terpilih.
- Waktu offline (dari topic online) dikecualikan dari persentase okupansi.
- Jam perangkat yang melenceng > 5 menit ditandai `ts_suspect`.
- Semua waktu ditampilkan dalam WIB (UTC+7) di browser mana pun.
- Konfigurasi MQTT yang baru langsung diterapkan saat disimpan; bila gagal, koneksi lama dipertahankan.

## Pengembangan

```bash
cd server && npm i && npm test && npm run dev     # API di :3000
cd web && npm i && npm run dev                    # Vite di :5173, /api di-proxy ke :3000
```

Tes: `server/` punya tes parser dan logika perhitungan (SQLite in-memory).
