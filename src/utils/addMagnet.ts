import { restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { getSelectableFiles, isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback?: () => Promise<void>
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		if (callback) await callback();
		toast('Successfully added as magnet!', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('There was an error adding as magnet. Please try again.');
	}
};

export const handleSelectFilesInRd = async (rdKey: string, id: string) => {
	try {
		const response = await getTorrentInfo(rdKey, id.substring(3));
		if (response.filename === 'Magnet') return; // no files yet

		const selectedFiles = getSelectableFiles(response.files.filter(isVideo)).map(
			(file) => file.id
		);
		if (selectedFiles.length === 0) {
			handleDeleteRdTorrent(rdKey, id, true);
			throw new Error('no_files_for_selection');
		}

		await selectFiles(rdKey, id.substring(3), selectedFiles);
	} catch (error) {
		console.error(error);
		if ((error as Error).message === 'no_files_for_selection') {
			toast.error(`No files for selection, deleting (${id})`, {
				duration: 5000,
			});
		} else {
			toast.error(`Error selecting files (${id})`);
		}
	}
};

export const handleReinsertTorrent = async (
	rdKey: string,
	oldId: string,
	userTorrentsList: UserTorrent[]
) => {
	try {
		const torrentIdx = userTorrentsList.findIndex((t) => t.id === oldId);
		const torrent = userTorrentsList[torrentIdx];
		if (!torrent) throw new Error('no_torrent_found');
		const hash = torrent.hash;
		const newId = await addHashAsMagnet(rdKey, hash);
		await handleSelectFilesInRd(rdKey, `rd:${newId}`);
		await handleDeleteRdTorrent(rdKey, oldId, true);
		toast.success(`Torrent reinserted (${oldId}👉${torrent.id})`, magnetToastOptions);
	} catch (error) {
		toast.error(`Error reinserting torrent (${oldId})`, magnetToastOptions);
		console.error(error);
	}
};

export const handleAddAsMagnetInAd = async (
	adKey: string,
	hash: string,
	callback?: () => Promise<void>
) => {
	try {
		const resp = await uploadMagnet(adKey, [hash]);
		if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
			throw new Error('no_magnets');
		if (callback) await callback();
		toast('Successfully added as magnet!', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('There was an error adding as magnet. Please try again.');
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
