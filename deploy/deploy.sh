#!/usr/bin/env bash
# Deploy dari laptop: build ingest + web lokal, kirim ke server, restart.
# Pemakaian:  DEPLOY_HOST=user@server ./deploy/deploy.sh [web|ingest|all]
# Prasyarat: setup awal server sudah dilakukan (lihat README), web/.env sudah terisi,
#            user SSH punya sudo.
set -euo pipefail

HOST="${DEPLOY_HOST:?Isi DEPLOY_HOST, contoh: DEPLOY_HOST=user@1.2.3.4}"
WHAT="${1:-all}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="/tmp/presence-deploy"

[[ "$WHAT" =~ ^(web|ingest|all)$ ]] || { echo "Argumen: web | ingest | all"; exit 1; }

if [[ "$WHAT" != "ingest" ]]; then
  [[ -f "$ROOT/web/.env" ]] || { echo "web/.env belum ada (salin dari .env.example dan isi)"; exit 1; }
  echo "==> Build web"
  (cd "$ROOT/web" && npm ci --silent && npm run build)
fi

if [[ "$WHAT" != "web" ]]; then
  echo "==> Build ingest (+ tes parser)"
  (cd "$ROOT/ingest" && npm ci --silent && npm test --silent && npm run build)
fi

echo "==> Kirim ke $HOST"
ssh "$HOST" "mkdir -p $STAGE/web $STAGE/ingest"
[[ "$WHAT" != "ingest" ]] && rsync -az --delete "$ROOT/web/dist/" "$HOST:$STAGE/web/"
[[ "$WHAT" != "web" ]] && rsync -az --delete \
  "$ROOT/ingest/dist" "$ROOT/ingest/package.json" "$ROOT/ingest/package-lock.json" "$HOST:$STAGE/ingest/"

echo "==> Pasang di server"
ssh -t "$HOST" WHAT="$WHAT" STAGE="$STAGE" 'bash -s' <<'REMOTE'
set -euo pipefail
if [[ "$WHAT" != "ingest" ]]; then
  sudo mkdir -p /var/www/presence
  sudo rsync -a --delete "$STAGE/web/" /var/www/presence/
  echo "web terpasang"
fi
if [[ "$WHAT" != "web" ]]; then
  sudo mkdir -p /opt/presence/ingest/data
  sudo rsync -a --delete "$STAGE/ingest/dist" /opt/presence/ingest/
  sudo cp "$STAGE/ingest/package.json" "$STAGE/ingest/package-lock.json" /opt/presence/ingest/
  sudo chown -R presence:presence /opt/presence/ingest
  sudo -u presence bash -c 'cd /opt/presence/ingest && npm ci --omit=dev --silent'
  sudo systemctl restart presence-ingest
  sleep 2
  systemctl is-active presence-ingest
  sudo journalctl -u presence-ingest -n 8 --no-pager
fi
rm -rf "$STAGE"
REMOTE
echo "==> Selesai"
