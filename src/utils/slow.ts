import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { isWebDownloadRowId } from '@/utils/torboxWebDownload';

const parisOffsetFormatter = new Intl.DateTimeFormat('en', {
	timeZone: 'Europe/Paris',
	timeZoneName: 'longOffset',
});

function rdAddedInstant(wallTime: number): number {
	if (!Number.isFinite(wallTime)) return wallTime;

	// RD's Z-suffixed clock is Paris local time, already stored as a Date.
	// Resolve the offset at the resulting instant as well, for DST change days.
	let instant = wallTime;
	for (let i = 0; i < 2; i++) {
		const zone = parisOffsetFormatter
			.formatToParts(instant)
			.find((part) => part.type === 'timeZoneName')?.value;
		const offset = zone?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
		if (!offset) return wallTime;
		const minutes = Number(offset[2]) * 60 + Number(offset[3]);
		instant = wallTime - (offset[1] === '+' ? minutes : -minutes) * 60000;
	}
	return instant;
}

export function isSlowOrNoLinks(t: UserTorrent) {
	// A web download has no swarm, so its seeder count is always 0 - judging it
	// by that would file every slow-but-healthy one under "delete these".
	if (isWebDownloadRowId(t.id)) return false;
	if (t.status !== UserTorrentStatus.downloading || t.seeders !== 0) return false;

	const oldTorrentAge = 1200000; // 20 mins in milliseconds
	const addedTime = new Date(t.added).getTime();
	const addedInstant = t.id.startsWith('rd:') ? rdAddedInstant(addedTime) : addedTime;
	const now = Date.now();
	const ageInMillis = now - addedInstant;
	return ageInMillis >= oldTorrentAge;
}

export function isInProgress(t: UserTorrent) {
	return t.status === UserTorrentStatus.downloading || t.status === UserTorrentStatus.waiting;
}

export function isFailed(t: UserTorrent) {
	return t.status === UserTorrentStatus.error;
}

/**
 * A torrent the debrid service no longer serves.
 *
 * This used to be answered by RD's /torrents/instantAvailability, which RD has
 * since removed - the scan died with it and the filter has been empty ever
 * since. Both services already tell us locally: RD returns a finished torrent
 * with an empty links array once it drops the files, and AD reports magnet
 * status "11". No API call needed.
 */
export function isUncached(t: UserTorrent) {
	if (t.id.startsWith('rd:')) {
		return t.status === UserTorrentStatus.finished && (t.links?.length ?? 0) === 0;
	}
	if (t.id.startsWith('ad:')) {
		return t.serviceStatus === '11';
	}
	return false;
}
