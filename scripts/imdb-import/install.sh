#!/usr/bin/env bash
# Install or update the daily IMDb table import on the dmm host.
#
#   scripts/imdb-import/install.sh [ssh-target]      # default ben@dmm
#
# Run from a clean checkout of the commit to install. It copies only what the
# importer needs into /home/ben/imdb-import/app, installs Prisma there with
# bun, and installs the cron wrapper, the logrotate rule and the crontab line.
# data/ and imdb-import.env live beside app/, so replacing app/ keeps the
# downloaded dumps. It also removes the crontab line of the untracked
# ~/imdb_import.py this replaces; the old files are left where they are.
#
# The dmm host for the same reasons as scripts/anime-import/install.sh: it holds
# the database, and no deploy touches it.
#
# The first install also needs /home/ben/imdb-import/imdb-import.env (0600).
# run.sh sources it, so quote each value; a bare `&` in the URL would end the line:
#   DATABASE_URL="mysql://dmmuser:<password>@127.0.0.1:3306/dmmdb?connection_limit=5"
#   ALERT_WEBHOOK_URL="<optional Discord webhook for failures>"
set -euo pipefail

TARGET="${1:-ben@dmm}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT=/home/ben/imdb-import
CRON_LINE="0 3 * * * $ROOT/run.sh"

cd "$REPO"
if [ -n "$(git status --porcelain -- scripts/import-imdb.ts scripts/imdb-import src/services/imdbImport prisma/schema.prisma)" ]; then
	echo "ABORT: the importer's files have uncommitted changes" >&2
	exit 1
fi
COMMIT="$(git rev-parse HEAD)"
PRISMA_VERSION="$(node -p "require('./node_modules/@prisma/client/package.json').version")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app/scripts" "$STAGE/app/src/services/imdbImport" "$STAGE/app/prisma"
cp scripts/import-imdb.ts "$STAGE/app/scripts/"
cp src/services/imdbImport/imdbSync.ts "$STAGE/app/src/services/imdbImport/"
cp prisma/schema.prisma "$STAGE/app/prisma/"
echo "$COMMIT" >"$STAGE/app/VERSION"
cat >"$STAGE/app/package.json" <<JSON
{
	"name": "dmm-imdb-import",
	"private": true,
	"dependencies": { "@prisma/client": "$PRISMA_VERSION" },
	"devDependencies": { "prisma": "$PRISMA_VERSION" }
}
JSON

ssh "$TARGET" "mkdir -p $ROOT/app $ROOT/data /home/ben/logs && chmod 700 $ROOT"
rsync -a --delete --exclude node_modules --exclude bun.lock "$STAGE/app/" "$TARGET:$ROOT/app/"
scp -q scripts/imdb-import/run.sh "$TARGET:$ROOT/run.sh"
scp -q scripts/imdb-import/logrotate.conf "$TARGET:/tmp/dmm-imdb-import.logrotate"

ssh "$TARGET" bash -s <<REMOTE
set -euo pipefail
chmod +x $ROOT/run.sh
cd $ROOT/app
\$HOME/.bun/bin/bun install --silent
\$HOME/.bun/bin/bunx prisma generate >/dev/null
sudo install -m 0644 -o root -g root /tmp/dmm-imdb-import.logrotate /etc/logrotate.d/dmm-imdb-import
rm -f /tmp/dmm-imdb-import.logrotate
sudo logrotate -d /etc/logrotate.d/dmm-imdb-import >/dev/null 2>&1 || { echo "logrotate rejected the rule"; exit 1; }
( crontab -l 2>/dev/null | grep -vF "$ROOT/run.sh" | grep -vF "/home/ben/imdb_import.sh"; echo "$CRON_LINE" ) | crontab -
[ -f $ROOT/imdb-import.env ] || echo "WARNING: $ROOT/imdb-import.env does not exist yet"
echo "installed $COMMIT"
REMOTE
