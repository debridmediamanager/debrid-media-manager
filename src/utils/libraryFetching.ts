import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { libraryToastOptions } from '@/utils/toastOptions';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';

export async function fetchLatestRDTorrents(
	rdKey: string | null,
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setLoading: (loading: boolean) => void,
	setRdSyncing: (syncing: boolean) => void,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>,
	customLimit?: number
) {
	const oldTorrents = await torrentDB.all();
	const oldIds = new Set(
		oldTorrents.map((torrent) => torrent.id).filter((id) => id.startsWith('rd:'))
	);
	const inProgressIds = new Set(
		oldTorrents
			.filter(
				(t) =>
					t.status === UserTorrentStatus.waiting ||
					t.status === UserTorrentStatus.downloading
			)
			.map((t) => t.id)
			.filter((id) => id.startsWith('rd:'))
	);
	const newIds = new Set();

	if (!rdKey) {
		setLoading(false);
		setRdSyncing(false);
	} else {
		await fetchRealDebrid(
			rdKey,
			async (torrents: UserTorrent[]) => {
				// add all new torrents to the database
				torrents.forEach((torrent) => newIds.add(torrent.id));
				const newTorrents = torrents.filter((torrent) => !oldIds.has(torrent.id));
				setUserTorrentsList((prev) => {
					const newTorrentIds = new Set(newTorrents.map((t) => t.id));
					const filteredPrev = prev.filter((t) => !newTorrentIds.has(t.id));
					return [...newTorrents, ...filteredPrev];
				});
				await torrentDB.addAll(newTorrents);

				// refresh the torrents that are in progress
				const inProgressTorrents = torrents.filter(
					(torrent) =>
						torrent.status === UserTorrentStatus.waiting ||
						torrent.status === UserTorrentStatus.downloading ||
						inProgressIds.has(torrent.id)
				);
				setUserTorrentsList((prev) => {
					const newList = [...prev];
					for (const t of inProgressTorrents) {
						const idx = prev.findIndex((i) => i.id === t.id);
						if (idx >= 0) {
							newList[idx] = t;
						}
					}
					return newList;
				});
				await torrentDB.addAll(inProgressTorrents);

				setLoading(false);
			},
			customLimit
		);
		setRdSyncing(false);

		// this is just a small sync
		if (customLimit) return;

		toast.success(
			`Updated ${newIds.size} torrents in your Real-Debrid library`,
			libraryToastOptions
		);
	}

	const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
	await Promise.all(
		toDelete.map(async (id) => {
			setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
			await torrentDB.deleteById(id);
			setSelectedTorrents((prev) => {
				prev.delete(id);
				return new Set(prev);
			});
		})
	);
}

export async function fetchLatestADTorrents(
	adKey: string | null,
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setLoading: (loading: boolean) => void,
	setAdSyncing: (syncing: boolean) => void,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>
) {
	const oldTorrents = await torrentDB.all();
	const oldIds = new Set(
		oldTorrents.map((torrent) => torrent.id).filter((id) => id.startsWith('ad:'))
	);
	const inProgressIds = new Set(
		oldTorrents
			.filter(
				(t) =>
					t.status === UserTorrentStatus.waiting ||
					t.status === UserTorrentStatus.downloading
			)
			.map((t) => t.id)
			.filter((id) => id.startsWith('ad:'))
	);
	const newIds = new Set();

	if (!adKey) {
		setLoading(false);
		setAdSyncing(false);
	} else {
		await fetchAllDebrid(adKey, async (torrents: UserTorrent[]) => {
			// add all new torrents to the database
			torrents.forEach((torrent) => newIds.add(torrent.id));
			const newTorrents = torrents.filter((torrent) => !oldIds.has(torrent.id));
			setUserTorrentsList((prev) => {
				const newTorrentIds = new Set(newTorrents.map((t) => t.id));
				const filteredPrev = prev.filter((t) => !newTorrentIds.has(t.id));
				return [...newTorrents, ...filteredPrev];
			});
			await torrentDB.addAll(newTorrents);

			// refresh the torrents that are in progress
			const inProgressTorrents = torrents.filter(
				(torrent) =>
					torrent.status === UserTorrentStatus.waiting ||
					torrent.status === UserTorrentStatus.downloading ||
					inProgressIds.has(torrent.id)
			);
			setUserTorrentsList((prev) => {
				return prev.map((t) => {
					const found = inProgressTorrents.find((i) => i.id === t.id);
					if (found) {
						return found;
					}
					return t;
				});
			});
			await torrentDB.addAll(inProgressTorrents);

			setLoading(false);
		});
		setAdSyncing(false);
		toast.success(
			`Updated ${newIds.size} torrents in your AllDebrid library`,
			libraryToastOptions
		);
	}

	const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
	await Promise.all(
		toDelete.map(async (id) => {
			setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
			await torrentDB.deleteById(id);
			setSelectedTorrents((prev) => {
				prev.delete(id);
				return new Set(prev);
			});
		})
	);
}
