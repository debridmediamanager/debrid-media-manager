import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { AsyncFunction, runConcurrentFunctions } from './batch';
import { magnetToastOptions } from './toastOptions';

export async function reinsertFilteredTorrents(
	torrentList: UserTorrent[],
	wrapReinsertFn: (t: UserTorrent) => AsyncFunction<void>
) {
	const toReinsert = torrentList.map(wrapReinsertFn);
	const [results, errors] = await runConcurrentFunctions(toReinsert, 4, 0);
	if (errors.length) {
		toast.error(`Error reinserting ${errors.length} torrents`, magnetToastOptions);
	}
	if (results.length) {
		toast.success(`Reinserted ${results.length} torrents`, magnetToastOptions);
	}
	if (!errors.length && !results.length) {
		toast('No torrents to reinsert', magnetToastOptions);
	}
}
