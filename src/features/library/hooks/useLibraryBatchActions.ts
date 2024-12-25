import { UserTorrent } from '@/torrent/userTorrent';
import {
	handleAddMultipleHashesInAd,
	handleAddMultipleHashesInRd,
	handleReinsertTorrentinRd,
	handleRestartTorrent,
} from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { deleteFilteredTorrents } from '@/utils/deleteList';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { generateHashList } from '@/utils/hashList';
import { localRestore } from '@/utils/localRestore';
import { normalize } from '@/utils/mediaId';
import { libraryToastOptions, magnetToastOptions } from '@/utils/toastOptions';
import { saveAs } from 'file-saver';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import Swal from 'sweetalert2';

export function useLibraryBatchActions(
	rdKey: string | null,
	adKey: string | null,
	userTorrentsList: UserTorrent[],
	setUserTorrentsList: (
		torrents: UserTorrent[] | ((prev: UserTorrent[]) => UserTorrent[])
	) => void,
	setSelectedTorrents: (selected: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
	torrentDB: any,
	triggerFetchLatestRDTorrents: (limit?: number) => Promise<void>,
	triggerFetchLatestADTorrents: () => Promise<void>
) {
	const wrapDeleteFn = (t: UserTorrent) => {
		return async () => {
			const oldId = t.id;
			if (rdKey && t.id.startsWith('rd:')) {
				await handleDeleteRdTorrent(rdKey, t.id);
			}
			if (adKey && t.id.startsWith('ad:')) {
				await handleDeleteAdTorrent(adKey, t.id);
			}
			setUserTorrentsList((prev: UserTorrent[]) =>
				prev.filter((torrent) => torrent.id !== oldId)
			);
			await torrentDB.deleteById(oldId);
			setSelectedTorrents((prev: Set<string>) => {
				const newSet = new Set(prev);
				newSet.delete(oldId);
				return newSet;
			});
		};
	};

	const wrapReinsertFn = (t: UserTorrent) => {
		return async () => {
			try {
				const oldId = t.id;
				if (rdKey && t.id.startsWith('rd:')) {
					await handleReinsertTorrentinRd(rdKey, t, true);
					setUserTorrentsList((prev: UserTorrent[]) =>
						prev.filter((torrent) => torrent.id !== oldId)
					);
					await torrentDB.deleteById(oldId);
					setSelectedTorrents((prev: Set<string>) => {
						const newSet = new Set(prev);
						newSet.delete(oldId);
						return newSet;
					});
				}
				if (adKey && t.id.startsWith('ad:')) {
					await handleRestartTorrent(adKey, t.id);
				}
			} catch (error) {
				throw error;
			}
		};
	};

	const handleDeleteShownTorrents = async (relevantList: UserTorrent[]) => {
		if (
			relevantList.length > 0 &&
			!(
				await Swal.fire({
					title: 'Delete shown',
					text: `This will delete the ${relevantList.length} torrents filtered. Are you sure?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, delete!',
				})
			).isConfirmed
		)
			return;
		await deleteFilteredTorrents(relevantList, wrapDeleteFn);
		setSelectedTorrents(new Set());
	};

	const [isReinserting, setIsReinserting] = useState(false);

	const handleReinsertTorrents = async (relevantList: UserTorrent[]) => {
		if (isReinserting) return;
		try {
			setIsReinserting(true);
			if (
				relevantList.length > 0 &&
				!(
					await Swal.fire({
						title: 'Reinsert shown',
						text: `This will reinsert the ${relevantList.length} torrents filtered. Are you sure?`,
						icon: 'warning',
						showCancelButton: true,
						confirmButtonColor: '#3085d6',
						cancelButtonColor: '#d33',
						confirmButtonText: 'Yes, reinsert!',
					})
				).isConfirmed
			) {
				return;
			}

			const toReinsert = relevantList.map(wrapReinsertFn);
			const [results, errors] = await runConcurrentFunctions(toReinsert, 4, 0);

			if (errors.length) {
				toast.error(`Error reinserting ${errors.length} torrents`, magnetToastOptions);
			}
			if (results.length) {
				setSelectedTorrents(new Set());
				await triggerFetchLatestRDTorrents(Math.ceil(relevantList.length * 1.1));
				await triggerFetchLatestADTorrents();
				toast.success(`Reinserted ${results.length} torrents`, magnetToastOptions);
			}
			if (!errors.length && !results.length) {
				toast('No torrents to reinsert', magnetToastOptions);
			}
		} finally {
			setIsReinserting(false);
		}
	};

	const handleGenerateHashlist = async (relevantList: UserTorrent[]) => {
		const { value: title } = await Swal.fire({
			title: 'Enter a title for the hash list',
			input: 'text',
			inputPlaceholder: 'Enter a title',
			inputAttributes: {
				autocapitalize: 'off',
			},
			showCancelButton: true,
		});
		if (!title) return;
		generateHashList(title, relevantList);
	};

	const dedupeBySize = async (filteredList: UserTorrent[]) => {
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
		const getKey = (torrent: UserTorrent) => normalize(torrent.title);
		const dupes: UserTorrent[] = [];

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
	};

	const dedupeByRecency = async (filteredList: UserTorrent[]) => {
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
		const getKey = (torrent: UserTorrent) => normalize(torrent.title);
		const dupes: UserTorrent[] = [];

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
	};

	const combineSameHash = async (filteredList: UserTorrent[]) => {
		const dupeHashes: Map<string, UserTorrent[]> = new Map();
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			if (cur.status !== 'finished') return acc;
			let key = cur.hash;
			if (acc[key]) {
				if (!dupeHashes.has(key)) {
					dupeHashes.set(key, [acc[key]]);
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

		if (
			dupeHashesCount > 0 &&
			!(
				await Swal.fire({
					title: 'Merge same hash',
					text: `This will combine the ${dupeHashesCount} completed torrents with identical hashes into ${dupeHashes.size} and select all streamable files. Make sure to backup before doing this. Do you want to proceed?`,
					icon: 'question',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, proceed!',
				})
			).isConfirmed
		)
			return;

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
			await triggerFetchLatestRDTorrents(Math.ceil(results.length * 1.1));
			await triggerFetchLatestADTorrents();
			toast.success(`Merged ${results.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to merge', libraryToastOptions);
		}
	};

	const localBackup = async (torrentsToBackup: UserTorrent[]) => {
		toast('Generating a local backup file', libraryToastOptions);
		try {
			const hashList = torrentsToBackup.map((t) => ({
				filename: t.filename,
				hash: t.hash,
			}));
			const blob = new Blob([JSON.stringify(hashList, null, 2)], {
				type: 'application/json',
			});
			saveAs(blob, `backup-${Date.now()}.dmm.json`);
		} catch (error) {
			toast.error(`Error creating a backup file`, libraryToastOptions);
			console.error(error);
		}
	};

	const handleLocalRestore = async (debridService: 'rd' | 'ad') => {
		return localRestore((files: any[]) => {
			const allHashes = new Set(userTorrentsList.map((t) => t.hash));
			const processingPromise = new Promise<{ success: number; error: number }>(
				async (resolve) => {
					toast.loading(`DO NOT REFRESH THE PAGE`, libraryToastOptions);

					const notAddingCount = files.filter((f) => allHashes.has(f.hash)).length;
					if (notAddingCount > 0) {
						toast.error(
							`${notAddingCount} torrents are already in your library`,
							libraryToastOptions
						);
					}

					const hashesToAdd = files.map((f) => f.hash).filter((h) => !allHashes.has(h));

					if (hashesToAdd.length === 0) {
						resolve({ success: 0, error: 0 });
						return;
					}

					try {
						if (rdKey && debridService === 'rd') {
							await handleAddMultipleHashesInRd(
								rdKey,
								hashesToAdd,
								async () =>
									await triggerFetchLatestRDTorrents(
										Math.ceil(hashesToAdd.length * 1.1)
									)
							);
						} else if (adKey && debridService === 'ad') {
							await handleAddMultipleHashesInAd(
								adKey,
								hashesToAdd,
								async () => await triggerFetchLatestADTorrents()
							);
						}
						resolve({ success: hashesToAdd.length, error: 0 });
					} catch (error) {
						console.error('Error restoring torrents:', error);
						resolve({ success: 0, error: hashesToAdd.length });
					}
				}
			);

			toast.promise(
				processingPromise,
				{
					loading: `Restoring ${files.length} downloads in your library.`,
					success: ({ success, error }) => {
						setTimeout(() => location.reload(), 10000);
						return `Restored ${success} torrents but failed on ${error} others in your ${debridService.toUpperCase()} library. Refreshing the page in 10 seconds.`;
					},
					error: '',
				},
				{
					...libraryToastOptions,
					duration: 10000,
				}
			);
		});
	};

	return {
		handleDeleteShownTorrents,
		handleReinsertTorrents,
		handleGenerateHashlist,
		dedupeBySize,
		dedupeByRecency,
		combineSameHash,
		localBackup,
		handleLocalRestore,
	};
}
