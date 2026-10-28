#!/usr/bin/env bash
# Install or update the weekly Wikidata id import on the dmm host.
#
#   scripts/wikidata-import/install.sh [ssh-target]      # default ben@dmm
#
# Run from a clean checkout of the commit to install. It copies only what the
# importer needs into /home/ben/wikidata-import/app, installs Prisma there with
# bun, and installs the cron wrapper, the logrotate rule and the crontab line.
# The dmm host for the same reasons as scripts/anime-import/install.sh: it holds
# the database and no deploy touches it.
#
# The tables come from prisma/migrations/20261028_add_wikidata_ids, applied by
# hand before the first run. The first install also needs
# /home/ben/wikidata-import/wikidata-import.env (0600), with quoted values:
#   DATABASE_URL="mysql://dmmuser:<password>@127.0.0.1:3306/dmmdb?connection_limit=5"
#   ALERT_WEBHOOK_URL="<optional Discord webhook for failures>"
# The database user needs CREATE, DROP and ALTER on dmmdb: each run creates,
# renames and drops its `*_next` and `*_old` tables.
set -euo pipefail

TARGET="${1:-ben@dmm}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT=/home/ben/wikidata-import
CRON_LINE="0 10 * * 0 $ROOT/run.sh"

cd "$REPO"
if [ -n "$(git status --porcelain -- scripts/import-wikidata.ts scripts/wikidata-import src/services/wikidataImport prisma/schema.prisma)" ]; then
	echo "ABORT: the importer's files have uncommitted changes" >&2
	exit 1
fi
COMMIT="$(git rev-parse HEAD)"
PRISMA_VERSION="$(node -p "require('./node_modules/@prisma/client/package.json').version")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app/scripts" "$STAGE/app/src/services/wikidataImport" "$STAGE/app/prisma"
cp scripts/import-wikidata.ts "$STAGE/app/scripts/"
cp src/services/wikidataImport/*.ts "$STAGE/app/src/services/wikidataImport/"
rm -f "$STAGE"/app/src/services/wikidataImport/*.test.ts
cp prisma/schema.prisma "$STAGE/app/prisma/"
echo "$COMMIT" >"$STAGE/app/VERSION"
cat >"$STAGE/app/package.json" <<JSON
{
	"name": "dmm-wikidata-import",
	"private": true,
	"dependencies": { "@prisma/client": "$PRISMA_VERSION" },
	"devDependencies": { "prisma": "$PRISMA_VERSION" }
}
JSON

ssh "$TARGET" "mkdir -p $ROOT/app /home/ben/logs && chmod 700 $ROOT"
rsync -a --delete --exclude node_modules --exclude bun.lock "$STAGE/app/" "$TARGET:$ROOT/app/"
scp -q scripts/wikidata-import/run.sh "$TARGET:$ROOT/run.sh"
scp -q scripts/wikidata-import/logrotate.conf "$TARGET:/tmp/dmm-wikidata-import.logrotate"

ssh "$TARGET" bash -s <<REMOTE
set -euo pipefail
chmod +x $ROOT/run.sh
cd $ROOT/app
\$HOME/.bun/bin/bun install --silent
\$HOME/.bun/bin/bunx prisma generate >/dev/null
sudo install -m 0644 -o root -g root /tmp/dmm-wikidata-import.logrotate /etc/logrotate.d/dmm-wikidata-import
rm -f /tmp/dmm-wikidata-import.logrotate
sudo logrotate -d /etc/logrotate.d/dmm-wikidata-import >/dev/null 2>&1 || { echo "logrotate rejected the rule"; exit 1; }
( crontab -l 2>/dev/null | grep -vF "$ROOT/run.sh"; echo "$CRON_LINE" ) | crontab -
[ -f $ROOT/wikidata-import.env ] || echo "WARNING: $ROOT/wikidata-import.env does not exist yet"
echo "installed $COMMIT"
REMOTE
