import { deleteTorrent } from '@/services/realDebrid';
import toast from 'react-hot-toast';
import { magnetToastOptions } from './toastOptions';
import { deleteMagnet } from '@/services/allDebrid';

export const handleDeleteRdTorrent = async (
	rdKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteTorrent(rdKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error(`Error deleting torrent in RD (${id})`);
	}
};

export const handleDeleteAdTorrent = async (
	adKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteMagnet(adKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error(`Error deleting torrent in AD (${id})`);
	}
};
