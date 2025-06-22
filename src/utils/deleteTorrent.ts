import { deleteMagnet as deleteAdTorrent } from '@/services/allDebrid';
import { deleteTorrent as deleteRdTorrent } from '@/services/realDebrid';
import { deleteTorrent as deleteTbTorrent } from '@/services/torbox';
import toast from 'react-hot-toast';
import { magnetToastOptions } from './toastOptions';

export const handleDeleteRdTorrent = async (
	rdKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteRdTorrent(rdKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error deleting RD torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(`Error deleting torrent in RD (${id})`);
	}
};

export const handleDeleteAdTorrent = async (
	adKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteAdTorrent(adKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error deleting AD torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(`Error deleting torrent in AD (${id})`);
	}
};

export const handleDeleteTbTorrent = async (
	tbKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteTbTorrent(tbKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error deleting TB torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(`Error deleting torrent in TB (${id})`);
	}
};
