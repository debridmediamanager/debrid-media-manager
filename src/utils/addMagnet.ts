import { useDownloadsCache } from '@/hooks/cache';
import { uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { getSelectableFiles, isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	rdCacheAddr: ReturnType<typeof useDownloadsCache>[2],
	removeFromRdCache: ReturnType<typeof useDownloadsCache>[3],
	instantDownload: boolean = false,
	disableToast: boolean = false
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		if (!disableToast) toast('Successfully added as magnet!', magnetToastOptions);
		rdCacheAddr.single(`rd:${id}`, hash, instantDownload ? 'downloaded' : 'downloading');
		handleSelectFilesInRd(rdKey, `rd:${id}`, removeFromRdCache, true);
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

export const handleAddAsMagnetInAd = async (
	adKey: string,
	hash: string,
	cacheAddr: ReturnType<typeof useDownloadsCache>[2],
	instantDownload: boolean = false,
	disableToast: boolean = false
) => {
	try {
		const resp = await uploadMagnet(adKey, [hash]);
		if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
			throw new Error('no_magnets');
		if (!disableToast) toast('Successfully added as magnet!', magnetToastOptions);
		cacheAddr.single(
			`ad:${resp.data.magnets[0].id}`,
			hash,
			instantDownload ? 'downloaded' : 'downloading'
		);
	} catch (error) {
		console.error(error);
		if (!disableToast) toast.error('There was an error adding as magnet. Please try again.');
	}
};
