import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';

export async function handleChangeType(
	t: UserTorrent,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: UserTorrentDB
) {
	t.mediaType = t.mediaType === 'movie' ? 'tv' : t.mediaType === 'tv' ? 'other' : 'movie';
	setUserTorrentsList((prev) => {
		const newList = [...prev];
		const idx = prev.findIndex((i) => i.id === t.id);
		if (idx >= 0) {
			newList[idx].mediaType = t.mediaType;
		}
		return newList;
	});
	await torrentDB.add(t);
}
