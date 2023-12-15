import { useDownloadsCache } from '@/hooks/cache';
import { deleteTorrent } from '@/services/realDebrid';
import toast from 'react-hot-toast';
import { magnetToastOptions } from './toastOptions';

export const handleDeleteRdTorrent = async (
	rdKey: string,
	id: string,
	removeFromRdCache: ReturnType<typeof useDownloadsCache>[3],
	disableToast: boolean = false
) => {
	try {
		await deleteTorrent(rdKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
		removeFromRdCache(id);
	} catch (error) {
		console.error(error);
		if (!disableToast) toast.error(`Error deleting torrent in RD (${id})`);
	}
};

export const handleDeleteAdTorrent = async (
	adKey: string,
	id: string,
	removeFromAdCache: ReturnType<typeof useDownloadsCache>[3],
	disableToast: boolean = false
) => {
	try {
		await deleteTorrent(adKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
		removeFromAdCache(id);
	} catch (error) {
		console.error(error);
		if (!disableToast) toast.error(`Error deleting torrent in AD (${id})`);
	}
};
