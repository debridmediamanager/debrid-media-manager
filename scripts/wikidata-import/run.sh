#!/usr/bin/env bash
# Weekly Wikidata id import, run by cron on the dmm host (the database host).
#
#   0 10 * * 0 /home/ben/wikidata-import/run.sh
#
# Sunday 10:00 UTC: the run takes ~40 minutes and renames its tables at the
# end, which must not land inside the 08:00 full mysqldump (~20 min), whose
# single transaction a concurrent RENAME can break. Weekly because Wikidata's
# film ids move slowly and each run asks QLever ~1,450 queries.
#
# Layout, all outside any checkout a deploy could clean:
#   /home/ben/wikidata-import/app/                 the importer (install.sh replaces it)
#   /home/ben/wikidata-import/wikidata-import.env  DATABASE_URL, optional ALERT_WEBHOOK_URL (0600)
#   /home/ben/wikidata-import/last-success         when the last run finished cleanly
#   /home/ben/logs/wikidata-import.log             rotated by /etc/logrotate.d/dmm-wikidata-import
#
# A failed run exits non-zero, logs a `FAILED` line, writes to syslog at
# user.err (`journalctl -t dmm-wikidata-import`) and posts to ALERT_WEBHOOK_URL
# when one is set. The live tables stay as they were.
set -uo pipefail

ROOT=/home/ben/wikidata-import
LOG=/home/ben/logs/wikidata-import.log
BUN="${BUN:-$HOME/.bun/bin/bun}"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

fail() {
	local reason="$1"
	echo "$(date -u +%FT%TZ) FAILED: $reason"
	logger -t dmm-wikidata-import -p user.err "wikidata import failed: $reason (see $LOG)"
	if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
		curl -fsS -m 20 -H 'Content-Type: application/json' \
			-d "{\"content\":\"DMM wikidata import failed on $(hostname): ${reason//\"/\'}. See $LOG\"}" \
			"$ALERT_WEBHOOK_URL" >/dev/null || echo "$(date -u +%FT%TZ) alert webhook failed too"
	fi
}

exec 9>/tmp/dmm-wikidata-import.lock
if ! flock -n 9; then
	fail "the previous run still holds /tmp/dmm-wikidata-import.lock"
	exit 1
fi

if [ ! -r "$ROOT/wikidata-import.env" ]; then
	fail "$ROOT/wikidata-import.env is missing"
	exit 1
fi
set -a
# shellcheck disable=SC1091
. "$ROOT/wikidata-import.env"
set +a

echo "=== $(date -u +%FT%TZ) wikidata import, app $(cat "$ROOT/app/VERSION" 2>/dev/null || echo unknown) ==="
cd "$ROOT/app" || { fail "no $ROOT/app"; exit 1; }
"$BUN" scripts/import-wikidata.ts --apply "$@"
status=$?

if [ "$status" -ne 0 ]; then
	fail "import-wikidata.ts exited $status"
else
	date -u +%FT%TZ >"$ROOT/last-success"
	echo "=== $(date -u +%FT%TZ) ok ==="
fi
exit "$status"
