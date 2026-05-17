import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';

export async function handleChangeType(
	t: UserTorrent,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: UserTorrentDB
) {
	const mediaType: UserTorrent['mediaType'] =
		t.mediaType === 'movie' ? 'tv' : t.mediaType === 'tv' ? 'other' : 'movie';
	const updatedTorrent = { ...t, mediaType };

	setUserTorrentsList((prev) => {
		return prev.map((torrent) => (torrent.id === t.id ? { ...torrent, mediaType } : torrent));
	});
	await torrentDB.add(updatedTorrent);
	return updatedTorrent;
}
