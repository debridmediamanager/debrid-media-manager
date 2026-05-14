import { deleteMagnet as deleteAdTorrent } from '@/services/allDebrid';
import { deleteTorrent as deleteRdTorrent } from '@/services/realDebrid';
import { deleteTorrent as deleteTbTorrent } from '@/services/torbox';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { magnetToastOptions } from './toastOptions';

// Extract error message from any error type
// API-level errors are thrown as plain Error by service functions,
// while HTTP-level errors are AxiosError instances
const getErrorMessage = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		// AD format: { error: { message: "..." } }
		// RD format: { error: "infringing_file" }
		// TB format: { detail: "...", error: "..." }
		return data?.error?.message || data?.detail || data?.error || null;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return null;
};

export const handleDeleteRdTorrent = async (
	rdKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	try {
		console.log('[rdDelete] request', { id, disableToast });
		await deleteRdTorrent(rdKey, id.substring(3));
		console.log('[rdDelete] success', { id });
		if (!disableToast) toast(`Deleted ${id} from RD.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error('[rdDelete] failed', {
			id,
			error: error instanceof Error ? error.message : 'Unknown error',
		});
		console.error(
			'Error deleting RD torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(apiError ? `RD error: ${apiError}` : `Failed to delete ${id} in RD.`);
		return false;
	}
};

export const handleDeleteAdTorrent = async (
	adKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	try {
		await deleteAdTorrent(adKey, id.substring(3));
		if (!disableToast) toast(`Deleted ${id} from AD.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error(
			'Error deleting AD torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(apiError ? `AD error: ${apiError}` : `Failed to delete ${id} in AD.`);
		return false;
	}
};

export const handleDeleteTbTorrent = async (
	tbKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	try {
		await deleteTbTorrent(tbKey, parseInt(id.substring(3)));
		if (!disableToast) toast(`Deleted ${id} from TorBox.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error(
			'Error deleting TB torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(apiError ? `TorBox error: ${apiError}` : `Failed to delete ${id} in TorBox.`);
		return false;
	}
};
