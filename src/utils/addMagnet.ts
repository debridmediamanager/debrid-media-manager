import { uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet } from '@/services/realDebrid';
import { toast } from 'react-hot-toast';
import { downloadMagnetFile } from './downloadMagnet';
import { magnetToastOptions } from './toastOptions';

export const handleCopyMagnet = (hash: string) => {
	const shouldDownloadMagnets =
		window.localStorage.getItem('settings:downloadMagnets') === 'true';
	if (shouldDownloadMagnets) {
		downloadMagnetFile(hash);
		toast.success('Magnet file downloaded', magnetToastOptions);
	} else {
		const magnetLink = `magnet:?xt=urn:btih:${hash}`;
		navigator.clipboard.writeText(magnetLink);
		toast.success('Magnet link copied to clipboard', magnetToastOptions);
	}
};

export const handleAddAsMagnetInRd = async (rdKey: string, hash: string) => {
	try {
		await addHashAsMagnet(rdKey, hash);
		toast.success('Added to Real-Debrid', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('Failed to add to Real-Debrid', magnetToastOptions);
	}
};

export const handleAddAsMagnetInAd = async (adKey: string, hash: string) => {
	try {
		await uploadMagnet(adKey, [hash]);
		toast.success('Added to AllDebrid', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('Failed to add to AllDebrid', magnetToastOptions);
	}
};

export const handleAddMultipleHashesInRd = async (
	rdKey: string,
	hashes: string[],
	onSuccess?: () => Promise<void>
) => {
	const promises = hashes.map((hash) => addHashAsMagnet(rdKey, hash));
	const results = await Promise.allSettled(promises);
	const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
	const rejected = results.filter((r) => r.status === 'rejected').length;
	if (fulfilled > 0) {
		toast.success(`Added ${fulfilled} torrents to Real-Debrid`, magnetToastOptions);
		onSuccess && (await onSuccess());
	}
	if (rejected > 0) {
		toast.error(`Failed to add ${rejected} torrents to Real-Debrid`, magnetToastOptions);
	}
};

export const handleAddMultipleHashesInAd = async (
	adKey: string,
	hashes: string[],
	onSuccess?: () => Promise<void>
) => {
	try {
		await uploadMagnet(adKey, hashes);
		toast.success(`Added ${hashes.length} torrents to AllDebrid`, magnetToastOptions);
		onSuccess && (await onSuccess());
	} catch (error) {
		console.error(error);
		toast.error(`Failed to add torrents to AllDebrid`, magnetToastOptions);
	}
};

export const handleReinsertTorrentinRd = async (
	rdKey: string,
	torrent: { hash: string },
	reload: boolean = false
) => {
	try {
		await addHashAsMagnet(rdKey, torrent.hash);
		toast.success('Reinserted in Real-Debrid', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('Failed to reinsert in Real-Debrid', magnetToastOptions);
		throw error;
	}
};

export const handleRestartTorrent = async (adKey: string, id: string) => {
	try {
		await uploadMagnet(adKey, [id]);
		toast.success('Restarted in AllDebrid', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('Failed to restart in AllDebrid', magnetToastOptions);
		throw error;
	}
};

export const handleSelectFilesInRd = async (rdKey: string, id: string) => {
	try {
		await addHashAsMagnet(rdKey, id);
		toast.success('Selected files in Real-Debrid', magnetToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('Failed to select files in Real-Debrid', magnetToastOptions);
		throw error;
	}
};
