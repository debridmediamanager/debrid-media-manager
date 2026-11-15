import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { AsyncFunction, runConcurrentFunctions } from './batch';
import { magnetToastOptions } from './toastOptions';

export async function deleteFilteredTorrents(
	torrentList: UserTorrent[],
	wrapDeleteFn: (t: UserTorrent) => AsyncFunction<string>
): Promise<string[]> {
	if (torrentList.length === 0) {
		toast('No torrents to delete.', magnetToastOptions);
		return [];
	}
	const total = torrentList.length;

	const progressToast = toast.loading(`Deleting 0/${total} torrents...`, magnetToastOptions);

	// put.io deletes one row at a time in its own queue, and may wait on a "Delete
	// for good?" prompt: in the shared pool its rows held slots the other providers'
	// rows waited for. So they get a pool of one, and the rest keep their four.
	const isPutio = (t: UserTorrent) => t.id.startsWith('pt:');
	const pools = [
		{ rows: torrentList.filter((t) => !isPutio(t)), concurrency: 4 },
		{ rows: torrentList.filter(isPutio), concurrency: 1 },
	].filter((pool) => pool.rows.length > 0);
	const progress = pools.map(() => ({ completed: 0, errors: 0 }));
	const settled = await Promise.all(
		pools.map((pool, i) =>
			runConcurrentFunctions(
				pool.rows.map(wrapDeleteFn),
				pool.concurrency,
				0,
				(completed, _total, errorCount) => {
					progress[i] = { completed, errors: errorCount };
					const done = progress.reduce((sum, p) => sum + p.completed, 0);
					const failed = progress.reduce((sum, p) => sum + p.errors, 0);
					const message =
						failed > 0
							? `Deleting ${done}/${total} torrents (${failed} errors)...`
							: `Deleting ${done}/${total} torrents...`;
					toast.loading(message, { id: progressToast });
				}
			)
		)
	);
	const results = settled.flatMap(([done]) => done);
	const errors = settled.flatMap(([, failed]) => failed);

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
