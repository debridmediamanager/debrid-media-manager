import { deleteMagnet as deleteAdTorrent } from '@/services/allDebrid';
import { deleteSeedboxTorrents } from '@/services/debridLink';
import { removeOffcloudCloud } from '@/services/offcloud';
import {
	deletePremiumizeFolder,
	deletePremiumizeItem,
	deletePremiumizeTransfer,
} from '@/services/premiumize';
import { deleteTorrent as deleteRdTorrent } from '@/services/realDebrid';
import { deleteTorrent as deleteTbTorrent, deleteWebDownload } from '@/services/torbox';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { parseOffcloudRowId } from './offcloudRow';
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

/**
 * Removes an Offcloud cloud item.
 *
 * **Offcloud's delete is a GET** - `GET /api/cloud/remove/<requestId>` - which
 * makes the URL itself destructive: anything that resolves links (a prefetcher,
 * a log scraper, a chat client unfurling a paste, a browser speculative fetch)
 * would destroy a user's item just by following it. That is why this goes
 * through `removeOffcloudCloud` and why the URL is never built here, never
 * logged, and never rendered as an `href`. Only an explicit user action reaches
 * this function.
 *
 * Removal is complete and immediate: status and explore both 404 afterwards and
 * the item leaves the history. The signed CDN links it minted keep serving,
 * which is measured behaviour and not a leak this code can close.
 */
export const handleDeleteOcTorrent = async (
	ocKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	const requestId = parseOffcloudRowId(id);
	if (!requestId) {
		toast.error(`Unrecognised Offcloud row ${id}.`);
		return false;
	}
	try {
		await removeOffcloudCloud(ocKey, requestId);
		if (!disableToast) toast(`Deleted ${id} from Offcloud.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error(
			'Error deleting Offcloud item:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `Offcloud error: ${apiError}` : `Failed to delete ${id} in Offcloud.`
		);
		return false;
	}
};

/**
 * Removes a Debrid-Link seedbox torrent.
 *
 * **Debrid-Link's removal never fails, so this can only report "asked".**
 * `DELETE /seedbox/<garbage>/remove` answers `{"success":true,"value":["<garbage>"]}`
 * — the echoed array is what the server *tried*, not what it found, and no error
 * shape exists for "no such torrent". So a `true` here means the request was
 * accepted, never that a torrent was destroyed; the only way to know is to list
 * again, which the library page does on its next fetch.
 *
 * Two consequences worth keeping in mind rather than coding around: the download
 * URLs the torrent minted **keep serving after removal** (keyless and durable,
 * measured), and re-adding the same hash returns the *same* torrent id — so a
 * delete is never as final as it looks.
 */
export const handleDeleteDlTorrent = async (
	dlKey: string,
	id: string,
	disableToast: boolean = false
): Promise<boolean> => {
	// Row ids are `dl:<torrentId>`. Parsed inline because there is one row shape
	// to parse, unlike Premiumize's transfer/folder/file trio.
	const torrentId = id.startsWith('dl:') ? id.slice(3) : '';
	if (!torrentId) {
		toast.error(`Unrecognised Debrid-Link row ${id}.`);
		return false;
	}
	try {
		await deleteSeedboxTorrents(dlKey, [torrentId]);
		if (!disableToast) toast(`Deleted ${id} from Debrid-Link.`, magnetToastOptions);
		return true;
	} catch (error) {
		console.error(
			'Error deleting Debrid-Link torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `Debrid-Link error: ${apiError}` : `Failed to delete ${id} in Debrid-Link.`
		);
		return false;
	}
};
