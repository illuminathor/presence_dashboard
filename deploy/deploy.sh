#!/usr/bin/env bash
# Jalankan di server sebagai user biasa (tanpa sudo):  ~/presence_dashboard/deploy/deploy.sh
# Menarik kode terbaru, build web + server, lalu restart service. Setup awal: lihat README.
set -euo pipefail
cd "$(dirname "$0")/.."

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Butuh Node >= 22.13 (sekarang $(node -v))"; exit 1; }

echo "==> git pull"
git pull --ff-only

echo "==> Web: build"
# batasi heap supaya tidak menghabiskan RAM server 1 GB
(cd web && npm ci --silent && NODE_OPTIONS=--max-old-space-size=512 npm run build)

echo "==> Server: tes + build"
(cd server && npm ci --silent && npm test --silent && npm run build)

echo "==> Restart"
systemctl --user restart presence
sleep 2
systemctl --user is-active presence
journalctl --user -u presence -n 8 --no-pager
echo "==> Selesai"
