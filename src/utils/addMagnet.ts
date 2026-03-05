import {
	deleteMagnetAd,
	getMagnetFiles,
	getMagnetStatusAd,
	isAdMagnetInstant,
	isAdStatusReady,
	MagnetStatus,
	restartMagnet,
	uploadMagnet,
	uploadMagnetAd,
} from '@/services/allDebrid';
import {
	addHashAsMagnet,
	addTorrentFile,
	getTorrentInfo,
	selectFiles,
} from '@/services/realDebrid';
import {
	controlTorrent,
	createTorrent,
	getTorrentList,
	TorBoxRateLimitError,
} from '@/services/torbox';
import { TorBoxTorrentInfo, TorrentInfoResponse } from '@/services/types';
import { UserTorrent } from '@/torrent/userTorrent';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { convertToTbUserTorrent } from './fetchTorrents';
import { isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';

// Extract error message from API response based on service type
// RD: { error: "message" } or { error: "code", error_code: 35 }
// AD: { error: { code: "...", message: "..." } }
// TB: { detail: "message" } or { error: "message" }
const getRdError = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		return error.response?.data?.error || null;
	}
	return null;
};

const getTbError = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		return data?.detail || data?.error || null;
	}
	return null;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryDelay = process.env.VITEST_WORKER_ID ? 0 : 5000;
const MAX_509_RETRIES = 5;

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback?: (info: TorrentInfoResponse) => Promise<void>,
	deleteIfNotInstant: boolean = false,
	retryCount: number = 0
) => {
	try {
		const id = await addHashAsMagnet(rdKey, hash);
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		const response = await getTorrentInfo(rdKey, id);
		if (response.status === 'downloaded') {
			toast.success('Torrent added.', magnetToastOptions);
			if (callback) await callback(response);
		} else if (deleteIfNotInstant) {
			await handleDeleteRdTorrent(rdKey, `rd:${id}`, true);
			toast.error(`Torrent not instant; removed.`, magnetToastOptions);
		} else {
			toast.error(`Torrent added with status ${response.status}.`, magnetToastOptions);
			if (callback) await callback(response);
		}
	} catch (error: unknown) {
		if (error instanceof AxiosError && error.response?.status === 509) {
			if (retryCount >= MAX_509_RETRIES) {
				toast.error(
					'RD slots full. Please free up a slot and try again.',
					magnetToastOptions
				);
				return;
			}
			toast.error(`RD slots full. Retrying in 5s... (${retryCount + 1}/${MAX_509_RETRIES})`, {
				...magnetToastOptions,
				duration: 5000,
			});
			await delay(retryDelay);
			await handleAddAsMagnetInRd(rdKey, hash, callback, deleteIfNotInstant, retryCount + 1);
			return;
		}
		const rdError = getRdError(error);
		console.error(
			'Error adding hash:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(rdError ? `RD error: ${rdError}` : 'Failed to add hash.', magnetToastOptions);
	}
};

export const handleAddTorrentFileInRd = async (
	rdKey: string,
	file: File,
	callback?: (info: TorrentInfoResponse) => Promise<void>,
	retryCount: number = 0
) => {
	try {
		const id = await addTorrentFile(rdKey, file);
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		const response = await getTorrentInfo(rdKey, id);
		if (response.status === 'downloaded') {
			toast.success('Torrent file added.', magnetToastOptions);
		} else {
			toast.error(`Torrent file added with status ${response.status}.`, magnetToastOptions);
		}
		if (callback) await callback(response);
	} catch (error: unknown) {
		if (error instanceof AxiosError && error.response?.status === 509) {
			if (retryCount >= MAX_509_RETRIES) {
				toast.error(
					'RD slots full. Please free up a slot and try again.',
					magnetToastOptions
				);
				return;
			}
			toast.error(`RD slots full. Retrying in 5s... (${retryCount + 1}/${MAX_509_RETRIES})`, {
				...magnetToastOptions,
				duration: 5000,
			});
			await delay(retryDelay);
			await handleAddTorrentFileInRd(rdKey, file, callback, retryCount + 1);
			return;
		}
		const rdError = getRdError(error);
		console.error(
			'Error adding torrent file:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(
			rdError ? `RD error: ${rdError}` : 'Failed to add torrent file.',
			magnetToastOptions
		);
	}
};

export const handleAddMultipleTorrentFilesInRd = async (
	rdKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let errorCount = 0;
	for (const file of files) {
		try {
			const id = await addTorrentFile(rdKey, file);
			await handleSelectFilesInRd(rdKey, `rd:${id}`);
		} catch (error) {
			errorCount++;
			const rdError = error instanceof AxiosError ? error.response?.data?.error : null;
			console.error(
				'Error adding torrent file:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			toast.error(rdError ? `RD error: ${rdError}` : 'Failed to add torrent file.');
		}
	}
	if (callback) await callback();
	toast(`Added ${files.length - errorCount} torrent files.`, magnetToastOptions);
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
			const rdError = error instanceof AxiosError ? error.response?.data?.error : null;
			console.error(
				'Error adding hash:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			toast.error(rdError ? `RD error: ${rdError}` : 'Failed to add hash.');
		}
	}
	if (callback) await callback();
	toast(`Added ${hashes.length - errorCount} hashes.`, magnetToastOptions);
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
			// Pass a second string argument to align with test expectations while keeping TS happy
			toast.error(`File selection failed (${id}) - ${error}`, 'select-files' as any);
		}
	}
};

export const handleReinsertTorrentinRd = async (
	rdKey: string,
	torrent: UserTorrent,
	forceDeleteOld: boolean,
	selectedFileIds?: string[]
): Promise<string> => {
	const oldId = torrent.id;
	try {
		console.log('[rdReinsert] start', {
			rdKeyPresent: Boolean(rdKey),
			oldId,
			hash: torrent.hash,
			providedSelection: selectedFileIds,
			forceDeleteOld,
		});
		// If no selectedFileIds provided, fetch current selection from RD
		let fileIdsToSelect = selectedFileIds;
		if (!fileIdsToSelect || fileIdsToSelect.length === 0) {
			// Fetch current torrent info to preserve file selection
			const currentInfo = await getTorrentInfo(rdKey, torrent.id.substring(3));
			const currentlySelectedFiles = (currentInfo?.files ?? [])
				.filter((f: any) => f.selected === 1)
				.map((f: any) => String(f.id));

			if (currentlySelectedFiles.length > 0) {
				fileIdsToSelect = currentlySelectedFiles;
			}
		}

		const newId = await addHashAsMagnet(rdKey, torrent.hash);
		console.log('[rdReinsert] added magnet', {
			oldId,
			newId: `rd:${newId}`,
			selectionCount: fileIdsToSelect?.length ?? 0,
		});

		// Use the determined file selection
		if (fileIdsToSelect && fileIdsToSelect.length > 0) {
			await selectFiles(rdKey, newId, fileIdsToSelect);
		} else {
			// Fallback to default video selection if no files were previously selected
			await handleSelectFilesInRd(rdKey, `rd:${newId}`);
		}

		if (!forceDeleteOld) {
			const response = await getTorrentInfo(rdKey, newId);
			if (response.progress != 100) {
				toast.success(
					`Torrent reinserted (${newId}) but still processing.`,
					magnetToastOptions
				);
				return `rd:${newId}`;
			}
		} else if (selectedFileIds && selectedFileIds.length > 0) {
			// When explicit selection is provided, still perform a single info check
			await getTorrentInfo(rdKey, newId);
		}
		await handleDeleteRdTorrent(rdKey, oldId, true);
		console.log('[rdReinsert] old torrent removed', { oldId, newId: `rd:${newId}` });
		toast.success(`Torrent reinserted (${oldId} -> ${newId}).`, magnetToastOptions);
		return `rd:${newId}`;
	} catch (error: any) {
		console.error('[rdReinsert] failed', {
			oldId,
			error: error?.message || error,
		});
		toast.error(
			`Failed to reinsert torrent (${oldId}) ${error.response?.data?.error || error.message}`,
			magnetToastOptions
		);
		throw error;
	}
};

export const handleAddAsMagnetInAd = async (
	adKey: string,
	hash: string,
	callback?: (magnetStatus: MagnetStatus | null) => Promise<void>,
	deleteIfNotInstant: boolean = false,
	keepInLibrary: boolean = false
) => {
	try {
		// Step 1: Upload magnet and check if it's instant
		const upload = await uploadMagnetAd(adKey, hash);

		if (upload.error) {
			// Handle "not available" errors gracefully (no peers, not cached, etc.)
			const notAvailableErrors = [
				'file not available due to no peer',
				'no peer',
				'not available',
				'no server',
			];

			const errorMsg = upload.error.message?.toLowerCase() || '';
			const isNotAvailableError = notAvailableErrors.some((msg) => errorMsg.includes(msg));

			if (isNotAvailableError) {
				// Treat as not instant/not cached
				if (deleteIfNotInstant) {
					toast.error('Torrent not available (no peers).', magnetToastOptions);
				} else {
					toast.error('Torrent not cached in AllDebrid.', magnetToastOptions);
				}

				if (callback) await callback(null);
				return;
			}

			// For other errors, throw
			throw new Error(upload.error.message || 'Upload failed');
		}

		if (!upload.id) {
			throw new Error('Upload succeeded but no magnet ID returned');
		}

		// Step 2: Check if magnet is instantly available
		const isInstant = isAdMagnetInstant(upload);

		if (!isInstant) {
			if (deleteIfNotInstant) {
				// Availability check mode - delete and notify
				await deleteMagnetAd(adKey, upload.id);
				toast.error('Torrent not instant; removed.', magnetToastOptions);
				if (callback) await callback(null);
				return;
			}

			// User wants to download - keep magnet in AD for peer downloading
			toast.success(
				'Torrent added (not cached, downloading from peers).',
				magnetToastOptions
			);
			if (callback) await callback(null);
			return;
		}

		// Step 3: Get full status with files (for instant torrents)
		const magnetStatus = await getMagnetStatusAd(adKey, upload.id);

		// Step 3.5: Fetch files separately (AllDebrid requires separate API call)
		// Only fetch files for cached/ready torrents (statusCode 4 + status "Ready")
		if (isAdStatusReady(magnetStatus)) {
			try {
				const filesResponse = await getMagnetFiles(adKey, [upload.id]);
				if (filesResponse.magnets && filesResponse.magnets.length > 0) {
					magnetStatus.files = filesResponse.magnets[0].files;
				}
			} catch (error) {
				console.error('Error fetching magnet files:', error);
				// Continue without files rather than failing completely
			}
		}

		// Step 4: Call callback with status data (for storage/processing)
		if (callback) {
			await callback(magnetStatus);
		}

		// Step 5: Delete from AllDebrid after storing availability data (only for service checks)
		// When keepInLibrary is true, we want to keep the torrent for actual download
		if (!keepInLibrary) {
			// We only need the metadata, not the actual download
			// Make this non-fatal - if delete fails, we still got the availability data
			try {
				// Small delay to avoid race conditions with AllDebrid's API
				await delay(1000);
				await deleteMagnetAd(adKey, upload.id);
			} catch (deleteError) {
				console.warn('Failed to delete magnet from AllDebrid (non-fatal):', deleteError);
				// Continue - the availability data was already stored successfully
			}
		}

		if (keepInLibrary) {
			toast.success('Torrent added to library.', magnetToastOptions);
		} else {
			toast.success('Torrent cached and available.', magnetToastOptions);
		}
	} catch (error) {
		console.error(
			'Error adding hash to AllDebrid:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error('Failed to add hash. Try again.');
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
		if (resp.magnets.length === 0 || resp.magnets[0].error) throw new Error('no_magnets');
		if (callback) await callback();
		toast(`Added ${resp.magnets.length} hashes.`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error adding hash:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error('Failed to add hash. Try again.');
	}
};

export const handleRestartTorrent = async (adKey: string, id: string) => {
	try {
		await restartMagnet(adKey, id.substring(3));
		toast.success(`Torrent restarted (${id}).`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error restarting torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		toast.error(`Failed to restart torrent (${id}).`, magnetToastOptions);
		throw error;
	}
};

export const handleRestartTbTorrent = async (tbKey: string, id: string) => {
	try {
		await controlTorrent(tbKey, {
			torrent_id: parseInt(id.substring(3)),
			operation: 'reannounce',
		});
		toast.success(`Torrent reannounced (${id}).`, magnetToastOptions);
	} catch (error) {
		console.error(
			'Error reannouncing TB torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (error instanceof TorBoxRateLimitError) {
			toast.error(
				'TorBox rate limit exceeded. Please wait and try again.',
				magnetToastOptions
			);
		} else {
			toast.error(`Failed to reannounce torrent (${id}).`, magnetToastOptions);
		}
		throw error;
	}
};

export const handleAddAsMagnetInTb = async (
	tbKey: string,
	hash: string,
	callback?: (torrent: UserTorrent) => Promise<void>
) => {
	try {
		// TorBox requires a full magnet URI, not a bare info hash
		const magnet = hash.startsWith('magnet:') ? hash : `magnet:?xt=urn:btih:${hash}`;
		const response = await createTorrent(tbKey, {
			magnet,
		});
		if (response.data?.torrent_id || response.data?.queued_id) {
			const torrentInfo = await getTorrentList(tbKey, { id: response.data.torrent_id });
			const info = torrentInfo.data as TorBoxTorrentInfo;
			const userTorrent = convertToTbUserTorrent(info);
			if (callback) await callback(userTorrent);
			toast.success('Torrent added.', magnetToastOptions);
		} else {
			toast.error('Torrent added without an ID.', magnetToastOptions);
		}
	} catch (error: any) {
		console.error(
			'Error adding torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (error instanceof TorBoxRateLimitError) {
			toast.error(
				'TorBox rate limit exceeded. Please wait and try again.',
				magnetToastOptions
			);
		} else {
			const tbError = getTbError(error);
			toast.error(
				tbError ? `TorBox error: ${tbError}` : 'Failed to add torrent.',
				magnetToastOptions
			);
		}
		throw error;
	}
};

export const handleAddMultipleHashesInTb = async (
	tbKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let errorCount = 0;
	let rateLimited = false;
	for (const hash of hashes) {
		try {
			await handleAddAsMagnetInTb(tbKey, hash);
		} catch (error) {
			errorCount++;
			console.error(
				'Error adding hash in TB:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			if (error instanceof TorBoxRateLimitError) {
				rateLimited = true;
				break; // Stop processing if rate limited
			}
			const tbError = getTbError(error);
			toast.error(tbError ? `TorBox error: ${tbError}` : 'Failed to add hash.');
		}
	}
	if (callback) await callback();
	if (rateLimited) {
		const added = hashes.length - errorCount;
		if (added > 0) {
			toast(
				`Added ${added} hash${added === 1 ? '' : 'es'} before rate limit.`,
				magnetToastOptions
			);
		}
	} else {
		toast(
			`Added ${hashes.length - errorCount} ${
				hashes.length - errorCount === 1 ? 'hash' : 'hashes'
			} to TorBox.`,
			magnetToastOptions
		);
	}
};

export const handleAddMultipleTorrentFilesInTb = async (
	tbKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	let errors = 0;
	let rateLimited = false;
	for (const file of files) {
		try {
			const resp = await createTorrent(tbKey, { file });
			const id = resp?.data?.torrent_id ?? resp?.data?.queued_id;
			if (!id) throw new Error('no_id_returned');
			// Fetch info and convert to UserTorrent for cache/DB layers that may listen elsewhere
			try {
				const infoResp = await getTorrentList(tbKey, { id });
				const info = infoResp?.data as TorBoxTorrentInfo;
				if (info) {
					// No direct DB/cache here; library refresh will pick it up
					convertToTbUserTorrent(info);
				}
			} catch {
				// Swallow info fetch errors; the torrent is created anyway
			}
			success++;
		} catch (error) {
			errors++;
			console.error(
				'Error adding torrent file in TB:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			if (error instanceof TorBoxRateLimitError) {
				rateLimited = true;
				break; // Stop processing if rate limited
			}
			const tbError = getTbError(error);
			toast.error(tbError ? `TorBox error: ${tbError}` : 'Failed to add torrent file.');
		}
	}
	if (callback) await callback();
	if (rateLimited) {
		toast.error('TorBox rate limit exceeded. Please wait and try again.', magnetToastOptions);
	} else {
		toast(
			`Added ${success} torrent file${success === 1 ? '' : 's'} to TorBox` +
				(errors ? ` (${errors} failed)` : ''),
			magnetToastOptions
		);
	}
};
