import { deleteMagnet as deleteAdTorrent } from '@/services/allDebrid';
import {
	deletePremiumizeFolder,
	deletePremiumizeItem,
	deletePremiumizeTransfer,
} from '@/services/premiumize';
import { deleteTorrent as deleteRdTorrent } from '@/services/realDebrid';
import { deleteTorrent as deleteTbTorrent, deleteWebDownload } from '@/services/torbox';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { parsePremiumizeRowId } from './premiumizeRow';
import { magnetToastOptions } from './toastOptions';
import { isWebDownloadRowId, parseTorBoxRowId } from './torboxWebDownload';

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
		if (isWebDownloadRowId(id)) {
			await deleteWebDownload(tbKey, parseTorBoxRowId(id));
		} else {
			await deleteTbTorrent(tbKey, parseTorBoxRowId(id));
		}
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

/**
 * Removes a Premiumize row and the content behind it.
 *
 * `transfer/delete` deletes the transfer's **files** as well as its record -
 * that is not what the vendor documentation says ("Deletes a transfer record")
 * but it is what it does, and it is exactly what "remove from my library" means.
 * `transfer/clearfinished` is the call that only tidies the list, and it is
 * deliberately not used here.
 */
export const handleDeletePmTorrent = async (
	pmKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	const row = parsePremiumizeRowId(id);
	if (!row) {
		toast.error(`Unrecognised Premiumize row ${id}.`);
		return false;
	}
	try {
		if (row.kind === 'transfer') await deletePremiumizeTransfer(pmKey, row.id);
		else if (row.kind === 'folder') await deletePremiumizeFolder(pmKey, row.id);
		else await deletePremiumizeItem(pmKey, row.id);
		if (!disableToast) toast(`Deleted ${id} from Premiumize.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error(
			'Error deleting Premiumize item:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `Premiumize error: ${apiError}` : `Failed to delete ${id} in Premiumize.`
		);
		return false;
	}
};
