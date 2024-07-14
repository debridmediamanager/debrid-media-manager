import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { AsyncFunction, runConcurrentFunctions } from './batch';
import { magnetToastOptions } from './toastOptions';

export async function deleteFilteredTorrents(
	torrentList: UserTorrent[],
	wrapDeleteFn: (t: UserTorrent) => AsyncFunction<void>
) {
	const toDelete = torrentList.map(wrapDeleteFn);
	const [results, errors] = await runConcurrentFunctions(toDelete, 4, 0);
	if (errors.length) {
		toast.error(`Error deleting ${errors.length} torrents`, magnetToastOptions);
	}
	if (results.length) {
		toast.success(`Deleted ${results.length} torrents`, magnetToastOptions);
	}
	if (!errors.length && !results.length) {
		toast('No torrents to delete', magnetToastOptions);
	}
}
