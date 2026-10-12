#!/usr/bin/env bash
# Deploy: server menarik kode dari GitHub, build, dan restart.
# Pemakaian:  DEPLOY_HOST=user@server ./deploy/deploy.sh [web|ingest|all]
# Prasyarat: setup awal server sudah dilakukan (lihat README); perubahan sudah di-push.
set -euo pipefail

HOST="${DEPLOY_HOST:?Isi DEPLOY_HOST, contoh: DEPLOY_HOST=user@1.2.3.4}"
WHAT="${1:-all}"
[[ "$WHAT" =~ ^(web|ingest|all)$ ]] || { echo "Argumen: web | ingest | all"; exit 1; }

# Server hanya melihat yang sudah di-push.
if [[ -n "$(git status --porcelain)" || -n "$(git log '@{u}..' --oneline 2>/dev/null)" ]]; then
  echo "Ada perubahan yang belum di-commit/push. Push dulu supaya ikut ter-deploy."; exit 1
fi

ssh -t "$HOST" WHAT="$WHAT" 'bash -s' <<'REMOTE'
set -euo pipefail
SRC=/opt/presence/src
as_presence() { sudo -u presence bash -c "cd $SRC && $1"; }

echo "==> git pull"
as_presence 'git pull --ff-only'

if [[ "$WHAT" != "web" ]]; then
  echo "==> Ingest: build + restart"
  as_presence 'cd ingest && npm ci --silent && npm test --silent && npm run build'
  sudo systemctl restart presence-ingest
  sleep 2
  systemctl is-active presence-ingest
  sudo journalctl -u presence-ingest -n 8 --no-pager
fi

if [[ "$WHAT" != "ingest" ]]; then
  echo "==> Web: build + publish"
  [[ -f $SRC/web/.env ]] || { echo "$SRC/web/.env belum ada"; exit 1; }
  # batasi heap supaya tidak menghabiskan RAM server 1 GB
  as_presence 'cd web && npm ci --silent && NODE_OPTIONS=--max-old-space-size=512 npm run build'
  sudo mkdir -p /var/www/presence
  sudo find /var/www/presence -mindepth 1 -delete
  sudo cp -r $SRC/web/dist/. /var/www/presence/
fi
echo "==> Selesai"
REMOTE
