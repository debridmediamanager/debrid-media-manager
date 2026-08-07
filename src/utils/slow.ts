import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { isWebDownloadRowId } from '@/utils/torboxWebDownload';

export function isSlowOrNoLinks(t: UserTorrent) {
	// A web download has no swarm, so its seeder count is always 0 - judging it
	// by that would file every slow-but-healthy one under "delete these".
	if (isWebDownloadRowId(t.id)) return false;

	const oldTorrentAge = 1200000; // 20 mins in milliseconds
	const addedDate = new Date(t.added);
	const now = Date.now();
	const ageInMillis = now - addedDate.getTime();
	return (
		t.status === UserTorrentStatus.downloading &&
		ageInMillis >= oldTorrentAge &&
		t.seeders === 0
	);
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
