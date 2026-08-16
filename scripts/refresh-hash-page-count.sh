#!/usr/bin/env bash
# Rebuild HashPageCount, which backs the scraper fan-out guard
# (withoutFannedOutHashes in services/database/scraped.ts).
#
# Runs on the database host, not in the app container: it streams both scrape
# tables out, counts in memory, and streams the reload back. Takes ~11 minutes
# against the current corpus and does not disturb the live site - the load is
# CPU in this pipeline, not contention in MySQL.
#
# Install:
#   cp refresh-hash-page-count.{sh,py} /home/ben/
#   chmod +x /home/ben/refresh-hash-page-count.sh
#   crontab -e:
#     30 4 * * * /usr/bin/flock -n /tmp/hashpagecount.lock /home/ben/refresh-hash-page-count.sh >> /home/ben/logs/hashpagecount.log 2>&1
#
# Requires DMM_DB_PASS in the environment (or ~/.hashpagecount.env).

set -euo pipefail

DB_HOST="${DMM_DB_HOST:-127.0.0.1}"
DB_USER="${DMM_DB_USER:-dmmuser}"
DB_NAME="${DMM_DB_NAME:-dmmdb}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
[ -f "$HOME/.hashpagecount.env" ] && . "$HOME/.hashpagecount.env"
: "${DMM_DB_PASS:?DMM_DB_PASS is not set}"

mysql_cmd() { mysql -h "$DB_HOST" -u "$DB_USER" -p"$DMM_DB_PASS" "$DB_NAME" "$@"; }

TS="$(date -u '+%Y-%m-%d %H:%M:%S.000')"
echo "=== HashPageCount refresh @ ${TS} UTC ==="

before="$(mysql_cmd -N -B -e 'SELECT COUNT(*) FROM HashPageCount' 2>/dev/null)"
echo "rows before: ${before}"

# Two phases on purpose. The aggregation consumes its whole input before it can
# emit a single row, which takes minutes - piping it straight into mysql leaves
# that connection idle far past net_read_timeout (30s) and wait_timeout (120s),
# so the server hangs up and the writer dies with EPIPE. Staging to a file keeps
# the write connection short-lived.
TMP_SQL="$(mktemp /tmp/hashpagecount.XXXXXX.sql)"
trap 'rm -f "$TMP_SQL"' EXIT

# --quick streams rather than buffering the whole result set client-side.
{
	mysql_cmd --quick -N -B -e 'SELECT `key`, value FROM ScrapedTrue' 2>/dev/null
	mysql_cmd --quick -N -B -e 'SELECT `key`, value FROM Scraped' 2>/dev/null
} | python3 "${HERE}/refresh-hash-page-count.py" "$TS" > "$TMP_SQL"

echo "generated $(wc -c < "$TMP_SQL") bytes of reload SQL"

# mysql's stderr is deliberately NOT discarded here: swallowing it once left a
# downstream EPIPE as the only symptom of a server-side failure.
mysql_cmd < "$TMP_SQL"

after="$(mysql_cmd -N -B -e 'SELECT COUNT(*) FROM HashPageCount' 2>/dev/null)"
over="$(mysql_cmd -N -B -e 'SELECT COUNT(*) FROM HashPageCount WHERE pageCount > 25' 2>/dev/null)"
echo "rows after:  ${after}  (over the limit: ${over})"

# A run that empties or halves the table means the stream broke, not that the
# corpus shrank; surface it loudly rather than leaving the guard toothless.
if [ "${after}" -lt $(( before / 2 )) ]; then
	echo "REFRESH SUSPECT: ${before} -> ${after}, investigate before trusting the guard" >&2
	exit 1
fi
echo "=== done ==="
