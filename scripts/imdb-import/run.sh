#!/usr/bin/env bash
# Daily IMDb table import, run by cron on the dmm host (the database host).
#
#   0 3 * * * /home/ben/imdb-import/run.sh
#
# IMDb regenerates its dumps daily. 03:00 UTC stays clear of the 04:30
# HashPageCount rebuild and the 06:40 anime import. A run that only compares
# reads every dump once and writes the day's changes.
#
# Layout, all outside any checkout a deploy could clean:
#   /home/ben/imdb-import/app/            the importer (install.sh replaces it)
#   /home/ben/imdb-import/data/           the downloaded dumps, ~1.6 GB
#   /home/ben/imdb-import/imdb-import.env DATABASE_URL, optional ALERT_WEBHOOK_URL (0600)
#   /home/ben/imdb-import/last-success    when the last run finished cleanly
#   /home/ben/logs/imdb-import.log        rotated by /etc/logrotate.d/dmm-imdb-import
#
# A failed run exits non-zero, logs a `FAILED` line, writes to syslog at
# user.err (`journalctl -t dmm-imdb-import`) and posts to ALERT_WEBHOOK_URL
# when one is set. A run still holding the lock at the next start is reported
# the same way, so a wedged import is noticed within a day.
set -uo pipefail

ROOT=/home/ben/imdb-import
LOG=/home/ben/logs/imdb-import.log
BUN="${BUN:-$HOME/.bun/bin/bun}"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

fail() {
	local reason="$1"
	echo "$(date -u +%FT%TZ) FAILED: $reason"
	logger -t dmm-imdb-import -p user.err "imdb import failed: $reason (see $LOG)"
	if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
		curl -fsS -m 20 -H 'Content-Type: application/json' \
			-d "{\"content\":\"DMM IMDb import failed on $(hostname): ${reason//\"/\'}. See $LOG\"}" \
			"$ALERT_WEBHOOK_URL" >/dev/null || echo "$(date -u +%FT%TZ) alert webhook failed too"
	fi
}

if [ -r "$ROOT/imdb-import.env" ]; then
	set -a
	# shellcheck disable=SC1091
	. "$ROOT/imdb-import.env"
	set +a
else
	fail "$ROOT/imdb-import.env is missing"
	exit 1
fi

exec 9>/tmp/dmm-imdb-import.lock
if ! flock -n 9; then
	fail "the previous run still holds /tmp/dmm-imdb-import.lock"
	exit 1
fi

echo "=== $(date -u +%FT%TZ) imdb import, app $(cat "$ROOT/app/VERSION" 2>/dev/null || echo unknown) ==="
cd "$ROOT/app" || { fail "no $ROOT/app"; exit 1; }
"$BUN" scripts/import-imdb.ts --data-dir "$ROOT/data" --apply "$@"
status=$?

if [ "$status" -ne 0 ]; then
	fail "import-imdb.ts exited $status"
else
	date -u +%FT%TZ >"$ROOT/last-success"
	echo "=== $(date -u +%FT%TZ) ok ==="
fi
exit "$status"
