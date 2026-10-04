#!/usr/bin/env bash
# Runs every minute from ben's crontab on dmm-01 and repairs DMM without a
# human: on 2026-10-04 every dmm_web replica exited one by one overnight and
# nothing brought them back for hours.
#
# - Health: after FAIL_THRESHOLD consecutive failed probes of /api/healthz it
#   force-redeploys the web service, then waits COOLDOWN_SECS before it may
#   do so again, so a deeper fault cannot become a restart loop.
# - Disk: above DISK_PCT it prunes superseded images, build cache and the
#   journal.
#
# Every action goes to syslog under the dmm-watchdog tag:
#   journalctl -t dmm-watchdog

set -uo pipefail

HEALTH_URL=${DMM_WATCHDOG_URL:-http://127.0.0.1:3000/api/healthz}
SERVICE=${DMM_WATCHDOG_SERVICE:-dmm_web}
STATE_DIR=${DMM_WATCHDOG_STATE_DIR:-/var/tmp/dmm-watchdog}
FAIL_THRESHOLD=${DMM_WATCHDOG_FAIL_THRESHOLD:-3}
COOLDOWN_SECS=${DMM_WATCHDOG_COOLDOWN_SECS:-600}
DISK_PATH=${DMM_WATCHDOG_DISK_PATH:-/}
DISK_PCT=${DMM_WATCHDOG_DISK_PCT:-85}

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

log() { logger -t dmm-watchdog "$*"; }
now=$(date +%s)

fails=$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)
last_restart=$(cat "$STATE_DIR/last_restart" 2>/dev/null || echo 0)

if curl -sf -m 10 "$HEALTH_URL" | grep -q ok; then
	if [ "$fails" -gt 0 ]; then log "health recovered after $fails failed probes"; fi
	fails=0
else
	fails=$((fails + 1))
	log "health probe failed ($fails/$FAIL_THRESHOLD)"
	if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
		if [ $((now - last_restart)) -ge "$COOLDOWN_SECS" ]; then
			log "force-redeploying $SERVICE"
			if docker service update --force --detach "$SERVICE" >/dev/null 2>&1; then
				log "redeploy of $SERVICE started"
			else
				log "redeploy of $SERVICE failed"
			fi
			echo "$now" >"$STATE_DIR/last_restart"
			fails=0
		else
			log "redeploy skipped, last one was $((now - last_restart))s ago"
		fi
	fi
fi
echo "$fails" >"$STATE_DIR/fails"

used=$(df -P "$DISK_PATH" | awk 'NR==2 { sub(/%/, "", $5); print $5 }')
if [ -n "$used" ] && [ "$used" -ge "$DISK_PCT" ]; then
	log "disk at ${used}%, pruning"
	docker image prune -f >/dev/null 2>&1
	docker builder prune -f --keep-storage 4GB >/dev/null 2>&1
	sudo -n journalctl --vacuum-size=1G >/dev/null 2>&1
	after=$(df -P "$DISK_PATH" | awk 'NR==2 { sub(/%/, "", $5); print $5 }')
	log "disk at ${after}% after pruning"
fi
