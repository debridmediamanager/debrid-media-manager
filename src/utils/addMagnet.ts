import { restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { createTorrent, getTorrentList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorrentInfoResponse } from '@/services/types';
import { UserTorrent } from '@/torrent/userTorrent';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { convertToTbUserTorrent } from './fetchTorrents';
import { isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback?: (info: TorrentInfoResponse) => Promise<void>
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		const response = await getTorrentInfo(rdKey, id);
		if (response.status === 'downloaded') {
			toast.success('Successfully added torrent!', magnetToastOptions);
		} else {
			toast.error(`Torrent added but status is ${response.status}`, magnetToastOptions);
		}
		if (callback) await callback(response);
	} catch (error: unknown) {
		if (error instanceof AxiosError && error.response?.status === 509) {
			toast.error('Your RD download slots are full. Retrying in 5 seconds...', {
				...magnetToastOptions,
				duration: 5000,
			});
			await new Promise((resolve) => setTimeout(resolve, 5000));
			await handleAddAsMagnetInRd(rdKey, hash, callback);
			return;
		} else if (error instanceof AxiosError && error.response?.status === 503) {
			toast.error('Cannot add torrent. Infringing files are blocked by RD.', {
				...magnetToastOptions,
			});
			return;
		}
		console.error(
			'Error adding hash:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error('There was an error adding hash', magnetToastOptions);
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
			console.error(
				'Error adding hash:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			toast.error('There was an error adding hash');
		}
	}
	if (callback) await callback();
	toast(`Successfully added ${hashes.length - errorCount} hashes!`, magnetToastOptions);
};

export const handleSelectFilesInRd = async (rdKey: string, id: string, bare: boolean = false) => {
	try {
		const response = await getTorrentInfo(rdKey, id.substring(3), bare);
		if (response.files.length === 0) throw new Error('no_files_for_selection');

		let selectedFiles = response.files.filter(isVideo).map((file) => `${file.id}`);
		if (selectedFiles.length === 0) {
			// select all files if no videos
			selectedFiles = response.files.map((file) => `${file.id}`);
		}

		await selectFiles(rdKey, id.substring(3), selectedFiles, bare);
	} catch (error) {
		if (error instanceof Error && error.message !== 'no_files_for_selection') {
			toast.error(`Error selecting files (${id}) - ${error}`);
		}
	}
};

export const handleReinsertTorrentinRd = async (
	rdKey: string,
	torrent: UserTorrent,
	forceDeleteOld: boolean,
	selectedFileIds?: string[]
) => {
	const oldId = torrent.id;
	try {
		const newId = await addHashAsMagnet(rdKey, torrent.hash);

		// Use selected file IDs if provided, otherwise use the default selection logic
		if (selectedFileIds && selectedFileIds.length > 0) {
			await selectFiles(rdKey, newId, selectedFileIds);
		} else {
			await handleSelectFilesInRd(rdKey, `rd:${newId}`);
		}

		if (!forceDeleteOld) {
			const response = await getTorrentInfo(rdKey, newId);
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
			`Error reinserting torrent (${oldId}) ${error.response?.data?.error || error.message}`,
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
		console.error(
			'Error adding hash:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error('There was an error adding hash. Please try again.');
	}
};

export const handleRestartTorrent = async (adKey: string, id: string) => {
	try {
		await restartMagnet(adKey, id.substring(3));
		toast.success(`Torrent restarted (${id})`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error restarting torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(`Error restarting torrent (${id})`, magnetToastOptions);
		throw error;
	}
};

export const handleAddAsMagnetInTb = async (
	tbKey: string,
	hash: string,
	callback?: (torrent: UserTorrent) => Promise<void>
) => {
	try {
		const response = await createTorrent(tbKey, {
			magnet: hash,
		});
		if (response.data?.torrent_id || response.data?.queued_id) {
			const torrentInfo = await getTorrentList(tbKey, { id: response.data.torrent_id });
			const info = torrentInfo.data as TorBoxTorrentInfo;
			const userTorrent = convertToTbUserTorrent(info);
			if (callback) await callback(userTorrent);
			toast.success('Successfully added torrent!', magnetToastOptions);
		} else {
			toast.error('Torrent added but no ID returned', magnetToastOptions);
		}
	} catch (error: any) {
		console.error(
			'Error adding torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error('Error adding torrent', magnetToastOptions);
		throw error;
	}
};
