#!/usr/bin/env bash
# Dipanggil timer systemd (user) tiap menit: kalau ada commit baru di origin/main, jalankan deploy.sh.
# Commit yang gagal deploy (mis. tes gagal) tidak dicoba ulang sampai ada commit baru.
set -uo pipefail
cd "$(dirname "$0")/.."
exec 9>/tmp/presence-autodeploy.lock
flock -n 9 || exit 0 # deploy sebelumnya masih jalan

BRANCH=${DEPLOY_BRANCH:-main}
git fetch --quiet origin "$BRANCH" || { echo "git fetch gagal"; exit 0; }
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$(git rev-parse HEAD)" = "$REMOTE" ] && exit 0

FAILED_FILE=.autodeploy-failed
[ "$(cat "$FAILED_FILE" 2>/dev/null)" = "$REMOTE" ] && exit 0

echo "==> commit baru ${REMOTE:0:7}, deploy…"
if ./deploy/deploy.sh; then
  rm -f "$FAILED_FILE"
  echo "==> deploy ${REMOTE:0:7} berhasil"
else
  echo "$REMOTE" > "$FAILED_FILE"
  echo "==> deploy ${REMOTE:0:7} GAGAL; tidak dicoba ulang sampai ada commit baru"
  exit 1
fi
