import {
	checkCachedStatus,
	createTorrent,
	deleteTorrent,
	getTorrentList,
	requestDownloadLink,
} from '@/services/torbox';
import { TorBoxTorrentInfo } from '@/services/types';
import ptt from 'parse-torrent-title';

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 1000;

async function waitForTorrentReady(
	apiKey: string,
	torrentId: number
): Promise<TorBoxTorrentInfo | null> {
	for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
		const result = await getTorrentList(apiKey, { id: torrentId });
		if (!result.success || !result.data) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			continue;
		}

		const torrent = Array.isArray(result.data) ? result.data[0] : result.data;
		if (!torrent) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			continue;
		}

		// TorBox torrent statuses: downloading, uploading, stalled, paused, completed, cached, metaDL, checkingResumeData
		if (
			torrent.download_finished ||
			torrent.download_state === 'completed' ||
			torrent.download_state === 'cached'
		) {
			return torrent;
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	return null;
}

export const getTorBoxStreamUrl = async (
	apiKey: string,
	hash: string,
	fileId: number,
	mediaType: string
): Promise<[string, number, number, number, number, number]> => {
	let streamUrl = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
	let fileSize = 0;
	let torrentId = 0;

	try {
		// First check if the torrent is cached
		const cachedStatus = await checkCachedStatus({ hash, list_files: true }, apiKey);
		if (!cachedStatus.success || !cachedStatus.data) {
			throw new Error('Failed to check cached status');
		}

		const cachedData = cachedStatus.data as Record<string, any>;
		if (!cachedData[hash]) {
			throw new Error('Torrent not cached on TorBox');
		}

		// Add the torrent
		const createResult = await createTorrent(apiKey, {
			magnet: `magnet:?xt=urn:btih:${hash}`,
		});

		if (
			!createResult.success ||
			!createResult.data ||
			createResult.data.torrent_id === undefined
		) {
			throw new Error('Failed to add torrent to TorBox');
		}

		torrentId = createResult.data.torrent_id;

		try {
			// Wait for torrent to be ready
			const torrent = await waitForTorrentReady(apiKey, torrentId);
			if (!torrent) {
				throw new Error('Torrent did not become ready in time');
			}

			// Find the file
			const file = torrent.files?.find((f) => f.id === fileId);
			if (!file) {
				throw new Error(`File with ID ${fileId} not found in torrent`);
			}

			// Get download link
			const downloadResult = await requestDownloadLink(apiKey, {
				torrent_id: torrentId,
				file_id: fileId,
			});

			if (!downloadResult.success || !downloadResult.data) {
				throw new Error('Failed to get download link');
			}

			streamUrl = downloadResult.data;

			// Parse season/episode from filename if TV
			if (mediaType === 'tv' || mediaType === 'series') {
				const filename = file.name || file.short_name || '';
				const info = ptt.parse(filename.split('/').pop() || '');
				seasonNumber = info.season ?? -1;
				episodeNumber = info.episode ?? -1;
			}

			fileSize = Math.round((file.size || 0) / 1024 / 1024);
		} catch (e) {
			// Clean up on error
			await deleteTorrent(apiKey, torrentId);
			throw e;
		}
	} catch (e) {
		throw e;
	}

	return [streamUrl, seasonNumber, episodeNumber, fileSize, torrentId, fileId];
};

// Get stream URL for a file matching the given filename
export const getFileByNameTorBoxStreamUrl = async (
	apiKey: string,
	hash: string,
	targetFilename: string
): Promise<[string, number, number, number, string]> => {
	let streamUrl = '';
	let fileSize = 0;
	let torrentId = 0;
	let fileId = 0;
	let filename = '';

	try {
		// First check if the torrent is cached
		const cachedStatus = await checkCachedStatus({ hash, list_files: true }, apiKey);
		if (!cachedStatus.success || !cachedStatus.data) {
			throw new Error('Failed to check cached status');
		}

		const cachedData = cachedStatus.data as Record<string, any>;
		if (!cachedData[hash]) {
			throw new Error('Torrent not cached on TorBox');
		}

		// Add the torrent
		const createResult = await createTorrent(apiKey, {
			magnet: `magnet:?xt=urn:btih:${hash}`,
		});

		if (
			!createResult.success ||
			!createResult.data ||
			createResult.data.torrent_id === undefined
		) {
			throw new Error('Failed to add torrent to TorBox');
		}

		torrentId = createResult.data.torrent_id;

		try {
			// Wait for torrent to be ready
			const torrent = await waitForTorrentReady(apiKey, torrentId);
			if (!torrent) {
				throw new Error('Torrent did not become ready in time');
			}

			// Find file matching the target filename
			if (!torrent.files || torrent.files.length === 0) {
				throw new Error('No files in torrent');
			}

			// Try exact match first, then partial match on the filename part
			let matchedFile = torrent.files.find((f) => {
				const name = f.name || f.short_name || '';
				const shortName = name.split('/').pop() || name;
				return shortName === targetFilename || name === targetFilename;
			});

			// If no exact match, try case-insensitive
			if (!matchedFile) {
				const lowerTarget = targetFilename.toLowerCase();
				matchedFile = torrent.files.find((f) => {
					const name = f.name || f.short_name || '';
					const shortName = name.split('/').pop() || name;
					return (
						shortName.toLowerCase() === lowerTarget ||
						name.toLowerCase() === lowerTarget
					);
				});
			}

			if (!matchedFile) {
				throw new Error(`File "${targetFilename}" not found in torrent`);
			}

			fileId = matchedFile.id;
			filename = matchedFile.name || matchedFile.short_name || '';

			// Get download link
			const downloadResult = await requestDownloadLink(apiKey, {
				torrent_id: torrentId,
				file_id: fileId,
			});

			if (!downloadResult.success || !downloadResult.data) {
				throw new Error('Failed to get download link');
			}

			streamUrl = downloadResult.data;
			fileSize = Math.round((matchedFile.size || 0) / 1024 / 1024);
		} catch (e) {
			// Clean up on error
			await deleteTorrent(apiKey, torrentId);
			throw e;
		}
	} catch (e) {
		throw e;
	}

	return [streamUrl, fileSize, torrentId, fileId, filename];
};

export const getBiggestFileTorBoxStreamUrl = async (
	apiKey: string,
	hash: string
): Promise<[string, number, number, number, string]> => {
	let streamUrl = '';
	let fileSize = 0;
	let torrentId = 0;
	let fileId = 0;
	let filename = '';

	try {
		// First check if the torrent is cached
		const cachedStatus = await checkCachedStatus({ hash, list_files: true }, apiKey);
		if (!cachedStatus.success || !cachedStatus.data) {
			throw new Error('Failed to check cached status');
		}

		const cachedData = cachedStatus.data as Record<string, any>;
		if (!cachedData[hash]) {
			throw new Error('Torrent not cached on TorBox');
		}

		// Add the torrent
		const createResult = await createTorrent(apiKey, {
			magnet: `magnet:?xt=urn:btih:${hash}`,
		});

		if (
			!createResult.success ||
			!createResult.data ||
			createResult.data.torrent_id === undefined
		) {
			throw new Error('Failed to add torrent to TorBox');
		}

		torrentId = createResult.data.torrent_id;

		try {
			// Wait for torrent to be ready
			const torrent = await waitForTorrentReady(apiKey, torrentId);
			if (!torrent) {
				throw new Error('Torrent did not become ready in time');
			}

			// Find the biggest file
			if (!torrent.files || torrent.files.length === 0) {
				throw new Error('No files in torrent');
			}

			const biggestFile = torrent.files.reduce((prev, current) => {
				return (prev.size || 0) > (current.size || 0) ? prev : current;
			});

			fileId = biggestFile.id;
			filename = biggestFile.name || biggestFile.short_name || '';

			// Get download link
			const downloadResult = await requestDownloadLink(apiKey, {
				torrent_id: torrentId,
				file_id: fileId,
			});

			if (!downloadResult.success || !downloadResult.data) {
				throw new Error('Failed to get download link');
			}

			streamUrl = downloadResult.data;
			fileSize = Math.round((biggestFile.size || 0) / 1024 / 1024);
		} catch (e) {
			// Clean up on error
			await deleteTorrent(apiKey, torrentId);
			throw e;
		}
	} catch (e) {
		throw e;
	}

	return [streamUrl, fileSize, torrentId, fileId, filename];
};

// Get stream URL for a specific file without deleting the torrent
// This is useful when casting multiple files from the same torrent
export const getTorBoxStreamUrlKeepTorrent = async (
	apiKey: string,
	hash: string,
	fileId: number,
	mediaType: string
): Promise<[string, number, number, number, number, number, string]> => {
	let streamUrl = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
	let fileSize = 0;
	let torrentId = 0;
	let filename = '';

	try {
		// First check if the torrent is cached
		const cachedStatus = await checkCachedStatus({ hash, list_files: true }, apiKey);
		if (!cachedStatus.success || !cachedStatus.data) {
			throw new Error('Failed to check cached status');
		}

		const cachedData = cachedStatus.data as Record<string, any>;
		if (!cachedData[hash]) {
			throw new Error('Torrent not cached on TorBox');
		}

		// Add the torrent
		const createResult = await createTorrent(apiKey, {
			magnet: `magnet:?xt=urn:btih:${hash}`,
		});

		if (
			!createResult.success ||
			!createResult.data ||
			createResult.data.torrent_id === undefined
		) {
			throw new Error('Failed to add torrent to TorBox');
		}

		torrentId = createResult.data.torrent_id;

		// Wait for torrent to be ready
		const torrent = await waitForTorrentReady(apiKey, torrentId);
		if (!torrent) {
			throw new Error('Torrent did not become ready in time');
		}

		// Find the file
		const file = torrent.files?.find((f) => f.id === fileId);
		if (!file) {
			throw new Error(`File with ID ${fileId} not found in torrent`);
		}

		filename = file.name || file.short_name || '';

		// Get download link
		const downloadResult = await requestDownloadLink(apiKey, {
			torrent_id: torrentId,
			file_id: fileId,
		});

		if (!downloadResult.success || !downloadResult.data) {
			throw new Error('Failed to get download link');
		}

		streamUrl = downloadResult.data;

		// Parse season/episode from filename if TV
		if (mediaType === 'tv' || mediaType === 'series') {
			const info = ptt.parse(filename.split('/').pop() || '');
			seasonNumber = info.season ?? -1;
			episodeNumber = info.episode ?? -1;
		}

		fileSize = Math.round((file.size || 0) / 1024 / 1024);
	} catch (e) {
		throw e;
	}

	return [streamUrl, seasonNumber, episodeNumber, fileSize, torrentId, fileId, filename];
};
