import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { handleReinsertTorrentinRd, handleRestartTorrent } from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { toast } from 'react-hot-toast';
import Swal from 'sweetalert2';
import { normalize } from './mediaId';
import { libraryToastOptions } from './toastOptions';

export async function dedupeBySize(
	filteredList: UserTorrent[],
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setSelectedTorrents: (fn: (prev: Set<string>) => Set<string>) => void,
	rdKey: string | null,
	adKey: string | null
) {
	const deletePreference = await Swal.fire({
		title: 'Delete by size',
		text: 'Choose which duplicate torrents to delete based on size:',
		icon: 'question',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		denyButtonColor: 'green',
		confirmButtonText: 'Delete Smaller',
		denyButtonText: 'Delete Bigger',
		showDenyButton: true,
		cancelButtonText: `Cancel`,
	});

	if (deletePreference.isDismissed) return;
	const deleteBigger = deletePreference.isDenied;

	const wrapDeleteFn = (t: UserTorrent) => async () => {
		const oldId = t.id;
		if (rdKey && t.id.startsWith('rd:')) {
			await handleDeleteRdTorrent(rdKey, t.id);
		}
		if (adKey && t.id.startsWith('ad:')) {
			await handleDeleteAdTorrent(adKey, t.id);
		}
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
		await torrentDB.deleteById(oldId);
		setSelectedTorrents((prev) => {
			prev.delete(oldId);
			return new Set(prev);
		});
	};

	const dupes: UserTorrent[] = [];
	const getKey = (torrent: UserTorrent) => normalize(torrent.title);

	filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
		let key = getKey(cur);
		if (acc[key]) {
			const isPreferred = deleteBigger
				? acc[key].bytes > cur.bytes
				: acc[key].bytes < cur.bytes;
			if (isPreferred) {
				dupes.push(acc[key]);
				acc[key] = cur;
			} else {
				dupes.push(cur);
			}
		} else {
			acc[key] = cur;
		}
		return acc;
	}, {});

	const toDelete = dupes.map(wrapDeleteFn);
	const [results, errors] = await runConcurrentFunctions(toDelete, 4, 0);

	if (errors.length) {
		toast.error(`Error deleting ${errors.length} torrents`, libraryToastOptions);
	}
	if (results.length) {
		toast.success(`Deleted ${results.length} torrents`, libraryToastOptions);
	}
	if (!errors.length && !results.length) {
		toast('No torrents to delete', libraryToastOptions);
	}
}

export async function dedupeByRecency(
	filteredList: UserTorrent[],
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setSelectedTorrents: (fn: (prev: Set<string>) => Set<string>) => void,
	rdKey: string | null,
	adKey: string | null
) {
	const deletePreference = await Swal.fire({
		title: 'Delete by date',
		text: 'Choose which duplicate torrents to delete:',
		icon: 'question',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		denyButtonColor: 'green',
		confirmButtonText: 'Delete Older',
		denyButtonText: 'Delete Newer',
		showDenyButton: true,
		cancelButtonText: `Cancel`,
	});

	if (deletePreference.isDismissed) return;
	const deleteOlder = deletePreference.isConfirmed;

	const wrapDeleteFn = (t: UserTorrent) => async () => {
		const oldId = t.id;
		if (rdKey && t.id.startsWith('rd:')) {
			await handleDeleteRdTorrent(rdKey, t.id);
		}
		if (adKey && t.id.startsWith('ad:')) {
			await handleDeleteAdTorrent(adKey, t.id);
		}
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
		await torrentDB.deleteById(oldId);
		setSelectedTorrents((prev) => {
			prev.delete(oldId);
			return new Set(prev);
		});
	};

	const dupes: UserTorrent[] = [];
	const getKey = (torrent: UserTorrent) => normalize(torrent.title);

	filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
		let key = getKey(cur);
		if (acc[key]) {
			const isPreferred = deleteOlder
				? acc[key].added < cur.added
				: acc[key].added > cur.added;
			if (isPreferred) {
				dupes.push(acc[key]);
				acc[key] = cur;
			} else {
				dupes.push(cur);
			}
		} else {
			acc[key] = cur;
		}
		return acc;
	}, {});

	const toDelete = dupes.map(wrapDeleteFn);
	const [results, errors] = await runConcurrentFunctions(toDelete, 4, 0);

	if (errors.length) {
		toast.error(`Error deleting ${errors.length} torrents`, libraryToastOptions);
	}
	if (results.length) {
		toast.success(`Deleted ${results.length} torrents`, libraryToastOptions);
	}
	if (!errors.length && !results.length) {
		toast('No torrents to delete', libraryToastOptions);
	}
}

export async function combineSameHash(
	filteredList: UserTorrent[],
	torrentDB: UserTorrentDB,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setSelectedTorrents: (fn: (prev: Set<string>) => Set<string>) => void,
	rdKey: string | null,
	adKey: string | null,
	fetchLatestRDTorrents: (customLimit?: number) => Promise<void>,
	fetchLatestADTorrents: () => Promise<void>
) {
	const dupeHashes: Map<string, UserTorrent[]> = new Map();

	filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
		if (cur.status !== UserTorrentStatus.finished) return acc;
		let key = cur.hash;
		if (acc[key]) {
			if (!dupeHashes.has(key)) {
				dupeHashes.set(key, new Array(acc[key]));
			}
			dupeHashes.get(key)?.push(cur);
		} else {
			acc[key] = cur;
		}
		return acc;
	}, {});

	let dupeHashesCount = 0;
	dupeHashes.forEach((hashes) => {
		dupeHashesCount += hashes.length;
	});

	if (dupeHashesCount === 0) {
		toast('No torrents to merge', libraryToastOptions);
		return;
	}

	const confirmed = await Swal.fire({
		title: 'Merge same hash',
		text: `This will combine the ${dupeHashesCount} completed torrents with identical hashes into ${dupeHashes.size} and select all streamable files. Make sure to backup before doing this. Do you want to proceed?`,
		icon: 'question',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes, proceed!',
	});

	if (!confirmed.isConfirmed) return;

	const wrapReinsertFn = (t: UserTorrent) => async () => {
		try {
			const oldId = t.id;
			if (rdKey && t.id.startsWith('rd:')) {
				await handleReinsertTorrentinRd(rdKey, t, true);
				setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
				await torrentDB.deleteById(oldId);
				setSelectedTorrents((prev) => {
					prev.delete(oldId);
					return new Set(prev);
				});
			}
			if (adKey && t.id.startsWith('ad:')) {
				await handleRestartTorrent(adKey, t.id);
			}
		} catch (error) {
			throw error;
		}
	};

	const wrapDeleteFn = (t: UserTorrent) => async () => {
		const oldId = t.id;
		if (rdKey && t.id.startsWith('rd:')) {
			await handleDeleteRdTorrent(rdKey, t.id);
		}
		if (adKey && t.id.startsWith('ad:')) {
			await handleDeleteAdTorrent(adKey, t.id);
		}
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
		await torrentDB.deleteById(oldId);
		setSelectedTorrents((prev) => {
			prev.delete(oldId);
			return new Set(prev);
		});
	};

	let toReinsertAndDelete: AsyncFunction<unknown>[] = [];
	dupeHashes.forEach((sameHashTorrents: UserTorrent[]) => {
		const reinsert = sameHashTorrents.pop();
		if (reinsert) {
			toReinsertAndDelete.push(
				wrapReinsertFn(reinsert),
				...sameHashTorrents.map(wrapDeleteFn)
			);
		}
	});

	const [results, errors] = await runConcurrentFunctions(toReinsertAndDelete, 4, 0);

	if (errors.length) {
		toast.error(`Error with merging ${errors.length} torrents`, libraryToastOptions);
	}
	if (results.length) {
		await fetchLatestRDTorrents(Math.ceil(results.length * 1.1));
		await fetchLatestADTorrents();
		toast.success(`Merged ${results.length} torrents`, libraryToastOptions);
	}
	if (!errors.length && !results.length) {
		toast('No torrents to merge', libraryToastOptions);
	}
}
