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
	uploadTorrentFile,
} from '@/services/allDebrid';
import {
	addSeedboxTorrent,
	addSeedboxTorrentFile,
	DebridLinkError,
	isDlFinished,
} from '@/services/debridLink';
import {
	addOffcloudCloud,
	addOffcloudTorrentFile,
	isValidBtih,
	OffcloudError,
} from '@/services/offcloud';
import {
	createPremiumizeTransfer,
	listPremiumizeFolder,
	listPremiumizeTransfers,
	PremiumizeError,
	uploadPremiumizeTorrentFile,
} from '@/services/premiumize';
import {
	addHashAsMagnet,
	addTorrentFile,
	getTorrentInfo,
	isRdThrottling,
	RD_ADD_MIN_SPACING_MS,
	rdAddPauseRemainingMs,
	recordRdAddPause,
	recordRdRateLimit,
	selectFiles,
} from '@/services/realDebrid';
import {
	controlTorrent,
	createTorrent,
	createWebDownload,
	getTorrentList,
	getWebDownloadList,
	TorBoxRateLimitError,
} from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxWebDownload, TorrentInfoResponse } from '@/services/types';
import { UserTorrent } from '@/torrent/userTorrent';
import { delay } from '@/utils/delay';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { isRdBlockedName } from './deInfringe';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { extractTorrentInputs, toMagnetUri } from './extractHashes';
import {
	buildPremiumizeRowSources,
	convertToDlUserTorrent,
	convertToOffcloudUserTorrent,
	convertToPremiumizeUserTorrent,
	convertToTbUserTorrent,
	convertToTbWebDownloadUserTorrent,
} from './fetchTorrents';
import {
	isRdAddRefusal,
	RD_ADD_INTERACTIVE_HOLDS_MS,
	RD_ADD_PAUSE_MS,
	RdAddPausedError,
	rdAddPauseRetryMessage,
	rdAddRefusedMessage,
	rdAddWaitMessage,
	retryRdAddThroughPause,
	type RdPauseRetryOptions,
} from './rdAddPause';
import { isVideo } from './selectable';
import { magnetToastOptions } from './toastOptions';
import { isWebDownloadRowId, parseTorBoxRowId } from './torboxWebDownload';

// Extract error message from API response based on service type
// RD: { error: "message" } or { error: "code", error_code: 34|35 }
// AD: { error: { code: "...", message: "..." } }
// TB: { detail: "message" } or { error: "message" }
const getRdError = (error: unknown, rdKey: string): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		if (data?.error_code === 34) {
			recordRdRateLimit(rdKey);
		}
		return data?.error || null;
	}
	return null;
};

/** Tells a user watching an RD add that it will be tried again after the pause. */
export const announceRdPauseRetry = (holdMs: number = RD_ADD_PAUSE_MS) =>
	toast(rdAddPauseRetryMessage(holdMs), { ...magnetToastOptions, duration: holdMs });

/**
 * Retries for an RD add one user is watching: hold the account's adds and try
 * again for up to five minutes (`RD_ADD_INTERACTIVE_HOLDS_MS`), saying each
 * time how long the wait is. Holding the account, not just this add, keeps the
 * user's other clicks from being refused for nothing in the meantime.
 */
export const interactiveRdPauseRetries = (rdKey: string): RdPauseRetryOptions => ({
	holdsMs: RD_ADD_INTERACTIVE_HOLDS_MS,
	onPause: (holdMs) => {
		recordRdAddPause(rdKey, holdMs);
		announceRdPauseRetry(holdMs);
	},
});

/**
 * The refusal after a user waited through every hold is long and arrives
 * minutes after the click, when they may have looked away; the 4 s an error
 * toast gets by default is not enough to read it.
 */
const rdAddRefusedToastOptions = { ...magnetToastOptions, duration: 15_000 };

/** One retry after 30 s, for a run of adds that reports its own progress. */
const bulkRdPauseRetries: RdPauseRetryOptions = { onPause: announceRdPauseRetry };

const getTbError = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		return data?.detail || data?.error || null;
	}
	return null;
};

const retryDelay = process.env.VITEST_WORKER_ID ? 0 : 5000;
const infoRetryDelay = process.env.VITEST_WORKER_ID ? 0 : 2000;
const MAX_509_RETRIES = 5;
// Pacing for batch addMagnet. Not the published 250/min: `addMagnet` has its
// own budget of roughly 30 a minute per account (see `RD_ADDS_PER_MINUTE`), and
// 500ms between hashes was four times that, so a batch spent the user's whole
// allowance in the first fifteen seconds and then failed the rest of the run.
const BATCH_MAGNET_DELAY = process.env.VITEST_WORKER_ID ? 0 : RD_ADD_MIN_SPACING_MS;
const TB_BATCH_MAGNET_DELAY = process.env.VITEST_WORKER_ID ? 0 : 1000;
// A 451 the name does not explain is tried again after each of the
// account's holds (`RD_ADD_INTERACTIVE_HOLDS_MS`) — see `rdAddPause.ts` for
// the measurements.
const MAX_PAUSE_RETRIES = RD_ADD_INTERACTIVE_HOLDS_MS.length;

/**
 * - `infringing_file`: RD refused a release whose name it blocks.
 * - `paused`: RD answered 451 to a name it is not known to block, and the
 *   retry (interactive adds only) was refused too. Usually the account, not
 *   the release; never a verdict on the release.
 */
export type RdAddResult = 'success' | 'infringing_file' | 'paused' | 'error';

export const handleAddAsMagnetInRd = async (
	rdKey: string,
	hash: string,
	callback?: (info: TorrentInfoResponse) => Promise<void>,
	deleteIfNotInstant: boolean = false,
	retryCount: number = 0,
	silent: boolean = false,
	/** Row title, when the caller knows it — the only way to read a 451. */
	title: string = '',
	pauseRetryCount: number = 0,
	/**
	 * The torrent's own filenames, when the caller knows them. RD blocks on the
	 * paths inside the torrent as well as its name, and a display title can have
	 * lost the dots the block keys on — see `isRdBlockedName`.
	 */
	filenames: readonly string[] = []
): Promise<RdAddResult> => {
	// A name RD blocks is refused every time, so its 451 is about the release
	// and must not hold the account's other adds.
	const nameIsBlocked = isRdBlockedName(title, filenames);
	try {
		if (!silent && pauseRetryCount === 0) {
			// Another add on this account ran into a pause; this one waits it out
			// inside `addHashAsMagnet` rather than being refused for nothing.
			const waitMs = rdAddPauseRemainingMs(rdKey);
			if (waitMs > 0) {
				toast(rdAddWaitMessage(waitMs), { ...magnetToastOptions, duration: waitMs });
			}
		}
		const id = await addHashAsMagnet(rdKey, hash, false, { nameIsBlocked });
		await handleSelectFilesInRd(rdKey, `rd:${id}`);
		let response = await getTorrentInfo(rdKey, id);
		if (response.status !== 'downloaded') {
			for (let i = 0; i < 3; i++) {
				await delay(infoRetryDelay);
				response = await getTorrentInfo(rdKey, id);
				if (response.status === 'downloaded') break;
			}
		}
		if (response.status === 'downloaded') {
			if (!silent) toast.success('Torrent added.', magnetToastOptions);
			if (callback) await callback(response);
		} else if (deleteIfNotInstant) {
			await handleDeleteRdTorrent(rdKey, `rd:${id}`, true);
			if (!silent) toast.error(`Torrent not instant; removed.`, magnetToastOptions);
		} else {
			if (!silent)
				toast.error(`Torrent added with status ${response.status}.`, magnetToastOptions);
			if (callback) await callback(response);
		}
		return 'success';
	} catch (error: unknown) {
		if (error instanceof AxiosError && error.response?.status === 509) {
			if (retryCount >= MAX_509_RETRIES) {
				if (!silent)
					toast.error(
						'RD slots full. Please free up a slot and try again.',
						magnetToastOptions
					);
				return 'error';
			}
			if (!silent)
				toast.error(
					`RD slots full. Retrying in 5s... (${retryCount + 1}/${MAX_509_RETRIES})`,
					{ ...magnetToastOptions, duration: 5000 }
				);
			await delay(retryDelay);
			return handleAddAsMagnetInRd(
				rdKey,
				hash,
				callback,
				deleteIfNotInstant,
				retryCount + 1,
				silent,
				title,
				pauseRetryCount,
				filenames
			);
		}
		const rdError = getRdError(error, rdKey);
		console.error(
			'Error adding hash:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		// A 451 on a name RD does not block is, far more often than not, RD
		// refusing every add on the account for a while rather than refusing this
		// release. Measured 2026-10-04/05 on a test account: during such a pause
		// Big Buck Bunny and hashes the account had accepted minutes earlier were
		// refused too; it lasted 21 s to about five minutes; and E.T., refused
		// twice that evening, was accepted at 01:00:23. Nothing this session sees
		// predicts one either: it came after 2 to 9 adds of hashes new to the
		// account, and adds from zurg or another app on the same key count too.
		// This replaces the 2026-09-17 reading that, away from a burst, a 451 is a
		// refusal: those "37 of 48 refused" were sequential adds 30 s apart, the
		// very shape that trips a pause.
		//
		// `addHashAsMagnet` has already put the account on pause, so every other
		// add on it waits instead of being refused too. A user watching gets
		// another try after each longer hold, five minutes in all, since one try
		// after 30 s missed most measured pauses; a silent caller (an availability
		// check, a bulk run reporting its own progress) gets the answer at once
		// and decides for itself.
		if (isRdAddRefusal(error) && !nameIsBlocked) {
			if (!silent && pauseRetryCount < MAX_PAUSE_RETRIES) {
				const holdMs = RD_ADD_INTERACTIVE_HOLDS_MS[pauseRetryCount];
				recordRdAddPause(rdKey, holdMs);
				announceRdPauseRetry(holdMs);
				return handleAddAsMagnetInRd(
					rdKey,
					hash,
					callback,
					deleteIfNotInstant,
					retryCount,
					silent,
					title,
					pauseRetryCount + 1,
					filenames
				);
			}
			// Refused on every try for five minutes, the longest pause measured,
			// and still not a verdict: tell the user what it most likely is and
			// what to try.
			if (!silent)
				toast.error(
					rdAddRefusedMessage(
						RD_ADD_INTERACTIVE_HOLDS_MS.reduce((sum, ms) => sum + ms, 0)
					),
					rdAddRefusedToastOptions
				);
			return 'paused';
		}
		if (!silent)
			toast.error(
				rdError ? `RD error: ${rdError}` : 'Failed to add hash.',
				magnetToastOptions
			);
		if (rdError === 'infringing_file' && !isRdThrottling(rdKey)) return 'infringing_file';
		return 'error';
	}
};

export const handleAddTorrentFileInRd = async (
	rdKey: string,
	file: File,
	callback?: (info: TorrentInfoResponse) => Promise<void>,
	retryCount: number = 0
) => {
	try {
		// The torrent's own name is not read here, so every 451 gets the second
		// try a paused account is owed.
		const id = await retryRdAddThroughPause(
			() => addTorrentFile(rdKey, file),
			interactiveRdPauseRetries(rdKey)
		);
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
		if (error instanceof RdAddPausedError) {
			toast.error(error.message, rdAddRefusedToastOptions);
			return;
		}
		const rdError = getRdError(error, rdKey);
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

/** Why a bulk RD add failed, in the words the toast uses. */
const describeRdBulkAddError = (error: unknown, fallback: string): string => {
	if (error instanceof RdAddPausedError) return error.message;
	const rdError = error instanceof AxiosError ? error.response?.data?.error : null;
	return rdError ? `RD error: ${rdError}` : fallback;
};

export const handleAddMultipleTorrentFilesInRd = async (
	rdKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let errorCount = 0;
	for (let i = 0; i < files.length; i++) {
		if (i > 0) await delay(BATCH_MAGNET_DELAY);
		try {
			// A 451 holds the rest of the batch (inside `addTorrentFile`) and
			// earns this file one more try once the pause is over.
			const id = await retryRdAddThroughPause(
				() => addTorrentFile(rdKey, files[i]),
				bulkRdPauseRetries
			);
			await handleSelectFilesInRd(rdKey, `rd:${id}`);
		} catch (error) {
			errorCount++;
			console.error(
				'Error adding torrent file:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			toast.error(describeRdBulkAddError(error, 'Failed to add torrent file.'));
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
	for (let i = 0; i < hashes.length; i++) {
		if (i > 0) await delay(BATCH_MAGNET_DELAY);
		try {
			// A 451 holds the rest of the batch (inside `addHashAsMagnet`) and
			// earns this hash one more try once the pause is over.
			const id = await retryRdAddThroughPause(
				() => addHashAsMagnet(rdKey, hashes[i]),
				bulkRdPauseRetries
			);
			await handleSelectFilesInRd(rdKey, `rd:${id}`);
		} catch (error) {
			errorCount++;
			console.error(
				'Error adding hash:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			toast.error(describeRdBulkAddError(error, 'Failed to add hash.'));
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

		// The hash is already in the account, so a 451 here is the account's
		// pause far more often than a verdict: try again through it.
		const newId = await retryRdAddThroughPause(
			() => addHashAsMagnet(rdKey, torrent.hash),
			interactiveRdPauseRetries(rdKey)
		);
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
	keepInLibrary: boolean = false,
	silent: boolean = false
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
				if (!silent) {
					if (deleteIfNotInstant) {
						toast.error('Torrent not available (no peers).', magnetToastOptions);
					} else {
						toast.error('Torrent not cached in AllDebrid.', magnetToastOptions);
					}
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
				if (!silent) toast.error('Torrent not instant; removed.', magnetToastOptions);
				if (callback) await callback(null);
				return;
			}

			// User wants to download - keep magnet in AD for peer downloading
			if (!silent)
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
			}
		}

		// Step 4: Call callback with status data (for storage/processing)
		if (callback) {
			await callback(magnetStatus);
		}

		// Step 5: Delete from AllDebrid after storing availability data (only for service checks)
		if (!keepInLibrary) {
			try {
				await delay(1000);
				await deleteMagnetAd(adKey, upload.id);
			} catch (deleteError) {
				console.warn('Failed to delete magnet from AllDebrid (non-fatal):', deleteError);
			}
		}

		if (!silent) {
			if (keepInLibrary) {
				toast.success('Torrent added to library.', magnetToastOptions);
			} else {
				toast.success('Torrent cached and available.', magnetToastOptions);
			}
		}
	} catch (error) {
		console.error(
			'Error adding hash to AllDebrid:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!silent) toast.error('Failed to add hash. Try again.');
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

export const handleAddMultipleTorrentFilesInAd = async (
	adKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (const file of files) {
		try {
			await uploadTorrentFile(adKey, file);
			success++;
		} catch (error) {
			console.error(
				'Error uploading torrent file to AllDebrid:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(
		`Added ${success} torrent file${success === 1 ? '' : 's'} to AllDebrid.`,
		magnetToastOptions
	);
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
	// Reannounce is a swarm operation; a web download has no swarm to rejoin.
	if (isWebDownloadRowId(id)) {
		toast('Web downloads cannot be reannounced.', magnetToastOptions);
		return;
	}
	try {
		await controlTorrent(tbKey, {
			torrent_id: parseTorBoxRowId(id),
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
	callback?: (torrent: UserTorrent) => Promise<void>,
	/** Suppress the per-add toasts; a bulk caller reports its own progress. */
	silent: boolean = false
) => {
	try {
		// TorBox requires a full magnet URI, not a bare info hash
		const magnet = /^magnet:/i.test(hash) ? hash : `magnet:?xt=urn:btih:${hash}`;
		const response = await createTorrent(tbKey, {
			magnet,
		});
		if (response.data?.torrent_id || response.data?.queued_id) {
			const torrentInfo = await getTorrentList(tbKey, { id: response.data.torrent_id });
			const info = torrentInfo.data as TorBoxTorrentInfo;
			const userTorrent = convertToTbUserTorrent(info);
			if (callback) await callback(userTorrent);
			if (!silent) toast.success('Torrent added.', magnetToastOptions);
		} else if (!silent) {
			toast.error('Torrent added without an ID.', magnetToastOptions);
		}
	} catch (error: any) {
		console.error(
			'Error adding torrent:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!silent) {
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
		}
		throw error;
	}
};

export const handleAddMultipleHashesInTb = async (
	tbKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	let errorCount = 0;
	let rateLimited = false;
	for (let i = 0; i < hashes.length; i++) {
		if (i > 0) await delay(TB_BATCH_MAGNET_DELAY);
		try {
			await handleAddAsMagnetInTb(tbKey, hashes[i]);
			success++;
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
		if (success > 0) {
			toast(
				`Added ${success} hash${success === 1 ? '' : 'es'} before rate limit.`,
				magnetToastOptions
			);
		}
	} else {
		toast(
			`Added ${success} ${success === 1 ? 'hash' : 'hashes'} to TorBox.`,
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
	for (let i = 0; i < files.length; i++) {
		if (i > 0) await delay(TB_BATCH_MAGNET_DELAY);
		try {
			const resp = await createTorrent(tbKey, { file: files[i] });
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

// Direct/hoster links TorBox downloads on the user's behalf — the way to get
// media into the library when it was never released as a torrent.
export const handleAddWebDownloadInTb = async (
	tbKey: string,
	link: string,
	callback?: (torrent: UserTorrent) => Promise<void>
) => {
	try {
		const response = await createWebDownload(tbKey, { link });
		const id = response.data?.webdownload_id ?? response.data?.queued_id;
		if (!id) {
			toast.error('Web download added without an ID.', magnetToastOptions);
			return;
		}
		if (callback) {
			const listResp = await getWebDownloadList(tbKey, { id });
			const info = (
				Array.isArray(listResp.data) ? listResp.data[0] : listResp.data
			) as TorBoxWebDownload;
			if (info) await callback(convertToTbWebDownloadUserTorrent(info));
		}
		toast.success('Web download added.', magnetToastOptions);
	} catch (error) {
		console.error(
			'Error adding web download:',
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
				tbError ? `TorBox error: ${tbError}` : 'Failed to add web download.',
				magnetToastOptions
			);
		}
		throw error;
	}
};

export const handleAddMultipleWebDownloadsInTb = async (
	tbKey: string,
	links: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	let rateLimited = false;
	for (let i = 0; i < links.length; i++) {
		if (i > 0) await delay(TB_BATCH_MAGNET_DELAY);
		try {
			await handleAddWebDownloadInTb(tbKey, links[i]);
			success++;
		} catch (error) {
			if (error instanceof TorBoxRateLimitError) {
				rateLimited = true;
				break; // Stop processing if rate limited
			}
		}
	}
	if (callback) await callback();
	if (rateLimited) {
		if (success > 0) {
			toast(
				`Added ${success} web download${success === 1 ? '' : 's'} before rate limit.`,
				magnetToastOptions
			);
		}
	} else {
		toast(
			`Added ${success} web download${success === 1 ? '' : 's'} to TorBox.`,
			magnetToastOptions
		);
	}
};

const PM_BATCH_MAGNET_DELAY = process.env.VITEST_WORKER_ID ? 0 : 250;

/**
 * Adds a magnet to Premiumize's cloud.
 *
 * Cached content finishes immediately - there is no queue wait - so the transfer
 * is read back straight away to build the library row. Re-adding a hash that is
 * already in the transfer list returns the existing id and creates nothing,
 * which is where Premiumize differs from Real-Debrid: no duplicate to clean up.
 */
export const handleAddAsMagnetInPm = async (
	pmKey: string,
	hash: string,
	callback?: (torrent: UserTorrent) => Promise<void>,
	silent: boolean = false
) => {
	const sourceHash = extractTorrentInputs(hash)[0]?.hash ?? hash.toLowerCase();
	try {
		const created = await createPremiumizeTransfer(pmKey, toMagnetUri(hash));
		if (!created.id) {
			if (!silent) toast.error('Transfer added without an ID.', magnetToastOptions);
			return;
		}

		if (callback) {
			const [transfers, root] = await Promise.all([
				listPremiumizeTransfers(pmKey),
				listPremiumizeFolder(pmKey),
			]);
			const transfer = transfers.find((t) => t.id === created.id);
			if (transfer) {
				// Files come from the transfer's own folder rather than
				// `item/listall`, which would pull the whole account back for one
				// add.
				const folder = transfer.folder_id
					? await listPremiumizeFolder(pmKey, transfer.folder_id).catch(() => null)
					: null;
				const files = (folder?.content ?? [])
					.filter((entry) => entry.type === 'file')
					.map((entry) => ({
						id: entry.id,
						name: entry.name,
						created_at: entry.created_at ?? 0,
						size: entry.size ?? 0,
						path: `${transfer.name}/${entry.name}`,
					}));
				const [source] = buildPremiumizeRowSources([transfer], root.content ?? [], files);
				await callback(convertToPremiumizeUserTorrent(source, sourceHash));
			}
		}

		if (!silent) toast.success('Transfer added.', magnetToastOptions);
	} catch (error) {
		console.error(
			'Error adding transfer to Premiumize:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!silent) {
			const message = error instanceof PremiumizeError ? error.message : null;
			toast.error(
				message ? `Premiumize error: ${message}` : 'Failed to add transfer.',
				magnetToastOptions
			);
		}
		throw error;
	}
};

export const handleAddMultipleHashesInPm = async (
	pmKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < hashes.length; i++) {
		if (i > 0) await delay(PM_BATCH_MAGNET_DELAY);
		try {
			await handleAddAsMagnetInPm(pmKey, hashes[i], undefined, true);
			success++;
		} catch (error) {
			console.error(
				'Error adding hash in Premiumize:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(
		`Added ${success} ${success === 1 ? 'hash' : 'hashes'} to Premiumize.`,
		magnetToastOptions
	);
};

export const handleAddMultipleTorrentFilesInPm = async (
	pmKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < files.length; i++) {
		if (i > 0) await delay(PM_BATCH_MAGNET_DELAY);
		try {
			await uploadPremiumizeTorrentFile(pmKey, files[i]);
			success++;
		} catch (error) {
			console.error(
				'Error uploading torrent file to Premiumize:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(
		`Added ${success} torrent file${success === 1 ? '' : 's'} to Premiumize.`,
		magnetToastOptions
	);
};

const OC_BATCH_MAGNET_DELAY = process.env.VITEST_WORKER_ID ? 0 : 250;

/**
 * Adds a magnet to Offcloud's cloud.
 *
 * Two measured behaviours shape this (`docs/providers/offcloud.md`):
 *
 *  - **A garbage magnet is accepted.** `magnet:?xt=urn:btih:zzzz` comes back
 *    `200` with a requestId and then sits in `created` / "Loading..."
 *    indefinitely - nothing upstream ever refuses it and nothing ever finishes
 *    it. `isValidBtih` is checked here so the user gets a sentence rather than a
 *    zombie row they then have to remove.
 *  - **A cached magnet finishes inside the add response**, `status:
 *    "downloaded"` synchronously, Premiumize-style. So the toast can tell the
 *    user whether they can play it now or have to wait, without a poll.
 *
 * Idempotent while the item lives: re-submitting the same magnet returns the
 * same `requestId` and creates nothing, so a double click is harmless. After a
 * removal the same magnet gets a new id.
 */
export const handleAddAsMagnetInOc = async (
	ocKey: string,
	hash: string,
	callback?: (torrent: UserTorrent) => Promise<void>,
	silent: boolean = false
) => {
	const sourceHash = extractTorrentInputs(hash)[0]?.hash ?? null;
	if (!sourceHash || !isValidBtih(sourceHash)) {
		// Refused before the request, not after: Offcloud would take it.
		if (!silent) toast.error('That is not a valid info hash.', magnetToastOptions);
		throw new OffcloudError(`"${hash}" is not a valid info hash.`, 'invalid_info_hash');
	}

	try {
		// Always the full magnet form. `/cloud` accepts a bare hash from us only
		// because we build the magnet here; its `/cache/info` sibling silently
		// reports cached content as uncached when handed a bare hash, so the
		// magnet form is the house rule for every Offcloud call that takes a url.
		const added = await addOffcloudCloud(ocKey, toMagnetUri(hash));
		if (!added.requestId) {
			if (!silent) toast.error('Offcloud added it without an ID.', magnetToastOptions);
			return;
		}

		// The hash is known here - it is what was just submitted - so the row is
		// built with it rather than re-derived from Offcloud's rewritten
		// `originalLink`.
		if (callback) await callback(convertToOffcloudUserTorrent(added, sourceHash.toLowerCase()));

		if (!silent) {
			toast.success(
				added.status === 'downloaded'
					? 'Cached on Offcloud — ready to play.'
					: 'Added to Offcloud — downloading.',
				magnetToastOptions
			);
		}
	} catch (error) {
		console.error(
			'Error adding magnet to Offcloud:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!silent) {
			const message = error instanceof OffcloudError ? error.message : null;
			toast.error(
				message ? `Offcloud error: ${message}` : 'Failed to add to Offcloud.',
				magnetToastOptions
			);
		}
		throw error;
	}
};

export const handleAddMultipleHashesInOc = async (
	ocKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < hashes.length; i++) {
		if (i > 0) await delay(OC_BATCH_MAGNET_DELAY);
		try {
			await handleAddAsMagnetInOc(ocKey, hashes[i], undefined, true);
			success++;
		} catch (error) {
			console.error(
				'Error adding hash in Offcloud:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(`Added ${success} ${success === 1 ? 'hash' : 'hashes'} to Offcloud.`, magnetToastOptions);
};

export const handleAddMultipleTorrentFilesInOc = async (
	ocKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < files.length; i++) {
		if (i > 0) await delay(OC_BATCH_MAGNET_DELAY);
		try {
			await addOffcloudTorrentFile(ocKey, files[i]);
			success++;
		} catch (error) {
			console.error(
				'Error uploading torrent file to Offcloud:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(
		`Added ${success} torrent file${success === 1 ? '' : 's'} to Offcloud.`,
		magnetToastOptions
	);
};

const DL_BATCH_MAGNET_DELAY = process.env.VITEST_WORKER_ID ? 0 : 250;

/**
 * Debrid-Link's refusals, in the words a user can act on.
 *
 * The vendor publishes a 40-code taxonomy and these are the ones a search-page
 * add can actually hit. Each is a *different* action on the user's part - wait
 * for tomorrow's reset, free an active slot, pick a smaller release - so
 * collapsing them into "failed to add" throws away the only useful part of the
 * answer. The numbers come from `/seedbox/limits` on a premium account
 * (`docs/providers/debrid-link.md` §4).
 */
const DL_ERROR_MESSAGES: Record<string, string> = {
	maxTorrent: 'Daily Debrid-Link torrent quota (50) reached — try again after the daily reset.',
	maxData: "Debrid-Link's daily data quota is used up — try again after the daily reset.",
	torrentTooBig: 'Too big for Debrid-Link — its limit is 1 TiB per torrent.',
	maxTransfer: "Debrid-Link's 20 active transfers are full — wait for one to finish.",
	badTorrentFile: 'Debrid-Link could not read that magnet.',
	// Only a bare-hash add can answer this, which is the hash-list path: a bare
	// hash is accepted only when the content is already cached. The search page
	// sends the full magnet and never sees it.
	notAddTorrent: 'Not cached on Debrid-Link.',
	badToken: 'Debrid-Link sign-in expired — sign in again.',
	serverNotAllowed:
		'Debrid-Link refuses this network — its account gate blocks VPNs and servers.',
};

const dlErrorMessage = (error: unknown): string | null => {
	if (!(error instanceof DebridLinkError)) return null;
	if (error.code === 'floodDetected') {
		// The lockout is an hour long and applies to the endpoint, so telling the
		// user "try again" without a number invites them to spend the hour
		// finding out. The client tracks the remainder locally and answers
		// without a request once it knows.
		const minutes = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 60_000) : 0;
		return minutes > 0
			? `Debrid-Link rate-limited this action — locked for about ${minutes} more minute${minutes === 1 ? '' : 's'}.`
			: 'Debrid-Link rate-limited this action — locked for an hour.';
	}
	return DL_ERROR_MESSAGES[error.code] ?? error.message ?? null;
};

/**
 * Adds a magnet to the user's Debrid-Link seedbox.
 *
 * **The full magnet, never the bare hash.** Debrid-Link accepts both, but a bare
 * hash is only accepted when the content is already cached — that is the whole
 * of its cache probe now that `/seedbox/cached` is disabled. On a search page
 * the button means "add this", so a magnet is what gets sent and an uncached
 * release downloads for real. `handleAddMultipleHashesInDl` is the one place
 * that wants the other behaviour.
 *
 * The response tells the whole story on its own: cached content comes back
 * synchronously complete (`status: 100`, live URLs, ~150 ms), so the toast can
 * say "ready" or "downloading" without a single poll.
 *
 * **A double click is harmless and there is no dedup code on purpose.** The add
 * is idempotent by hash and the torrent id is stable — a duplicate add, a bare
 * hash add and even a re-add after removal all return the same id — so a second
 * click costs one request and changes nothing.
 */
export const handleAddAsMagnetInDl = async (
	dlKey: string,
	hash: string,
	callback?: (torrent: UserTorrent) => Promise<void>,
	silent: boolean = false
) => {
	const sourceHash = extractTorrentInputs(hash)[0]?.hash ?? hash.toLowerCase();
	try {
		const torrent = await addSeedboxTorrent(dlKey, toMagnetUri(hash));
		if (!torrent?.id) {
			if (!silent) toast.error('Debrid-Link added it without an ID.', magnetToastOptions);
			return;
		}

		if (callback) await callback(convertToDlUserTorrent(torrent, sourceHash));

		if (!silent) {
			toast.success(
				// `>=`, never `=== 100`: the lower states are flags that combine,
				// and the vendor's own sample carries `status: 6`.
				isDlFinished(torrent.status)
					? 'Cached on Debrid-Link — ready to play.'
					: 'Added to Debrid-Link — downloading.',
				magnetToastOptions
			);
		}
	} catch (error) {
		console.error(
			'Error adding magnet to Debrid-Link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!silent) {
			const message = dlErrorMessage(error);
			toast.error(message ?? 'Failed to add to Debrid-Link.', magnetToastOptions);
		}
		throw error;
	}
};

/**
 * Adds many hashes to Debrid-Link, **as bare hashes**.
 *
 * This is the one surface where "only land it if it is already cached" is the
 * right semantics. A hash list is hundreds of rows and the account's whole day
 * is 50 torrents, so sending magnets here would let one click start fifty real
 * downloads and exhaust the quota — the search page's per-row button is where a
 * user asks for that, one release at a time and knowingly.
 *
 * A miss answers `notAddTorrent` and costs nothing, so misses are counted into
 * the summary rather than toasted one by one. Two codes stop the sweep instead
 * of being counted: `maxTorrent` means every remaining add would be refused for
 * the rest of the day, and `floodDetected` means Debrid-Link has locked the
 * endpoint for an hour — carrying on either way is spending requests to collect
 * the same refusal.
 */
export const handleAddMultipleHashesInDl = async (
	dlKey: string,
	hashes: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	let notCached = 0;
	let refused = 0;
	let abortedBy: string | null = null;

	for (let i = 0; i < hashes.length; i++) {
		if (i > 0) await delay(DL_BATCH_MAGNET_DELAY);
		try {
			// A bare hash, deliberately - see above. `toMagnetUri` is not used
			// here, and this is the only caller that must not use it.
			const torrent = await addSeedboxTorrent(dlKey, hashes[i].trim());
			if (torrent?.id) success++;
		} catch (error) {
			const code = error instanceof DebridLinkError ? error.code : null;
			if (code === 'notAddTorrent') {
				notCached++;
				continue;
			}
			if (code === 'maxTorrent' || code === 'floodDetected') {
				abortedBy = code;
				break;
			}
			refused++;
			console.error(
				'Error adding hash in Debrid-Link:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}

	if (callback) await callback();

	const parts = [`Added ${success} ${success === 1 ? 'hash' : 'hashes'} to Debrid-Link`];
	if (notCached > 0) parts.push(`${notCached} not cached`);
	if (refused > 0) parts.push(`${refused} refused`);
	toast(`${parts.join(' — ')}.`, magnetToastOptions);

	if (abortedBy) {
		toast.error(
			abortedBy === 'maxTorrent'
				? DL_ERROR_MESSAGES.maxTorrent
				: 'Debrid-Link rate-limited this action — locked for an hour. Stopped early.',
			magnetToastOptions
		);
	}
};

/** Full magnets are intentional downloads; unlike bare hash lists they may consume quota. */
export const handleAddMultipleMagnetsInDl = async (
	dlKey: string,
	magnets: string[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < magnets.length; i++) {
		if (i > 0) await delay(DL_BATCH_MAGNET_DELAY);
		try {
			await handleAddAsMagnetInDl(dlKey, magnets[i], undefined, true);
			success++;
		} catch (error) {
			console.error(
				'Error adding magnet in Debrid-Link:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(`Added ${success} magnet${success === 1 ? '' : 's'} to Debrid-Link.`, magnetToastOptions);
};

export const handleAddMultipleTorrentFilesInDl = async (
	dlKey: string,
	files: File[],
	callback?: () => Promise<void>
) => {
	let success = 0;
	for (let i = 0; i < files.length; i++) {
		if (i > 0) await delay(DL_BATCH_MAGNET_DELAY);
		try {
			await addSeedboxTorrentFile(dlKey, files[i]);
			success++;
		} catch (error) {
			console.error(
				'Error uploading torrent file to Debrid-Link:',
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}
	if (callback) await callback();
	toast(
		`Added ${success} torrent file${success === 1 ? '' : 's'} to Debrid-Link.`,
		magnetToastOptions
	);
};
