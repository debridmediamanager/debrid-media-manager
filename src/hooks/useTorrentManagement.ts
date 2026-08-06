import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddAsMagnetInTb,
} from '@/utils/addMagnet';
import { removeAvailability, submitAvailability, submitAvailabilityAd } from '@/utils/availability';
import {
	createDebridUploaderJob,
	getDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	isDuplicateResponse,
	trackDebridUploaderJob,
	transferContextFromPath,
} from '@/utils/debridUploader';
import {
	handleDeleteAdTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { convertToUserTorrent } from '@/utils/fetchTorrents';
import { generateTokenAndHash } from '@/utils/token';
import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';

import type { MagnetFile } from '@/services/allDebrid';

function flattenMagnetFiles(files: MagnetFile[], parentPath = ''): MagnetFile[] {
	const result: MagnetFile[] = [];
	for (const f of files) {
		const fullPath = parentPath ? `${parentPath}/${f.n}` : f.n;
		if (f.e) {
			result.push(...flattenMagnetFiles(f.e, fullPath));
		} else {
			result.push({ n: fullPath, s: f.s, l: f.l });
		}
	}
	return result;
}

const torrentDB = new UserTorrentDB();

export function useTorrentManagement(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	imdbId: string,
	searchResults: SearchResult[],
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>
) {
	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});
	const { addTorrent: addToCache, removeTorrent: removeFromCache } = useLibraryCache();

	const fetchHashAndProgress = useCallback(async (hash?: string) => {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[`${t.id.substring(0, 3)}${t.hash}`] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}, []);

	const addRd = useCallback(
		async (
			hash: string,
			isCheckingAvailability = false,
			deleteIfNotInstant = false
		): Promise<any> => {
			if (!rdKey) return;

			// Read searchResults at call time via closure - no need for dependency
			const torrentResult = searchResults.find((r) => r.hash === hash);
			const wasMarkedAvailable = torrentResult?.rdAvailable || false;
			let torrentInfo: TorrentInfoResponse | null = null;

			const addResult = await handleAddAsMagnetInRd(
				rdKey,
				hash,
				async (info: TorrentInfoResponse) => {
					torrentInfo = info;
					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();

					// Only handle false positives for actual usage, not service checks
					if (!isCheckingAvailability && wasMarkedAvailable) {
						// Check for false positive conditions
						const isFalsePositive =
							info.status !== 'downloaded' ||
							info.progress !== 100 ||
							info.files?.filter((f) => f.selected === 1).length === 0;

						if (isFalsePositive) {
							// Remove false positive from availability database
							await removeAvailability(
								tokenWithTimestamp,
								tokenHash,
								hash,
								`Status: ${info.status}, Progress: ${info.progress}%, Selected files: ${
									info.files?.filter((f) => f.selected === 1).length || 0
								}`
							);

							// Update UI
							setSearchResults((prev) =>
								prev.map((r) =>
									r.hash === hash ? { ...r, rdAvailable: false } : r
								)
							);

							toast.error('Torrent misflagged as RD available.');
						}
					}

					// Only submit availability for truly available torrents
					if (info.status === 'downloaded' && info.progress === 100) {
						await submitAvailability(tokenWithTimestamp, tokenHash, info, imdbId);
					}

					const userTorrent = convertToUserTorrent(info);
					await torrentDB.add(userTorrent);
					addToCache(userTorrent); // Update global cache

					// Immediately update hashAndProgress state for this torrent
					setHashAndProgress((prev) => ({
						...prev,
						[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]:
							userTorrent.progress,
					}));

					await fetchHashAndProgress(hash);
				},
				deleteIfNotInstant
			);

			// Clean up false positives: when the torrent wasn't instant (deleteIfNotInstant)
			// or when RD rejected it as infringing, remove from availability database.
			const shouldRemoveAvailability =
				addResult !== 'error' &&
				(deleteIfNotInstant || addResult === 'infringing_file') &&
				torrentInfo === null &&
				wasMarkedAvailable;
			if (shouldRemoveAvailability) {
				const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
				await removeAvailability(
					tokenWithTimestamp,
					tokenHash,
					hash,
					addResult === 'infringing_file'
						? 'RD infringing_file'
						: 'Torrent not instant; deleted from RD'
				);
				setSearchResults((prev) =>
					prev.map((r) => (r.hash === hash ? { ...r, rdAvailable: false } : r))
				);
			}

			if (isCheckingAvailability) return torrentInfo;
			// When deleteIfNotInstant, return whether the add succeeded (torrent was instant)
			if (deleteIfNotInstant) return torrentInfo !== null;
			return undefined;
		},
		[rdKey, setSearchResults, imdbId, fetchHashAndProgress, addToCache, searchResults]
	);

	const addAd = useCallback(
		async (hash: string, isCheckingAvailability = false): Promise<any> => {
			if (!adKey) return;

			// Read searchResults at call time via closure
			const torrentResult = searchResults.find((r) => r.hash === hash);
			const wasMarkedAvailable = torrentResult?.adAvailable || false;
			let magnetStatusInfo: any = null;

			console.log('[TorrentManagement] addAd start', { hash, isCheckingAvailability });
			await handleAddAsMagnetInAd(
				adKey,
				hash,
				async (magnetStatus) => {
					magnetStatusInfo = magnetStatus;

					// If magnetStatus is null, the torrent is not instant
					if (!magnetStatus) {
						console.log('[TorrentManagement] addAd not instant', { hash });

						// If it was marked as available, it's a false positive
						if (!isCheckingAvailability && wasMarkedAvailable) {
							setSearchResults((prev) =>
								prev.map((r) =>
									r.hash === hash ? { ...r, adAvailable: false } : r
								)
							);
							toast.error('Torrent misflagged as AD available.');
						}

						return;
					}

					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();

					// Only handle false positives for actual usage, not service checks
					if (!isCheckingAvailability && wasMarkedAvailable) {
						// Check for false positive conditions
						const isFalsePositive =
							magnetStatus.statusCode !== 4 || magnetStatus.status !== 'Ready';

						if (isFalsePositive) {
							// Update UI to remove false positive
							setSearchResults((prev) =>
								prev.map((r) =>
									r.hash === hash ? { ...r, adAvailable: false } : r
								)
							);

							toast.error('Torrent misflagged as AD available.');
						}
					}

					const flatFiles = flattenMagnetFiles(magnetStatus.files || []);

					// Only submit availability for truly cached torrents (statusCode 4 = Ready)
					if (magnetStatus.statusCode === 4 && magnetStatus.status === 'Ready') {
						const validFiles = flatFiles
							.filter((f) => f.n && f.s !== undefined)
							.map((f) => ({
								n: f.n,
								s: f.s!,
								l: f.l || '',
							}));

						// Only submit if we have valid files (name and size required)
						if (validFiles.length > 0) {
							await submitAvailabilityAd(tokenWithTimestamp, tokenHash, {
								hash: hash.toLowerCase(),
								imdbId,
								filename: magnetStatus.filename,
								size: magnetStatus.size,
								status: magnetStatus.status,
								statusCode: magnetStatus.statusCode,
								completionDate: magnetStatus.completionDate || 0,
								files: validFiles,
							});
						} else {
							console.warn(
								'[TorrentManagement] addAd: No valid files found, skipping availability submission',
								{
									hash,
									magnetId: magnetStatus.id,
									filesCount: magnetStatus.files?.length || 0,
								}
							);
						}
					}

					// For actual torrent additions (not service checks), store the torrent immediately
					if (!isCheckingAvailability) {
						// Convert magnet status to UserTorrent and store in database
						const userTorrent: UserTorrent = {
							id: `ad:${magnetStatus.id}`,
							filename: magnetStatus.filename,
							title: magnetStatus.filename,
							hash: hash.toLowerCase(),
							bytes: magnetStatus.size,
							progress: magnetStatus.statusCode === 4 ? 100 : 0,
							status: magnetStatus.status as any,
							serviceStatus: magnetStatus.status,
							added: new Date(magnetStatus.uploadDate || Date.now()),
							mediaType: 'other',
							links: magnetStatus.links?.map((l) => l.link) || [],
							selectedFiles: flatFiles.map((f) => ({
								filename: f.n,
								filesize: f.s || 0,
								link: f.l || '',
							})),
							seeders: magnetStatus.seeders || 0,
							speed: magnetStatus.downloadSpeed || 0,
							adData: magnetStatus,
						};

						await torrentDB.add(userTorrent);
						addToCache(userTorrent);

						// Immediately update hashAndProgress state for this torrent
						setHashAndProgress((prev) => ({
							...prev,
							[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]:
								userTorrent.progress,
						}));

						console.log('[TorrentManagement] addAd: Stored torrent in database', {
							id: userTorrent.id,
							hash: userTorrent.hash,
							progress: userTorrent.progress,
						});
					}
				},
				isCheckingAvailability, // deleteIfNotInstant parameter
				!isCheckingAvailability // keepInLibrary parameter - keep if not checking service
			);

			console.log('[TorrentManagement] addAd end', { hash });
			return isCheckingAvailability ? magnetStatusInfo : undefined;
		},
		[adKey, setSearchResults, imdbId, fetchHashAndProgress, addToCache, searchResults]
	);

	const addTb = useCallback(
		async (hash: string) => {
			if (!torboxKey) return;

			// Read searchResults at call time via closure
			const torrentResult = searchResults.find((r) => r.hash === hash);
			const wasMarkedAvailable = torrentResult?.tbAvailable || false;

			await handleAddAsMagnetInTb(torboxKey, hash, async (userTorrent: UserTorrent) => {
				await torrentDB.add(userTorrent);
				addToCache(userTorrent); // Update global cache

				// Immediately update hashAndProgress state for this torrent
				setHashAndProgress((prev) => ({
					...prev,
					[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]:
						wasMarkedAvailable || userTorrent.status === UserTorrentStatus.finished
							? 100
							: userTorrent.progress,
				}));

				await fetchHashAndProgress();
			});
		},
		[torboxKey, fetchHashAndProgress, addToCache, searchResults]
	);

	// Sends a TorBox-cached torrent into the user's RD account via the debrid
	// uploader service on debrid02, which rewrites the torrent with de-infringed
	// filenames so RD accepts it. The RD torrent therefore has a different info
	// hash than the search result — the original hash is never RD-cached, so
	// neither the row nor the availability DB is marked; the Transfers page is
	// where the job (and the resulting RD library entry) shows up.
	//
	// The loading state resolves as soon as RD's own download is underway
	// ('uploading' in the service's pipeline): from there the transfer no longer
	// needs the browser, so holding a spinner for the whole RD pull is noise.
	const sendTbToRd = useCallback(
		async (hash: string) => {
			if (!rdKey || !torboxKey) return;
			if (!/^tt\d+$/.test(imdbId)) {
				toast.error('TB → RD needs an IMDB id for this title.');
				return;
			}

			const transferContext = transferContextFromPath(window.location.pathname);

			// One job per hash: resubmitting burns a TorBox slot and a full
			// pipeline run for content a previous job already delivered (or is
			// still delivering). Only a failed or vanished job may be retried.
			const previous = getTrackedDebridUploaderJobs().find((j) => j.hash === hash);
			if (previous) {
				let previousStatus: string | undefined;
				try {
					previousStatus = (await getDebridUploaderJob(previous.id, transferContext))
						.status;
				} catch {
					// job unknown to the service (e.g. wiped server-side) — allow a resubmit
				}
				if (previousStatus && previousStatus !== 'failed') {
					toast(
						previousStatus === 'completed'
							? 'TB → RD: already transferred — check your RD library.'
							: 'TB → RD: transfer already in progress — see the Transfers page.'
					);
					return;
				}
			}

			// Size (in bytes) lets the server keep big torrents off weak hosts. The
			// biggest single file is the "remux" signal; sizes on the row are in MB.
			const row = searchResults.find((r) => r.hash === hash);
			const sizeMb = row?.biggestFileSize || row?.fileSize || 0;
			const sizeBytes = sizeMb > 0 ? Math.round(sizeMb * 1024 * 1024) : undefined;

			const toastId = toast.loading('TB → RD: submitting transfer...');
			try {
				const job = await createDebridUploaderJob({
					hash,
					imdbId,
					rdKey,
					tbKey: torboxKey,
					sizeBytes,
				});

				// Cross-user dedup: another user already transferred this content, so
				// no job was created. Mark the row so the button hides, and point at
				// the RD-cached result they should redeem instead.
				if (isDuplicateResponse(job)) {
					setSearchResults((prev) =>
						prev.map((r) => (r.hash === hash ? { ...r, tbTransferred: true } : r))
					);
					toast(
						job.duplicate === 'completed'
							? 'TB → RD: already in RD — use the Instant RD result for this title.'
							: 'TB → RD: a transfer for this is already in progress.',
						{ id: toastId }
					);
					return;
				}

				trackDebridUploaderJob({
					id: job.id,
					hash,
					imdbId,
					title: row?.title,
					returnPath: window.location.pathname,
					createdAt: Date.now(),
				});
				toast.loading('TB → RD: transfer started — track it on the Transfers page.', {
					id: toastId,
				});

				const POLL_MS = 5000;
				const MAX_POLLS = 360; // 30 min for the TorBox half; RD's pull isn't waited on
				for (let i = 0; i < MAX_POLLS; i++) {
					await new Promise((resolve) => setTimeout(resolve, POLL_MS));

					let polled;
					try {
						polled = await getDebridUploaderJob(job.id, transferContext);
					} catch {
						continue; // transient poll failure; the job keeps running server-side
					}

					if (polled.status === 'completed') {
						toast.success(
							'TB → RD: done! The torrent is in your Real-Debrid library.',
							{ id: toastId }
						);
						return;
					}

					if (polled.status === 'failed') {
						toast.error(`TB → RD failed: ${polled.error || 'unknown error'}`, {
							id: toastId,
						});
						return;
					}

					// RD is downloading from the webseed — the hand-off succeeded and
					// the rest happens server-side, so release the button.
					if (polled.status === 'uploading') {
						toast.success(
							'TB → RD: Real-Debrid download underway — follow it on the Transfers page.',
							{ id: toastId }
						);
						return;
					}

					toast.loading(`TB → RD: ${polled.status_message || polled.status}`, {
						id: toastId,
					});
				}

				toast.error(
					'TB → RD: still not handed to RD after 30 min — check the Transfers page.',
					{ id: toastId }
				);
			} catch (error) {
				toast.error(
					`TB → RD: ${error instanceof Error ? error.message : 'failed to submit'}`,
					{ id: toastId }
				);
			}
		},
		[rdKey, torboxKey, imdbId, searchResults, setSearchResults]
	);

	const deleteRd = useCallback(
		async (hash: string) => {
			if (!rdKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('rd:')) continue;
				await handleDeleteRdTorrent(rdKey, t.id);
				await torrentDB.deleteByHash('rd', hash);
				removeFromCache(t.id); // Update global cache
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`rd:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[rdKey, removeFromCache]
	);

	const deleteAd = useCallback(
		async (hash: string) => {
			if (!adKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('ad:')) continue;
				await handleDeleteAdTorrent(adKey, t.id);
				await torrentDB.deleteByHash('ad', hash);
				removeFromCache(t.id); // Update global cache
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`ad:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[adKey, removeFromCache]
	);

	const deleteTb = useCallback(
		async (hash: string) => {
			if (!torboxKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('tb:')) continue;
				await handleDeleteTbTorrent(torboxKey, t.id);
				await torrentDB.deleteByHash('tb', hash);
				removeFromCache(t.id); // Update global cache
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`tb:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[torboxKey, removeFromCache]
	);

	return {
		hashAndProgress,
		fetchHashAndProgress,
		addRd,
		addAd,
		addTb,
		sendTbToRd,
		deleteRd,
		deleteAd,
		deleteTb,
	};
}
