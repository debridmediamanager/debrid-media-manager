import { useDownloadsCache } from '@/hooks/cache';
import { restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { UserTorrent } from '@/types/userTorrent';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { getSelectableFiles, isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback: (id: string) => Promise<void>,
	disableToast: boolean = false // todo check if toast is ever disabled
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		await callback(id);
		if (!disableToast) toast('Successfully added as magnet!', magnetToastOptions);
	} catch (error) {
		console.error(error);
		if (!disableToast) toast.error('There was an error adding as magnet. Please try again.');
	}
};

export const handleSelectFilesInRd = async (
	rdKey: string,
	id: string,
	removeFromRdCache: ReturnType<typeof useDownloadsCache>[3],
	disableToast: boolean = false
) => {
	try {
		const response = await getTorrentInfo(rdKey, id.substring(3));
		if (response.filename === 'Magnet') return; // no files yet

		const selectedFiles = getSelectableFiles(response.files.filter(isVideo)).map(
			(file) => file.id
		);
		if (selectedFiles.length === 0) {
			handleDeleteRdTorrent(rdKey, id, removeFromRdCache, true);
			throw new Error('no_files_for_selection');
		}

		await selectFiles(rdKey, id.substring(3), selectedFiles);
	} catch (error) {
		console.error(error);
		if ((error as Error).message === 'no_files_for_selection') {
			if (!disableToast)
				toast.error(`No files for selection, deleting (${id})`, {
					duration: 5000,
				});
		} else {
			if (!disableToast) toast.error(`Error selecting files (${id})`);
		}
	}
};

export const handleReinsertTorrent = async (
	rdKey: string,
	oldId: string,
	userTorrentsList: UserTorrent[],
	removeFromRdCache: ReturnType<typeof useDownloadsCache>[3]
) => {
	try {
		const torrent = userTorrentsList.find((t) => t.id === oldId);
		if (!torrent) throw new Error('no_torrent_found');
		const hash = torrent.hash;
		const id = await addHashAsMagnet(rdKey, hash);
		torrent.id = `rd:${id}`;
		await handleSelectFilesInRd(rdKey, torrent.id, removeFromRdCache);
		await handleDeleteRdTorrent(rdKey, oldId, removeFromRdCache, true);
		toast.success(`Torrent reinserted (${oldId}👉${torrent.id})`, magnetToastOptions);
	} catch (error) {
		toast.error(`Error reinserting torrent (${oldId})`, magnetToastOptions);
		console.error(error);
	}
};

export const handleAddAsMagnetInAd = async (
	adKey: string,
	hash: string,
	callback: (id: string) => Promise<void>,
	disableToast: boolean = false
) => {
	try {
		const resp = await uploadMagnet(adKey, [hash]);
		if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
			throw new Error('no_magnets');
		await callback(`${resp.data.magnets[0].id}`);
		if (!disableToast) toast('Successfully added as magnet!', magnetToastOptions);
	} catch (error) {
		console.error(error);
		if (!disableToast) toast.error('There was an error adding as magnet. Please try again.');
	}
};

export const handleRestartTorrent = async (adKey: string, id: string) => {
	try {
		await restartMagnet(adKey, id.substring(3));
		toast.success(`Torrent restarted (${id})`, magnetToastOptions);
	} catch (error) {
		toast.error(`Error restarting torrent (${id})`, magnetToastOptions);
		console.error(error);
	}
};

export async function handleCopyMagnet(hash: string) {
	const magnet = `magnet:?xt=urn:btih:${hash}`;
	await navigator.clipboard.writeText(magnet);
	toast.success('Copied magnet url to clipboard', magnetToastOptions);
}
