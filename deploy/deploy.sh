#!/usr/bin/env bash
# Jalankan DI SERVER:  sudo /opt/presence/src/deploy/deploy.sh [web|ingest|all]
# Menarik kode terbaru dari GitHub, build, dan restart. Setup awal: lihat README.
set -euo pipefail

WHAT="${1:-all}"
[[ "$WHAT" =~ ^(web|ingest|all)$ ]] || { echo "Argumen: web | ingest | all"; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Jalankan dengan sudo"; exit 1; }

SRC=/opt/presence/src
as_presence() { sudo -u presence bash -c "cd $SRC && $1"; }

echo "==> git pull"
as_presence 'git pull --ff-only'

if [[ "$WHAT" != "web" ]]; then
  echo "==> Ingest: build + restart"
  as_presence 'cd ingest && npm ci --silent && npm test --silent && npm run build'
  systemctl restart presence-ingest
  sleep 2
  systemctl is-active presence-ingest
  journalctl -u presence-ingest -n 8 --no-pager
fi

if [[ "$WHAT" != "ingest" ]]; then
  echo "==> Web: build + publish"
  [[ -f $SRC/web/.env ]] || { echo "$SRC/web/.env belum ada"; exit 1; }
  # batasi heap supaya tidak menghabiskan RAM server 1 GB
  as_presence 'cd web && npm ci --silent && NODE_OPTIONS=--max-old-space-size=512 npm run build'
  mkdir -p /var/www/presence
  find /var/www/presence -mindepth 1 -delete
  cp -r $SRC/web/dist/. /var/www/presence/
fi
echo "==> Selesai"
