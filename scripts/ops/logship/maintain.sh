#!/bin/sh
# Runs hourly inside the logship container (docker-compose.yml), next to the
# Vector that writes /var/log/dmm-web/web-<UTC day>.log:
#
# - Compresses a day's file once Vector has stopped writing it. The .gz is
#   written beside it and renamed into place, so a reader never sees half a
#   file, and lines that arrive later for that day are merged into it.
# - Deletes days older than KEEP_DAYS, judged by the date in the name.
#
# Vector's own gzip output is not used: a killed Vector leaves an unfinished
# gzip member, and anything appended after it is unreadable to zcat.

set -u
# A failed read of an existing .gz must not let a partial merge replace it.
(set -o pipefail) 2>/dev/null && set -o pipefail

DIR=${LOGSHIP_DIR:-/var/log/dmm-web}
KEEP_DAYS=${LOGSHIP_KEEP_DAYS:-14}
IDLE_MIN=${LOGSHIP_IDLE_MIN:-60}

umask 077

for f in $(find "$DIR" -maxdepth 1 -name 'web-*.log' -mmin +"$IDLE_MIN"); do
	if [ -e "$f.gz" ]; then
		{ gzip -dc "$f.gz" && cat "$f"; } | gzip >"$f.gz.tmp"
	else
		gzip -c "$f" >"$f.gz.tmp"
	fi && mv "$f.gz.tmp" "$f.gz" && rm -f "$f"
	rm -f "$f.gz.tmp"
done

cutoff_epoch=$(($(date -u +%s) - KEEP_DAYS * 86400))
cutoff=$(date -u -d "@$cutoff_epoch" +%Y%m%d 2>/dev/null || date -u -r "$cutoff_epoch" +%Y%m%d)
for f in "$DIR"/web-*.log*; do
	[ -e "$f" ] || continue
	day=$(printf '%s\n' "${f##*/}" | sed -n 's/^web-\([0-9]\{4\}\)-\([0-9][0-9]\)-\([0-9][0-9]\)\.log.*$/\1\2\3/p')
	if [ -n "$day" ] && [ "$day" -lt "$cutoff" ]; then
		rm -f "$f"
	fi
done
