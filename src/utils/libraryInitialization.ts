import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { toast } from 'react-hot-toast';
import { handleSelectFilesInRd } from './addMagnet';
import { libraryToastOptions } from './toastOptions';

export async function selectPlayableFiles(
	torrents: UserTorrent[],
	rdKey: string | null,
	torrentDB: UserTorrentDB
) {
	const waitingForSelection = torrents
		.filter((t) => t.serviceStatus === 'waiting_files_selection')
		.map((t) => async () => {
			await handleSelectFilesInRd(rdKey!, t.id);
			t.status = UserTorrentStatus.downloading;
			torrentDB.add(t);
		});

	const results = await Promise.allSettled(waitingForSelection.map((f) => f()));

	const successCount = results.filter((r) => r.status === 'fulfilled').length;
	const errorCount = results.filter((r) => r.status === 'rejected').length;

	if (errorCount) {
		toast.error(`Error selecting files on ${errorCount} torrents`, libraryToastOptions);
	}
	if (successCount) {
		toast.success(`Started downloading ${successCount} torrents`, libraryToastOptions);
	}
}

export async function initializeLibrary(
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setLoading: (loading: boolean) => void,
	rdKey: string | null,
	adKey: string | null,
	fetchLatestRDTorrents: () => Promise<void>,
	fetchLatestADTorrents: () => Promise<void>,
	userTorrentsList: UserTorrent[],
	skipFullLoad: boolean = false
) {
	await torrentDB.initializeDB();
	let torrents = await torrentDB.all();
	if (torrents.length) {
		setUserTorrentsList((prev) => {
			const deleted = prev.filter((p) => !torrents.some((t) => t.id === p.id));
			prev = prev.filter((p) => !deleted.some((d) => d.id === p.id));
			const newTorrents = torrents.filter((t) => !prev.some((p) => p.id === t.id));
			return [...prev, ...newTorrents];
		});
		setLoading(false);
	}

	// Skip full library reload if we're just adding a magnet
	if (!skipFullLoad) {
		await Promise.all([fetchLatestRDTorrents(), fetchLatestADTorrents()]);
		await selectPlayableFiles(userTorrentsList, rdKey, torrentDB);
	}
}
