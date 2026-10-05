import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { SearchResult } from '@/services/mediasearch';
import { rdAddPauseRemainingMs } from '@/services/realDebrid';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInDl,
	handleAddAsMagnetInOc,
	handleAddAsMagnetInPm,
	handleAddAsMagnetInRd,
	handleAddAsMagnetInTb,
} from '@/utils/addMagnet';
import { removeAvailability, submitAvailability, submitAvailabilityAd } from '@/utils/availability';
import {
	createDebridUploaderJob,
	findJoinableTransfer,
	followTransferToRd,
	isDuplicateResponse,
	needsRdHandoff,
	settleCompletedTransfer,
	trackDebridUploaderJob,
	transferContextFromPath,
	updateTrackedDebridUploaderJob,
} from '@/utils/debridUploader';
import { isRdBlockedName } from '@/utils/deInfringe';
import {
	handleDeleteAdTorrent,
	handleDeleteDlTorrent,
	handleDeleteOcTorrent,
	handleDeletePmTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { convertToUserTorrent } from '@/utils/fetchTorrents';
import { generateTokenAndHash } from '@/utils/token';
import { TRANSFER_LABELS, TRANSFER_STEP_TOAST_MS, TRANSFER_TOAST_MS } from '@/utils/transferPhase';
import { exceedsTransferSizeCap, tooLargeMessage } from '@/utils/transferSize';
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

const SERVICE_LABELS = { tb: 'TorBox', pm: 'Premiumize', oc: 'Offcloud' } as const;

/**
 * Extras for an `addRd` call that the page's own state cannot answer.
 *
 * Both exist for the same caller: a run that adds releases for seasons other
 * than the one on screen. Such a run has the row in hand but `searchResults`
 * does not hold it, and it reports its own progress rather than letting each
 * add narrate itself.
 */
export type AddTbOptions = {
	/** The row being added, when it is not in `searchResults`. */
	row?: SearchResult;
	/** Suppress the per-add toasts; the caller is reporting progress itself. */
	silent?: boolean;
};

export type AddRdOptions = {
	/** The row being added, when it is not in `searchResults`. */
	row?: SearchResult;
	/** Suppress the per-add toasts; the caller is reporting progress itself. */
	silent?: boolean;
	/**
	 * Called when RD answered the add with a 451 its name does not explain:
	 * most likely the whole account is paused, not this release refused (see
	 * `rdAddPause.ts`). A bulk run uses it to try the same release again once
	 * the pause is over, instead of reporting it missing. Only RD calls it.
	 */
	onPaused?: () => void;
};

export type AddAdOptions = AddRdOptions & {
	/**
	 * Keep the magnet only when AllDebrid serves it at once, and answer whether
	 * it did. Without it an uncached add stays in the account downloading from
	 * peers, which is right for a click on one row and wrong for a bulk run that
	 * promised cached releases only.
	 */
	onlyIfCached?: boolean;
};

/** The services `addCached` can judge. Debrid-Link has no cache signal at all. */
export type CachedAddService = 'rd' | 'ad' | 'tb' | 'pm' | 'oc';

export function useTorrentManagement(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	premiumizeKey: string | null,
	offcloudKey: string | null,
	debridLinkKey: string | null,
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
			deleteIfNotInstant = false,
			opts?: AddRdOptions
		): Promise<any> => {
			if (!rdKey) return;

			// An availability check never waits for the account's pause: it is a
			// probe, and a probe fired into the pause is refused whatever the
			// answer would have been. Unanswered (null) is what it is; the caller
			// reads it as "RD did not say" through `isRdThrottling`.
			if (isCheckingAvailability && rdAddPauseRemainingMs(rdKey) > 0) return null;

			// Read searchResults at call time via closure - no need for dependency.
			// A bulk run over seasons the page never rendered has no row to find,
			// so it passes the one it is working from: without it the blocked-name
			// test below reads an empty title and takes a blocked name's 451 for
			// the account's pause.
			const torrentResult = opts?.row ?? searchResults.find((r) => r.hash === hash);
			const wasMarkedAvailable = torrentResult?.rdAvailable || false;
			let torrentInfo: TorrentInfoResponse | null = null;

			// Every path DMM has heard of for this torrent. RD judges an add on the
			// torrent's root name, and the row title is often the space-separated
			// display form that has lost the dots the block keys on, while a path's
			// leading folder still carries the real root name. RD also refuses to
			// stream a file whose own name matches. Reading the title alone takes
			// a real block for the account's pause and waits it out for nothing.
			// The lists disagree only on `fileId`, never on filenames, so all
			// three are worth reading.
			const knownFilenames = [
				...(torrentResult?.files ?? []),
				...(torrentResult?.tbFiles ?? []),
				...(torrentResult?.rdFiles ?? []),
			].map((f) => f.filename);

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

							if (!opts?.silent) toast.error('Torrent misflagged as RD available.');
						}
					}

					// Only submit availability for truly available torrents, and only
					// under an IMDb id. The row is keyed by hash and an upsert rewrites
					// its imdbId, so an anime page filing one under anything else would
					// move a shared row off the show page it belongs to.
					if (
						info.status === 'downloaded' &&
						info.progress === 100 &&
						/^tt\d+$/.test(imdbId)
					) {
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
				deleteIfNotInstant,
				0,
				// `silent` suppresses the per-add toasts. An availability check has
				// always been silent; a bulk run must be too, or one progress
				// notice competes with three toasts per season.
				isCheckingAvailability || !!opts?.silent,
				torrentResult?.title ?? '',
				0,
				knownFilenames
			);

			if (addResult === 'paused') opts?.onPaused?.();

			// Clean up false positives: when the torrent wasn't instant (deleteIfNotInstant)
			// or when RD rejected it as infringing, remove from availability database.
			//
			// A 451 `infringing_file` only counts as a rejection when the name is
			// one RD actually blocks. RD answers that same status whenever it is
			// refusing every add on the account for a while — Big Buck Bunny
			// included, measured 2026-10-04/05 — and a single "Check RD" sweep
			// over a season page is exactly the run of adds that brings one on.
			// Since a row here only exists because RD once served the torrent at
			// 100%, and the row is shared by every user, trusting the raw status
			// evicted 285 working hashes in one day. So the name gates the
			// eviction, and a `paused` add — a 451 the name did not explain —
			// never evicts at all, not even through the not-instant branch: it was
			// never added, so it was never shown not to be instant. Telling one
			// user "try again in a few minutes" costs them a click; evicting the
			// row costs everybody the release.
			const shouldRemoveAvailability =
				torrentInfo === null &&
				wasMarkedAvailable &&
				(addResult === 'infringing_file'
					? isRdBlockedName(torrentResult?.title ?? '', knownFilenames)
					: addResult !== 'error' && addResult !== 'paused' && deleteIfNotInstant);
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
		async (hash: string, isCheckingAvailability = false, opts?: AddAdOptions): Promise<any> => {
			if (!adKey) return;

			// Read searchResults at call time via closure. A bulk run over other
			// seasons has the row in hand instead - see `AddRdOptions`.
			const torrentResult = opts?.row ?? searchResults.find((r) => r.hash === hash);
			const silent = isCheckingAvailability || !!opts?.silent;
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
							if (!silent) toast.error('Torrent misflagged as AD available.');
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

							if (!silent) toast.error('Torrent misflagged as AD available.');
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

						// Only submit if we have valid files (name and size required),
						// under an IMDb id the route accepts - see addRd above.
						if (validFiles.length > 0) {
							if (/^tt\d+$/.test(imdbId)) {
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
							}
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
				// deleteIfNotInstant: a service check never keeps a miss, and
				// neither does a cached-only add.
				isCheckingAvailability || !!opts?.onlyIfCached,
				!isCheckingAvailability, // keepInLibrary parameter - keep if not checking service
				silent
			);

			console.log('[TorrentManagement] addAd end', { hash });
			if (isCheckingAvailability) return magnetStatusInfo;
			// The callback only ever sees a status for a magnet AD served at once;
			// a miss arrives as null and has already been deleted.
			if (opts?.onlyIfCached) return magnetStatusInfo !== null;
			return undefined;
		},
		[adKey, setSearchResults, imdbId, fetchHashAndProgress, addToCache, searchResults]
	);

	const addTb = useCallback(
		async (hash: string, opts?: AddTbOptions) => {
			if (!torboxKey) return;

			// Read searchResults at call time via closure. A bulk run over other
			// seasons has the row in hand instead - see `AddRdOptions`.
			const torrentResult = opts?.row ?? searchResults.find((r) => r.hash === hash);
			const wasMarkedAvailable = torrentResult?.tbAvailable || false;

			await handleAddAsMagnetInTb(
				torboxKey,
				hash,
				async (userTorrent: UserTorrent) => {
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
				},
				!!opts?.silent
			);
		},
		[torboxKey, fetchHashAndProgress, addToCache, searchResults]
	);

	const addPm = useCallback(
		async (hash: string) => {
			if (!premiumizeKey) return;

			await handleAddAsMagnetInPm(premiumizeKey, hash, async (userTorrent: UserTorrent) => {
				await torrentDB.add(userTorrent);
				addToCache(userTorrent);

				setHashAndProgress((prev) => ({
					...prev,
					[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]: userTorrent.progress,
				}));

				await fetchHashAndProgress();
			});
		},
		[premiumizeKey, fetchHashAndProgress, addToCache]
	);

	const addOc = useCallback(
		async (hash: string) => {
			if (!offcloudKey) return;

			await handleAddAsMagnetInOc(offcloudKey, hash, async (userTorrent: UserTorrent) => {
				await torrentDB.add(userTorrent);
				addToCache(userTorrent);

				setHashAndProgress((prev) => ({
					...prev,
					[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]: userTorrent.progress,
				}));

				await fetchHashAndProgress();
			});
		},
		[offcloudKey, fetchHashAndProgress, addToCache]
	);

	/**
	 * Adds a hash to Debrid-Link.
	 *
	 * No availability gate and none possible: Debrid-Link publishes no cache
	 * probe, so the add is the probe. It sends the full magnet, so an uncached
	 * release downloads for real rather than being refused — see
	 * `handleAddAsMagnetInDl`.
	 */
	const addDl = useCallback(
		async (hash: string) => {
			if (!debridLinkKey) return;

			await handleAddAsMagnetInDl(debridLinkKey, hash, async (userTorrent: UserTorrent) => {
				await torrentDB.add(userTorrent);
				addToCache(userTorrent);

				setHashAndProgress((prev) => ({
					...prev,
					[`${userTorrent.id.substring(0, 3)}${userTorrent.hash}`]: userTorrent.progress,
				}));

				await fetchHashAndProgress();
			});
		},
		[debridLinkKey, fetchHashAndProgress, addToCache]
	);

	// Sends a TorBox-cached search-result torrent into the user's RD account via
	// the debrid uploader service, which rewrites the torrent with de-infringed
	// filenames so RD accepts it — which is why this works even on RD-blocked
	// names. The RD torrent gets a different info hash than the search result, so
	// the original hash is never RD-cached and neither the row nor the
	// availability DB is marked here; the Transfers page (and the server-side
	// registration) is where it surfaces.
	//
	// **AllDebrid was the other source and is withdrawn**, along with the AD key
	// this used to send on every transfer. AllDebrid answers `NO_SERVER` to the
	// uploader hosts' addresses (debrid02 has 0 AllDebrid completions in its
	// entire history) and `AUTH_BLOCKED` to most submitters' keys, which only the
	// account owner can clear from an email they receive — so the path could not
	// work for the people using it. The Transfers page still labels older
	// AllDebrid-served jobs; only the way to start a new one is gone.
	//
	// The loading state resolves as soon as RD's own download is underway
	// ('uploading' in the service's pipeline): from there the transfer no longer
	// needs the browser, so holding a spinner for the whole RD pull is noise.
	const sendToRd = useCallback(
		async (hash: string) => {
			const sourceKey = torboxKey;
			const label = TRANSFER_LABELS.tb;
			if (!rdKey || !sourceKey) return;
			if (!/^tt\d+$/.test(imdbId)) {
				toast.error(`${label} needs an IMDB id for this title.`);
				return;
			}

			const transferContext = transferContextFromPath(window.location.pathname);

			// Size (in bytes) lets the server keep big torrents off weak hosts. The
			// biggest single file is the "remux" signal; sizes on the row are in MB.
			const row = searchResults.find((r) => r.hash === hash);
			const sizeMb = row?.biggestFileSize || row?.fileSize || 0;
			const sizeBytes = sizeMb > 0 ? Math.round(sizeMb * 1024 * 1024) : undefined;

			// Refuse an oversize release here rather than letting it travel to the
			// uploader to be refused there. `fileSize` and not `sizeBytes` above:
			// that one is `biggestFileSize` first, which is the right routing signal
			// but badly understates a season pack — the cap is about the whole
			// release, which is what the uploader sums its files to.
			const totalBytes = row?.fileSize ? Math.round(row.fileSize * 1024 * 1024) : undefined;
			if (exceedsTransferSizeCap(totalBytes)) {
				toast.error(`${label}: ${tooLargeMessage(totalBytes as number)}`, {
					duration: TRANSFER_TOAST_MS,
				});
				return;
			}

			const toastId = toast.loading(`${label}: submitting transfer...`, {
				duration: TRANSFER_STEP_TOAST_MS,
			});
			try {
				let jobId: string;
				// Whether the finished torrent still has to be put into this user's RD.
				let rdHandoff: boolean;

				// One transfer per magnet — and the magnet is the whole of it, so
				// TB → RD and AD → RD join the same transfer rather than running two
				// pipelines for identical content. An existing transfer is joined,
				// never resubmitted: only a failed or vanished job is retried.
				const joinable = await findJoinableTransfer(hash, transferContext);
				if (joinable) {
					jobId = joinable.tracked.id;
					rdHandoff = needsRdHandoff(joinable.tracked);
					setSearchResults((prev) =>
						prev.map((r) => (r.hash === hash ? { ...r, tbTransferred: true } : r))
					);

					if (joinable.job.status === 'completed') {
						await settleCompletedTransfer({
							rdKey,
							jobId,
							infoHash: joinable.job.info_hash,
							needsHandoff: rdHandoff,
							label,
							toastId,
						});
						return;
					}
					toast.loading(
						`${label}: transfer already in progress — waiting for completion...`,
						{ id: toastId, duration: TRANSFER_STEP_TOAST_MS }
					);
				} else {
					const job = await createDebridUploaderJob({
						hash,
						imdbId,
						rdKey,
						tbKey: torboxKey ?? undefined,
						sizeBytes,
					});

					if (isDuplicateResponse(job)) {
						jobId = job.jobId;
						rdHandoff = true;

						trackDebridUploaderJob({
							id: job.jobId,
							hash,
							imdbId,
							title: row?.title,
							returnPath: window.location.pathname,
							createdAt: Date.now(),
							adopted: true,
						});
						setSearchResults((prev) =>
							prev.map((r) => (r.hash === hash ? { ...r, tbTransferred: true } : r))
						);

						if (job.duplicate === 'completed') {
							// The server adds a finished duplicate to the caller's RD
							// itself; retry from here when that leg failed.
							if (job.addedToRd) {
								updateTrackedDebridUploaderJob(job.jobId, { rdAdded: true });
							}
							await settleCompletedTransfer({
								rdKey,
								jobId,
								infoHash: job.rewrittenHash,
								needsHandoff: !job.addedToRd,
								label,
								toastId,
							});
							return;
						}

						// in_progress: fall through to poll and add to RD on completion
						toast.loading(
							`${label}: transfer in progress — waiting for completion...`,
							{
								id: toastId,
								duration: TRANSFER_STEP_TOAST_MS,
							}
						);
					} else {
						jobId = job.id;
						// Created with this user's RD key, so the service hands it over.
						rdHandoff = false;

						trackDebridUploaderJob({
							id: job.id,
							hash,
							imdbId,
							title: row?.title,
							returnPath: window.location.pathname,
							createdAt: Date.now(),
							adopted: false,
						});
						toast.loading(
							`${label}: transfer started — track it on the Transfers page.`,
							{ id: toastId, duration: TRANSFER_STEP_TOAST_MS }
						);
					}
				}

				const outcome = await followTransferToRd({
					jobId,
					rdKey,
					label,
					toastId,
					rdHandoff,
					context: transferContext,
				});
				// Joining marks the row transferred before the outcome is known, which
				// swaps the TB → RD button for an "In RD" badge. A transfer that then
				// fails delivered nothing, and leaving the badge took away the one
				// way to send the release again until a reload (card 109).
				if (outcome === 'failed') {
					setSearchResults((prev) =>
						prev.map((r) =>
							r.hash === hash
								? { ...r, tbTransferred: false, tbTransferredHash: undefined }
								: r
						)
					);
				}
			} catch (error) {
				toast.error(
					`${label}: ${error instanceof Error ? error.message : 'failed to submit'}`,
					{ id: toastId, duration: TRANSFER_TOAST_MS }
				);
			}
		},
		[rdKey, torboxKey, imdbId, searchResults, setSearchResults]
	);

	const sendTbToRd = useCallback((hash: string) => sendToRd(hash), [sendToRd]);

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

	const deletePm = useCallback(
		async (hash: string) => {
			if (!premiumizeKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('pm:')) continue;
				await handleDeletePmTorrent(premiumizeKey, t.id);
				await torrentDB.deleteByHash('pm', hash);
				removeFromCache(t.id);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`pm:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[premiumizeKey, removeFromCache]
	);

	const deleteOc = useCallback(
		async (hash: string) => {
			if (!offcloudKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('oc:')) continue;
				await handleDeleteOcTorrent(offcloudKey, t.id);
				await torrentDB.deleteByHash('oc', hash);
				removeFromCache(t.id);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`oc:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[offcloudKey, removeFromCache]
	);

	/**
	 * Removes the Debrid-Link rows for a hash.
	 *
	 * Debrid-Link's removal never reports a failure — it echoes back whatever id
	 * it was asked about — so the local row goes either way and the truth comes
	 * from the next library listing.
	 */
	const deleteDl = useCallback(
		async (hash: string) => {
			if (!debridLinkKey) return;

			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('dl:')) continue;
				await handleDeleteDlTorrent(debridLinkKey, t.id);
				await torrentDB.deleteByHash('dl', hash);
				removeFromCache(t.id);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`dl:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[debridLinkKey, removeFromCache]
	);

	/**
	 * Adds to TorBox, Premiumize or Offcloud and keeps the result only if the
	 * service already had it.
	 *
	 * Each of them has a cache probe, and a bulk run uses it to choose what to
	 * add, but a probe answers for the service's cache rather than for what this
	 * account ends up holding. The row the add itself returns is the verdict: a
	 * cached add comes back finished on all three (TorBox marks it
	 * `download_finished` and present, Premiumize and Offcloud finish inside the
	 * add), so anything short of 100% was a miss and is removed again rather than
	 * left downloading in an account that was promised cached releases.
	 */
	const addVerified = useCallback(
		async (
			service: 'tb' | 'pm' | 'oc',
			hash: string,
			opts?: { silent?: boolean }
		): Promise<boolean> => {
			const key =
				service === 'tb' ? torboxKey : service === 'pm' ? premiumizeKey : offcloudKey;
			if (!key) return false;

			const label = SERVICE_LABELS[service];
			let added: UserTorrent | null = null;
			const capture = async (userTorrent: UserTorrent) => {
				added = userTorrent;
			};
			// The handlers always run silent: their "added" toast would land
			// before the verdict below, and then the add may be removed again.
			// Their failure toasts are lost with it, so this says it instead.
			try {
				if (service === 'tb') await handleAddAsMagnetInTb(key, hash, capture, true);
				else if (service === 'pm') await handleAddAsMagnetInPm(key, hash, capture, true);
				else await handleAddAsMagnetInOc(key, hash, capture, true);
			} catch (error) {
				if (!opts?.silent) toast.error(`${label} refused the add.`);
				throw error;
			}

			const row = added as UserTorrent | null;
			// No row means the add came back without an id to read (a TorBox
			// add that only queued), so there is nothing to judge or remove.
			if (!row || !row.id || row.id.endsWith(':undefined')) return false;

			if (!(row.progress >= 100)) {
				if (service === 'tb') await handleDeleteTbTorrent(key, row.id, true);
				else if (service === 'pm') await handleDeletePmTorrent(key, row.id, true);
				else await handleDeleteOcTorrent(key, row.id, true);
				if (!opts?.silent) toast.error(`Not cached on ${label}; removed.`);
				return false;
			}

			await torrentDB.add(row);
			addToCache(row);
			setHashAndProgress((prev) => ({
				...prev,
				[`${row.id.substring(0, 3)}${row.hash}`]: row.progress,
			}));
			if (!opts?.silent) toast.success(`Added to ${label}.`);
			return true;
		},
		[torboxKey, premiumizeKey, offcloudKey, addToCache]
	);

	/**
	 * Adds a release only if the service serves it at once, and says whether it
	 * did. The one entry point the bulk actions (whole season, every episode,
	 * every season) use, so each of them works on every service with a cache
	 * signal rather than on the one it was first written for.
	 *
	 * A release already in the library answers true without an add. That is
	 * what the bulk actions mean by it, and it keeps the verified path from
	 * removing a user's own unfinished transfer: Premiumize and Offcloud hand
	 * back the existing item when the same magnet is added twice.
	 */
	const addCached = useCallback(
		async (service: CachedAddService, hash: string, opts?: AddRdOptions): Promise<boolean> => {
			if (`${service}:${hash.toLowerCase()}` in hashAndProgress) return true;
			if (`${service}:${hash}` in hashAndProgress) return true;
			try {
				if (service === 'rd') return (await addRd(hash, false, true, opts)) === true;
				if (service === 'ad') {
					return (await addAd(hash, false, { ...opts, onlyIfCached: true })) === true;
				}
				return await addVerified(service, hash, opts);
			} catch {
				// Every handler has already said why, unless the caller asked for
				// silence and is counting failures itself.
				return false;
			}
		},
		[hashAndProgress, addRd, addAd, addVerified]
	);

	return {
		hashAndProgress,
		fetchHashAndProgress,
		addRd,
		addAd,
		addTb,
		addPm,
		addOc,
		addDl,
		addCached,
		sendTbToRd,
		deleteRd,
		deleteAd,
		deleteTb,
		deletePm,
		deleteOc,
		deleteDl,
	};
}
