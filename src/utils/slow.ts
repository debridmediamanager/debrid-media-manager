import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';

export function isSlowOrNoLinks(t: UserTorrent) {
	const oldTorrentAge = 3600000; // 1 hour in milliseconds
	const addedDate = new Date(t.added);
	const now = new Date();
	const ageInMillis = now.getTime() - addedDate.getTime();
	return (
		(t.links.length === 0 && t.progress === 100) ||
		(t.progress !== 100 && ageInMillis >= oldTorrentAge && t.seeders === 0)
	);
}

export function isInProgress(t: UserTorrent) {
	return t.status === UserTorrentStatus.downloading;
}

export function isFailed(t: UserTorrent) {
	return /error|dead|virus/.test(t.status);
}
