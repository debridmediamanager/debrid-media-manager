import { deleteMagnet } from '@/services/allDebrid';
import { deleteTorrent } from '@/services/realDebrid';
import { deleteTorBoxTorrent } from "@/services/torbox";
import toast from 'react-hot-toast';
import { magnetToastOptions } from './toastOptions';

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

export const handleDeleteTbTorrent = async (
	tbKey: string,
	id: string,
	disableToast: boolean = false
) => {
	try {
		await deleteTorBoxTorrent(tbKey, id.substring(3));
		if (!disableToast) toast(`Torrent deleted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error(`Error deleting TorBox torrent (${id})`);
	}
};
