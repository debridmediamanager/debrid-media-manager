#!/usr/bin/env bash
# Install or update the daily Anime table import on the dmm host.
#
#   scripts/anime-import/install.sh [ssh-target]      # default ben@dmm
#
# Run from a clean checkout of the commit to install. It copies only what the
# importer needs into /home/ben/anime-import/app, installs Prisma there with
# bun, and installs the cron wrapper, the logrotate rule and the crontab line.
# cache/, backups/ and anime-import.env live beside app/, so replacing app/
# never touches the AniDB dump's once-a-day stamp or a run's backup.
#
# Why the dmm host: it holds the database, which the import reads whole
# (33k rows) and writes row by row; it already runs the other nightly database
# job (HashPageCount); and no deploy touches it - pushing main rebuilds the
# Swarm on dmm-01 and nothing else. The web image carries neither scripts/ nor a
# TypeScript runtime, and Swarm has no scheduler, so a job there would need a
# second image and a leader among four replicas.
#
# The first install also needs /home/ben/anime-import/anime-import.env (0600):
#   DATABASE_URL=mysql://dmmuser:<password>@127.0.0.1:3306/dmmdb
#   ALERT_WEBHOOK_URL=<optional Discord webhook for failures>
set -euo pipefail

TARGET="${1:-ben@dmm}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT=/home/ben/anime-import
CRON_LINE="40 6 * * * $ROOT/run.sh"

cd "$REPO"
if [ -n "$(git status --porcelain -- scripts/import-anime.ts scripts/anime-import src/services/anime prisma/schema.prisma)" ]; then
	echo "ABORT: the importer's files have uncommitted changes" >&2
	exit 1
fi
COMMIT="$(git rev-parse HEAD)"
PRISMA_VERSION="$(node -p "require('./node_modules/@prisma/client/package.json').version")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app/scripts" "$STAGE/app/src/services/anime" "$STAGE/app/prisma"
cp scripts/import-anime.ts "$STAGE/app/scripts/"
cp src/services/anime/*.ts "$STAGE/app/src/services/anime/"
rm -f "$STAGE"/app/src/services/anime/*.test.ts
cp prisma/schema.prisma "$STAGE/app/prisma/"
echo "$COMMIT" >"$STAGE/app/VERSION"
cat >"$STAGE/app/package.json" <<JSON
{
	"name": "dmm-anime-import",
	"private": true,
	"dependencies": { "@prisma/client": "$PRISMA_VERSION" },
	"devDependencies": { "prisma": "$PRISMA_VERSION" }
}
JSON

ssh "$TARGET" "mkdir -p $ROOT/app $ROOT/cache $ROOT/backups /home/ben/logs && chmod 700 $ROOT $ROOT/backups"
rsync -a --delete --exclude node_modules --exclude bun.lock "$STAGE/app/" "$TARGET:$ROOT/app/"
scp -q scripts/anime-import/run.sh "$TARGET:$ROOT/run.sh"
scp -q scripts/anime-import/logrotate.conf "$TARGET:/tmp/dmm-anime-import.logrotate"

ssh "$TARGET" bash -s <<REMOTE
set -euo pipefail
chmod +x $ROOT/run.sh
cd $ROOT/app
\$HOME/.bun/bin/bun install --silent
\$HOME/.bun/bin/bunx prisma generate >/dev/null
sudo install -m 0644 -o root -g root /tmp/dmm-anime-import.logrotate /etc/logrotate.d/dmm-anime-import
rm -f /tmp/dmm-anime-import.logrotate
sudo logrotate -d /etc/logrotate.d/dmm-anime-import >/dev/null 2>&1 || { echo "logrotate rejected the rule"; exit 1; }
( crontab -l 2>/dev/null | grep -vF "$ROOT/run.sh"; echo "$CRON_LINE" ) | crontab -
[ -f $ROOT/anime-import.env ] || echo "WARNING: $ROOT/anime-import.env does not exist yet"
echo "installed $COMMIT"
REMOTE
