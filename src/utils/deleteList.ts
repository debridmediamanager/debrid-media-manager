import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { AsyncFunction, runConcurrentFunctions } from './batch';
import { magnetToastOptions } from './toastOptions';

export async function deleteFilteredTorrents(
	torrentList: UserTorrent[],
	wrapDeleteFn: (t: UserTorrent) => AsyncFunction<string>
): Promise<string[]> {
	const toDelete = torrentList.map(wrapDeleteFn);

	if (toDelete.length === 0) {
		toast('No torrents to delete.', magnetToastOptions);
		return [];
	}

	const progressToast = toast.loading(
		`Deleting 0/${toDelete.length} torrents...`,
		magnetToastOptions
	);

	const [results, errors] = await runConcurrentFunctions(
		toDelete,
		4,
		0,
		(completed, total, errorCount) => {
			const message =
				errorCount > 0
					? `Deleting ${completed}/${total} torrents (${errorCount} errors)...`
					: `Deleting ${completed}/${total} torrents...`;
			toast.loading(message, { id: progressToast });
		}
	);

	// Update the progress toast to show final result
	if (errors.length && results.length) {
		toast.error(`Deleted ${results.length}; ${errors.length} failed.`, {
			id: progressToast,
			...magnetToastOptions,
		});
	} else if (errors.length) {
		toast.error(`Failed to delete ${errors.length} torrents.`, {
			id: progressToast,
			...magnetToastOptions,
		});
	} else if (results.length) {
		toast.success(`Deleted ${results.length} torrents.`, {
			id: progressToast,
			...magnetToastOptions,
		});
	} else {
		toast.dismiss(progressToast);
	}

	return results;
}
