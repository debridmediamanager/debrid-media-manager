import { restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback?: () => Promise<void>
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		// get info to check if it's ready
		const response = await getTorrentInfo(rdKey, id, true);
		if (response.progress != 100) {
			toast.success('Torrent added but not yet ready', magnetToastOptions);
			return;
		}
		if (callback) await callback();
		toast('Successfully added hash!', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('There was an error adding hash. Please try again.');
	}
};

export const handleAddMultipleHashesInRd = async (
	rdKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let errorCount = 0;
	for (const hash of hashes) {
		try {
			const id = await addHashAsMagnet(rdKey, hash);
			await handleSelectFilesInRd(rdKey, `rd:${id}`);
		} catch (error) {
			errorCount++;
			console.error(error);
			toast.error('There was an error adding hash. Please try again.');
		}
	}
	if (callback) await callback();
	toast(`Successfully added ${hashes.length - errorCount} hashes!`, magnetToastOptions);
};

export const handleSelectFilesInRd = async (rdKey: string, id: string, bare: boolean = false) => {
	try {
		const response = await getTorrentInfo(rdKey, id.substring(3), bare);
		if (response.filename === 'Magnet') return; // no files yet

		let selectedFiles = response.files.filter(isVideo).map((file) => `${file.id}`);
		if (selectedFiles.length === 0) {
			selectedFiles = response.files.map((file) => `${file.id}`);
		}
		await selectFiles(rdKey, id.substring(3), selectedFiles, bare);
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

export const handleReinsertTorrentinRd = async (
	rdKey: string,
	torrent: UserTorrent,
	forceDeleteOld: boolean
) => {
	const oldId = torrent.id;
	try {
		const newId = await addHashAsMagnet(rdKey, torrent.hash);
		await handleSelectFilesInRd(rdKey, `rd:${newId}`);
		if (!forceDeleteOld) {
			const response = await getTorrentInfo(rdKey, newId, true);
			if (response.progress != 100) {
				toast.success(
					`Torrent reinserted (${newId}) but not yet ready`,
					magnetToastOptions
				);
				return;
			}
		}
		await handleDeleteRdTorrent(rdKey, oldId, true);
		toast.success(`Torrent reinserted (${oldId}👉${newId})`, magnetToastOptions);
	} catch (error: any) {
		toast.error(
			`Error reinserting torrent (${oldId}) ${error.response.data.error}`,
			magnetToastOptions
		);
		throw error;
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
		toast('Successfully added hash!', magnetToastOptions);
	} catch (error) {
		toast.error('There was an error adding hash. Please try again.');
		throw error;
	}
};

export const handleAddMultipleHashesInAd = async (
	adKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	try {
		const resp = await uploadMagnet(adKey, hashes);
		if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
			throw new Error('no_magnets');
		if (callback) await callback();
		toast(`Successfully added ${resp.data.magnets.length} hashes!`, magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('There was an error adding hash. Please try again.');
	}
};

export const handleRestartTorrent = async (adKey: string, id: string) => {
	try {
		await restartMagnet(adKey, id.substring(3));
		toast.success(`Torrent restarted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error(`Error restarting torrent (${id}) ${error}`, magnetToastOptions);
		throw error;
	}
};

export async function handleCopyMagnet(hash: string) {
	const magnet = `magnet:?xt=urn:btih:${hash}`;
	await navigator.clipboard.writeText(magnet);
	toast.success('Copied magnet url to clipboard', magnetToastOptions);
}
