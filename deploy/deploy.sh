#!/usr/bin/env bash
# Jalankan di server sebagai user biasa (tanpa sudo):  ~/presence_dashboard/deploy/deploy.sh [web|ingest|all]
# Menarik kode terbaru dari GitHub, build, dan restart. Setup awal: lihat README.
set -euo pipefail

WHAT="${1:-all}"
[[ "$WHAT" =~ ^(web|ingest|all)$ ]] || { echo "Argumen: web | ingest | all"; exit 1; }
cd "$(dirname "$0")/.."

echo "==> git pull"
git pull --ff-only

if [[ "$WHAT" != "web" ]]; then
  echo "==> Ingest: build + restart"
  (cd ingest && npm ci --silent && npm test --silent && npm run build)
  systemctl --user restart presence-ingest
  sleep 2
  systemctl --user is-active presence-ingest
  journalctl --user -u presence-ingest -n 8 --no-pager
fi

if [[ "$WHAT" != "ingest" ]]; then
  echo "==> Web: build"
  [[ -f web/.env ]] || { echo "web/.env belum ada"; exit 1; }
  # batasi heap supaya tidak menghabiskan RAM server 1 GB; hasil di web/dist (dilayani nginx)
  (cd web && npm ci --silent && NODE_OPTIONS=--max-old-space-size=512 npm run build)
fi
echo "==> Selesai"
