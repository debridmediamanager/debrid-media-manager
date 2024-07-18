import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';

export function isSlowOrNoLinks(t: UserTorrent) {
	const oldTorrentAge = 1200000; // 20 mins in milliseconds
	const addedDate = new Date(t.added);
	const now = new Date();
	const ageInMillis = now.getTime() - addedDate.getTime();
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
