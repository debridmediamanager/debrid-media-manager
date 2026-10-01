#!/usr/bin/env bash
# Daily Anime table import, run by cron on the dmm host (the database host).
#
#   40 6 * * * /home/ben/anime-import/run.sh
#
# 06:40 UTC follows AniDB's dump (generated 03:00 UTC) and the Anime-Lists
# daily update (~06:00 UTC), and stays clear of the 04:30 HashPageCount rebuild.
#
# Layout, all outside any checkout a deploy could clean:
#   /home/ben/anime-import/app/            the importer (install.sh replaces it)
#   /home/ben/anime-import/cache/          AniDB dump and its once-a-day stamp
#   /home/ben/anime-import/backups/        what each run replaced, kept 60 days
#   /home/ben/anime-import/anime-import.env  DATABASE_URL, optional ALERT_WEBHOOK_URL (0600)
#   /home/ben/logs/anime-import.log        rotated by /etc/logrotate.d/dmm-anime-import
#
# A failed run exits non-zero, logs a `FAILED` line, writes to syslog at
# user.err (`journalctl -t dmm-anime-import`) and posts to ALERT_WEBHOOK_URL
# when one is set.
set -uo pipefail

ROOT=/home/ben/anime-import
LOG=/home/ben/logs/anime-import.log
BUN="${BUN:-$HOME/.bun/bin/bun}"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

fail() {
	local reason="$1"
	echo "$(date -u +%FT%TZ) FAILED: $reason"
	logger -t dmm-anime-import -p user.err "anime import failed: $reason (see $LOG)"
	if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
		curl -fsS -m 20 -H 'Content-Type: application/json' \
			-d "{\"content\":\"DMM anime import failed on $(hostname): ${reason//\"/\'}. See $LOG\"}" \
			"$ALERT_WEBHOOK_URL" >/dev/null || echo "$(date -u +%FT%TZ) alert webhook failed too"
	fi
}

exec 9>/tmp/dmm-anime-import.lock
if ! flock -n 9; then
	fail "the previous run still holds /tmp/dmm-anime-import.lock"
	exit 1
fi

if [ ! -r "$ROOT/anime-import.env" ]; then
	fail "$ROOT/anime-import.env is missing"
	exit 1
fi
set -a
# shellcheck disable=SC1091
. "$ROOT/anime-import.env"
set +a

echo "=== $(date -u +%FT%TZ) anime import, app $(cat "$ROOT/app/VERSION" 2>/dev/null || echo unknown) ==="
cd "$ROOT/app" || { fail "no $ROOT/app"; exit 1; }
"$BUN" scripts/import-anime.ts --cache-dir "$ROOT/cache" --apply --backup-dir "$ROOT/backups" "$@"
status=$?

if [ "$status" -ne 0 ]; then
	fail "import-anime.ts exited $status"
else
	date -u +%FT%TZ >"$ROOT/last-success"
	echo "=== $(date -u +%FT%TZ) ok ==="
fi

find "$ROOT/backups" -name 'anime-import-*.json' -mtime +60 -delete
exit "$status"
