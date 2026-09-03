import { SearchResult } from '@/services/mediasearch';
import {
	checkOffcloudCache,
	CACHE_CHECK_CHUNK_SIZE as OC_CACHE_CHECK_CHUNK_SIZE,
} from '@/services/offcloud';
import { CACHE_CHECK_CHUNK_SIZE, checkPremiumizeCache } from '@/services/premiumize';
import { hasRecentRdRateLimits } from '@/services/realDebrid';
import { checkCachedStatus, TorBoxCachedResponse } from '@/services/torbox';
import { delay } from '@/utils/delay';
import {
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from '@/utils/instantChecks';
import { processWithConcurrency } from '@/utils/parallelProcessor';
import { generateTokenAndHash } from '@/utils/token';
import { getCachedTrackerStats, shouldIncludeTrackerStats } from '@/utils/trackerStats';
import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';

export type DebridService = 'RD' | 'AD' | 'TB' | 'PM' | 'OC';

// RD retired /instantAvailability, so the only way to ask whether it holds a
// hash is to add the torrent and delete it again — which means a sweep of a
// season page is a burst of adds, and RD punishes a burst of adds with
// `451 infringing_file`, the throttle wearing its content-block status.
// Measured 2026-08-28: this sweep's old shape (concurrency 3, no pacing) got 2
// usable answers out of 15 hashes, reported the other 13 cached torrents as
// uncached, and left the account refusing the user's own adds for minutes
// afterwards. So probe one row at a time, widen the gap every time RD pushes
// back, and give up rather than grind out answers that are wrong.
const RD_PROBE_BASE_SPACING_MS = 1000;
const RD_PROBE_MAX_SPACING_MS = 30_000;
// Five rows in a row throttled means the penalty is not clearing inside a gap
// this sweep can afford to wait.
const RD_THROTTLE_ABORT_AFTER = 5;

/**
 * Whether an RD probe that came back empty was throttled rather than answered.
 *
 * `addRd` returns null for any failure, so the reason is gone by the time it
 * gets here — but every 451 whose name RD does not actually block records a
 * rate limit first (see `handleAddAsMagnetInRd`), and so does a real 429. A row
 * classified this way must not be treated as "RD says no": it is "RD did not
 * say".
 */
const wasThrottled = (addRdResponse: unknown) => addRdResponse === null && hasRecentRdRateLimits();

const formatServicesLabel = (services: DebridService[]) =>
	services.length ? services.join(' / ') : 'services';

const checkingKey = (hash: string, service: DebridService) => `${hash}:${service}`;

const markAvailableServices = (
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>,
	sortFunction: (searchResults: SearchResult[]) => SearchResult[],
	availableHashesByService: Partial<Record<DebridService, Set<string>>>
) => {
	setSearchResults((prevResults) => {
		let hasChanges = false;
		const nextResults = prevResults.map((result) => {
			const rdAvailable =
				result.rdAvailable || Boolean(availableHashesByService.RD?.has(result.hash));
			const adAvailable =
				result.adAvailable || Boolean(availableHashesByService.AD?.has(result.hash));
			const tbAvailable =
				result.tbAvailable || Boolean(availableHashesByService.TB?.has(result.hash));
			const pmAvailable =
				result.pmAvailable || Boolean(availableHashesByService.PM?.has(result.hash));
			const ocAvailable =
				result.ocAvailable || Boolean(availableHashesByService.OC?.has(result.hash));

			if (
				rdAvailable === result.rdAvailable &&
				adAvailable === result.adAvailable &&
				tbAvailable === result.tbAvailable &&
				pmAvailable === result.pmAvailable &&
				ocAvailable === result.ocAvailable
			) {
				return result;
			}

			hasChanges = true;
			const updated = {
				...result,
				rdAvailable,
				adAvailable,
				tbAvailable,
				pmAvailable,
				ocAvailable,
			};
			delete updated.trackerStats;
			return updated;
		});

		return hasChanges ? sortFunction(nextResults) : prevResults;
	});
};

export function useAvailabilityCheck(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	premiumizeKey: string | null,
	offcloudKey: string | null,
	imdbId: string,
	searchResults: SearchResult[],
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>,
	hashAndProgress: Record<string, number>,
	addRd: (hash: string, isCheckingAvailability: boolean) => Promise<any>,
	addAd: (hash: string, isCheckingAvailability: boolean) => Promise<any>,
	deleteRd: (hash: string) => Promise<void>,
	deleteAd: (hash: string) => Promise<void>,
	sortFunction: (searchResults: SearchResult[]) => SearchResult[]
) {
	const [checkingSet, setCheckingSet] = useState<Set<string>>(new Set());
	const isMounted = useRef(true);

	const addChecking = useCallback((hash: string, services: DebridService[]) => {
		setCheckingSet((prev) => {
			const next = new Set(prev);
			for (const s of services) next.add(checkingKey(hash, s));
			return next;
		});
	}, []);

	const removeChecking = useCallback((hash: string, services: DebridService[]) => {
		setCheckingSet((prev) => {
			const next = new Set(prev);
			for (const s of services) next.delete(checkingKey(hash, s));
			return next;
		});
	}, []);

	const isHashServiceChecking = useCallback(
		(hash: string, service: DebridService) => checkingSet.has(checkingKey(hash, service)),
		[checkingSet]
	);

	const isAnyChecking = checkingSet.size > 0;
	const resolveServicesToCheck = useCallback(
		(requested?: DebridService[]) => {
			const available: DebridService[] = [];
			if (rdKey) available.push('RD');
			if (adKey) available.push('AD');
			if (torboxKey) available.push('TB');
			if (premiumizeKey) available.push('PM');
			if (offcloudKey) available.push('OC');

			if (!requested || requested.length === 0) {
				return available;
			}

			const requestedSet = new Set(requested);
			return available.filter((service) => requestedSet.has(service));
		},
		[rdKey, adKey, torboxKey, premiumizeKey, offcloudKey]
	);

	const isServiceAvailable = useCallback((service: DebridService, result: SearchResult) => {
		switch (service) {
			case 'RD':
				return Boolean(result.rdAvailable);
			case 'AD':
				return Boolean(result.adAvailable);
			case 'TB':
				return Boolean(result.tbAvailable);
			case 'PM':
				return Boolean(result.pmAvailable);
			case 'OC':
				return Boolean(result.ocAvailable);
			default:
				return false;
		}
	}, []);

	const checkServiceAvailability = useCallback(
		async (result: SearchResult, servicesToCheck?: DebridService[]) => {
			const services = resolveServicesToCheck(servicesToCheck);

			if (services.length === 0) {
				toast.error('No services available for availability check.');
				return;
			}

			const alreadyAvailableServices = services.filter((service) =>
				isServiceAvailable(service, result)
			);
			const alreadyCheckingServices = services.filter(
				(service) =>
					!isServiceAvailable(service, result) &&
					checkingSet.has(checkingKey(result.hash, service))
			);
			const servicesNeedingCheck = services.filter(
				(service) =>
					!isServiceAvailable(service, result) &&
					!checkingSet.has(checkingKey(result.hash, service))
			);

			if (servicesNeedingCheck.length === 0) {
				if (alreadyAvailableServices.length > 0) {
					toast.success(
						`Already cached in ${formatServicesLabel(alreadyAvailableServices)}.`
					);
				} else if (alreadyCheckingServices.length > 0) {
					toast('Check already in progress for this torrent.');
				}
				return;
			}

			addChecking(result.hash, servicesNeedingCheck);

			const toastId = toast.loading(
				`Checking availability (${formatServicesLabel(servicesNeedingCheck)})...`,
				{ duration: 30000 }
			);

			try {
				// Run checks in parallel for RD, AD, and TorBox
				const [
					rdCheckResult,
					adCheckResult,
					tbCheckResult,
					pmCheckResult,
					ocCheckResult,
					trackerStatsResult,
				] = await Promise.allSettled([
					// RD availability check
					rdKey && servicesNeedingCheck.includes('RD')
						? (async () => {
								let addRdResponse: any;
								if (`rd:${result.hash}` in hashAndProgress) {
									await deleteRd(result.hash);
								}
								addRdResponse = await addRd(result.hash, true);
								await deleteRd(result.hash);

								const isCachedInRD =
									addRdResponse &&
									addRdResponse.id &&
									addRdResponse.status === 'downloaded' &&
									addRdResponse.progress === 100;

								return { addRdResponse, isCachedInRD };
							})()
						: Promise.resolve({
								addRdResponse: null,
								isCachedInRD: Boolean(result.rdAvailable),
							}),

					// AD availability check
					adKey && servicesNeedingCheck.includes('AD')
						? (async () => {
								let addAdResponse: any;
								if (`ad:${result.hash}` in hashAndProgress) {
									await deleteAd(result.hash);
								}
								addAdResponse = await addAd(result.hash, true);
								await deleteAd(result.hash);

								// Check if addAd found it cached
								const isCachedInAD =
									addAdResponse &&
									addAdResponse.id &&
									addAdResponse.statusCode === 4 &&
									addAdResponse.status === 'Ready';

								return { addAdResponse, isCachedInAD };
							})()
						: Promise.resolve({
								addAdResponse: null,
								isCachedInAD: Boolean(result.adAvailable),
							}),

					// TorBox availability check (read-only, no add/delete)
					torboxKey && servicesNeedingCheck.includes('TB')
						? (async () => {
								const resp = await checkCachedStatus(
									{ hash: result.hash, format: 'object', list_files: true },
									torboxKey
								);
								const cached = resp.data as TorBoxCachedResponse | null;
								const entry = cached?.[result.hash];
								const isCachedInTB =
									!!entry && Array.isArray(entry.files) && entry.files.length > 0;
								return { addTbResponse: null, isCachedInTB };
							})()
						: Promise.resolve({
								addTbResponse: null,
								isCachedInTB: Boolean(result.tbAvailable),
							}),

					// Premiumize availability check (read-only, nothing added
					// to the account - unlike AllDebrid, where the probe is
					// the upload)
					premiumizeKey && servicesNeedingCheck.includes('PM')
						? (async () => {
								const [probe] = await checkPremiumizeCache(premiumizeKey, [
									result.hash,
								]);
								return { isCachedInPM: Boolean(probe?.cached) };
							})()
						: Promise.resolve({ isCachedInPM: Boolean(result.pmAvailable) }),

					// Offcloud availability check. Read-only like Premiumize's -
					// `/cache` adds nothing to the account - and answering with
					// hits only, so a miss is an absent hash rather than a
					// `cached: false`. Deliberately a second call even though
					// Offcloud's cache is measured to *be* Premiumize's cache
					// (identical to the hash, 2026-09-02): the two accounts,
					// keys and outages are separate.
					offcloudKey && servicesNeedingCheck.includes('OC')
						? (async () => {
								const [probe] = await checkOffcloudCache(offcloudKey, [
									result.hash,
								]);
								return { isCachedInOC: Boolean(probe?.cached) };
							})()
						: Promise.resolve({ isCachedInOC: Boolean(result.ocAvailable) }),

					// Tracker stats check (only if enabled and not already available)
					(async () => {
						if (
							!shouldIncludeTrackerStats() ||
							result.rdAvailable ||
							result.adAvailable ||
							result.tbAvailable ||
							result.pmAvailable ||
							result.ocAvailable
						) {
							return null;
						}

						// For single torrent checks, force refresh if it was previously dead
						const currentStats = result.trackerStats;
						const forceRefresh = currentStats && currentStats.seeders === 0;

						// Use cached stats if fresh, otherwise scrape new ones
						return await getCachedTrackerStats(result.hash, 24, forceRefresh);
					})(),
				]);

				// Process RD check result
				let isCachedInRD = Boolean(result.rdAvailable);
				let rdThrottled = false;
				if (rdCheckResult.status === 'fulfilled') {
					isCachedInRD = rdCheckResult.value.isCachedInRD;
					rdThrottled = wasThrottled(rdCheckResult.value.addRdResponse);
					// Only a probe RD actually answered can retire a transfer
					// badge. `addRdResponse === null` means the add threw — and
					// the usual reason is RD's 451 throttle penalty, which a
					// sweep like this one earns for itself. `removeDebridTransfer`
					// is keyed by hash alone, so one throttled user unregisters a
					// working transfer for everybody.
					if (
						!isCachedInRD &&
						result.tbTransferred &&
						Boolean(rdCheckResult.value.addRdResponse)
					) {
						fetch('/api/debrid-uploader/unregister', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ hash: result.hash }),
						}).catch(() => {});
						setSearchResults((prev) =>
							prev.map((r) =>
								r.hash === result.hash
									? { ...r, tbTransferred: false, tbTransferredHash: undefined }
									: r
							)
						);
					}
				} else if (rdKey && servicesNeedingCheck.includes('RD')) {
					console.error('RD availability check failed:', rdCheckResult.reason);
				}

				// Process AD check result
				let isCachedInAD = Boolean(result.adAvailable);
				if (adCheckResult.status === 'fulfilled') {
					isCachedInAD = adCheckResult.value.isCachedInAD;
				} else if (adKey && servicesNeedingCheck.includes('AD')) {
					console.error('AD availability check failed:', adCheckResult.reason);
				}

				// Process TorBox check result
				let isCachedInTB = Boolean(result.tbAvailable);
				if (tbCheckResult.status === 'fulfilled') {
					isCachedInTB = tbCheckResult.value.isCachedInTB;
				} else if (torboxKey && servicesNeedingCheck.includes('TB')) {
					console.error('TorBox availability check failed:', tbCheckResult.reason);
				}

				// Process Premiumize check result
				let isCachedInPM = Boolean(result.pmAvailable);
				if (pmCheckResult.status === 'fulfilled') {
					isCachedInPM = pmCheckResult.value.isCachedInPM;
				} else if (premiumizeKey && servicesNeedingCheck.includes('PM')) {
					console.error('Premiumize availability check failed:', pmCheckResult.reason);
				}

				// Process Offcloud check result
				let isCachedInOC = Boolean(result.ocAvailable);
				if (ocCheckResult.status === 'fulfilled') {
					isCachedInOC = ocCheckResult.value.isCachedInOC;
				} else if (offcloudKey && servicesNeedingCheck.includes('OC')) {
					console.error('Offcloud availability check failed:', ocCheckResult.reason);
				}

				const positiveAvailability: Partial<Record<DebridService, Set<string>>> = {};
				if (isCachedInRD) positiveAvailability.RD = new Set([result.hash]);
				if (isCachedInAD) positiveAvailability.AD = new Set([result.hash]);
				if (isCachedInTB) positiveAvailability.TB = new Set([result.hash]);
				if (isCachedInPM) positiveAvailability.PM = new Set([result.hash]);
				if (isCachedInOC) positiveAvailability.OC = new Set([result.hash]);

				if (Object.keys(positiveAvailability).length > 0 && isMounted.current) {
					markAvailableServices(setSearchResults, sortFunction, positiveAvailability);
				}

				// Process tracker stats result (only if not cached in any service)
				if (
					trackerStatsResult.status === 'fulfilled' &&
					trackerStatsResult.value &&
					!isCachedInRD &&
					!isCachedInAD &&
					!isCachedInTB &&
					!isCachedInPM &&
					!isCachedInOC
				) {
					const trackerStats = trackerStatsResult.value;

					// Update the search result with tracker stats
					const updatedResults = searchResults.map((r) => {
						if (r.hash === result.hash) {
							return {
								...r,
								trackerStats: {
									seeders: trackerStats.seeders,
									leechers: trackerStats.leechers,
									downloads: trackerStats.downloads,
									hasActivity:
										trackerStats.seeders >= 1 &&
										trackerStats.leechers + trackerStats.downloads >= 1,
								},
							};
						}
						return r;
					});
					setSearchResults(updatedResults);
				} else if (
					trackerStatsResult.status === 'rejected' &&
					!isCachedInRD &&
					!isCachedInAD &&
					!isCachedInTB &&
					!isCachedInPM &&
					!isCachedInOC
				) {
					console.error('Failed to get tracker stats:', trackerStatsResult.reason);
				}

				if (rdThrottled) {
					// RD refused to answer rather than answering "not cached".
					toast.error('RD is throttling adds — try this row again in a minute.', {
						id: toastId,
						duration: 6000,
					});
				} else {
					toast.success(`Service check done (${formatServicesLabel(services)}).`, {
						id: toastId,
					});
				}

				// Update database cache with service check results
				if (isMounted.current) {
					const hashArr = [result.hash];

					// Update RD database cache
					if (rdKey && services.includes('RD')) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						await checkDatabaseAvailabilityRd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							hashArr,
							setSearchResults,
							sortFunction
						);
					}

					// Update AD database cache
					if (adKey && services.includes('AD')) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						await checkDatabaseAvailabilityAd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							hashArr,
							setSearchResults,
							sortFunction
						);
					}

					// Update TorBox database cache
					if (torboxKey && services.includes('TB')) {
						await checkDatabaseAvailabilityTb(
							torboxKey,
							hashArr,
							setSearchResults,
							sortFunction
						);
					}
				}
			} catch (error) {
				toast.error(`Service check failed (${formatServicesLabel(services)}).`, {
					id: toastId,
				});
				console.error('Service availability check error:', error);
			} finally {
				removeChecking(result.hash, servicesNeedingCheck);
			}
		},
		[
			imdbId,
			rdKey,
			adKey,
			torboxKey,
			premiumizeKey,
			offcloudKey,
			searchResults,
			setSearchResults,
			hashAndProgress,
			addRd,
			addAd,
			deleteRd,
			deleteAd,
			sortFunction,
			resolveServicesToCheck,
			isServiceAvailable,
			addChecking,
			removeChecking,
			checkingSet,
		]
	);

	const checkServiceAvailabilityBulk = useCallback(
		async (filteredResults: SearchResult[], servicesToCheck?: DebridService[]) => {
			if (isAnyChecking) return;

			const services = resolveServicesToCheck(servicesToCheck);
			if (services.length === 0) {
				toast.error('No services available for availability check.');
				return;
			}

			const torrentsNeedingAnyService = filteredResults.filter((result) =>
				services.some((service) => !isServiceAvailable(service, result))
			);

			if (torrentsNeedingAnyService.length === 0) {
				toast.error(`No torrents left to check for ${formatServicesLabel(services)}.`);
				return;
			}

			const availabilityCheckLimit = parseInt(
				window.localStorage.getItem('settings:availabilityCheckLimit') || '0'
			);

			let torrentsToCheck = torrentsNeedingAnyService;
			if (
				availabilityCheckLimit > 0 &&
				torrentsNeedingAnyService.length > availabilityCheckLimit
			) {
				torrentsToCheck = torrentsNeedingAnyService.slice(0, availabilityCheckLimit);
				toast(
					`Checking first ${availabilityCheckLimit} of ${torrentsNeedingAnyService.length} for ${formatServicesLabel(services)} (per settings).`,
					{ duration: 4000 }
				);
			}

			// Mark all torrents being checked with their respective services
			for (const t of torrentsToCheck) {
				const servicesForHash = services.filter((s) => !isServiceAvailable(s, t));
				if (servicesForHash.length > 0) addChecking(t.hash, servicesForHash);
			}

			const servicesLabel = formatServicesLabel(services);
			let progressToast: string | null = toast.loading(
				`Starting ${servicesLabel} check for ${torrentsToCheck.length} torrents...`,
				{ duration: 30000 }
			);

			const rdTargets = services.includes('RD')
				? torrentsToCheck.filter((r) => !r.rdAvailable)
				: [];
			const adTargets = services.includes('AD')
				? torrentsToCheck.filter((r) => !r.adAvailable)
				: [];
			const tbTargets = services.includes('TB')
				? torrentsToCheck.filter((r) => !r.tbAvailable)
				: [];
			const pmTargets = services.includes('PM')
				? torrentsToCheck.filter((r) => !r.pmAvailable)
				: [];
			const ocTargets = services.includes('OC')
				? torrentsToCheck.filter((r) => !r.ocAvailable)
				: [];

			const checkProgress: Record<DebridService, { completed: number; total: number }> = {
				RD: { completed: 0, total: rdTargets.length },
				AD: { completed: 0, total: adTargets.length },
				TB: { completed: 0, total: tbTargets.length },
				PM: { completed: 0, total: pmTargets.length },
				OC: { completed: 0, total: ocTargets.length },
			};
			let statsProgress = { completed: 0, total: 0 };
			let torrentsWithSeeds = 0;
			const realtimeAvailable: Record<DebridService, number> = {
				RD: 0,
				AD: 0,
				TB: 0,
				PM: 0,
				OC: 0,
			};

			const updateProgressMessage = () => {
				const parts: string[] = [];

				services.forEach((service) => {
					const progress = checkProgress[service];
					if (progress.total > 0) {
						const found = realtimeAvailable[service];
						const foundText = found > 0 ? ` (${found} found)` : '';
						parts.push(
							`${service}: ${progress.completed}/${progress.total}${foundText}`
						);
					}
				});

				if (shouldIncludeTrackerStats() && statsProgress.total > 0) {
					const statsPart =
						torrentsWithSeeds > 0
							? `Tracker Stats: ${statsProgress.completed}/${statsProgress.total} (${torrentsWithSeeds} with seeds)`
							: `Tracker Stats: ${statsProgress.completed}/${statsProgress.total}`;
					parts.push(statsPart);
				}

				if (progressToast && isMounted.current && parts.length > 0) {
					toast.loading(parts.join(' | '), { id: progressToast, duration: 30000 });
				}
			};

			// Adaptive pacing for the RD leg, held across the whole sweep.
			let rdProbeSpacing = RD_PROBE_BASE_SPACING_MS;
			let rdConsecutiveThrottled = 0;
			let rdProbesStarted = 0;
			let rdAbandoned = false;
			let rdUnprobed = 0;

			try {
				const [
					rdCheckResults,
					adCheckResults,
					tbCheckResults,
					pmCheckResults,
					ocCheckResults,
					trackerStatsResults,
				] = await Promise.all([
					// RD availability checks, one at a time and paced — see
					// RD_PROBE_BASE_SPACING_MS above for why this is not parallel.
					services.includes('RD')
						? processWithConcurrency(
								rdTargets,
								async (result: SearchResult) => {
									try {
										if (rdAbandoned) {
											rdUnprobed++;
											return {
												result,
												isCachedInRD: false,
												addRdResponse: null,
												throttled: true,
											};
										}
										if (rdProbesStarted > 0) await delay(rdProbeSpacing);
										rdProbesStarted++;

										let addRdResponse: any;
										if (`rd:${result.hash}` in hashAndProgress) {
											await deleteRd(result.hash);
										}
										addRdResponse = await addRd(result.hash, true);
										await deleteRd(result.hash);

										const isCachedInRD =
											addRdResponse &&
											addRdResponse.id &&
											addRdResponse.status === 'downloaded' &&
											addRdResponse.progress === 100;

										if (isCachedInRD) {
											realtimeAvailable.RD++;
										}

										// A throttled probe is not an answer, so
										// back off; a real one earns the gap back.
										const throttled = wasThrottled(addRdResponse);
										if (throttled) {
											rdConsecutiveThrottled++;
											rdProbeSpacing = Math.min(
												rdProbeSpacing * 2,
												RD_PROBE_MAX_SPACING_MS
											);
											if (rdConsecutiveThrottled >= RD_THROTTLE_ABORT_AFTER) {
												rdAbandoned = true;
											}
										} else {
											rdConsecutiveThrottled = 0;
											rdProbeSpacing = Math.max(
												RD_PROBE_BASE_SPACING_MS,
												Math.floor(rdProbeSpacing / 2)
											);
										}

										// `addRdResponse` rides along so a probe
										// RD never answered can be told apart
										// from RD answering "not cached".
										return {
											result,
											isCachedInRD,
											addRdResponse,
											throttled,
										};
									} catch (error) {
										console.error(
											`Failed RD check for ${result.title}:`,
											error
										);
										throw error;
									} finally {
										removeChecking(result.hash, ['RD']);
									}
								},
								1,
								(completed: number, total: number) => {
									checkProgress.RD = { completed, total };
									updateProgressMessage();
								}
							)
						: Promise.resolve([]),

					// AD availability checks with concurrency limit
					services.includes('AD')
						? processWithConcurrency(
								adTargets,
								async (result: SearchResult) => {
									try {
										let addAdResponse: any;
										if (`ad:${result.hash}` in hashAndProgress) {
											await deleteAd(result.hash);
										}
										addAdResponse = await addAd(result.hash, true);
										await deleteAd(result.hash);

										// Check if addAd returned a response and is cached
										const isCachedInAD =
											addAdResponse &&
											addAdResponse.id &&
											addAdResponse.statusCode === 4 &&
											addAdResponse.status === 'Ready';

										if (isCachedInAD) {
											realtimeAvailable.AD++;
										}

										return { result, isCachedInAD };
									} catch (error) {
										console.error(
											`Failed AD check for ${result.title}:`,
											error
										);
										throw error;
									} finally {
										removeChecking(result.hash, ['AD']);
									}
								},
								3,
								(completed: number, total: number) => {
									checkProgress.AD = { completed, total };
									updateProgressMessage();
								}
							)
						: Promise.resolve([]),

					// TorBox availability checks (read-only batch via checkcached)
					services.includes('TB')
						? (async () => {
								const batchSize = 100;
								const allCached: Record<string, any> = {};
								for (let i = 0; i < tbTargets.length; i += batchSize) {
									const batch = tbTargets.slice(i, i + batchSize);
									const resp = await checkCachedStatus(
										{
											hash: batch.map((t) => t.hash),
											format: 'object',
											list_files: true,
										},
										torboxKey!
									);
									if (resp.success && resp.data) {
										Object.assign(allCached, resp.data as any);
									}
									checkProgress.TB = {
										completed: Math.min(i + batchSize, tbTargets.length),
										total: tbTargets.length,
									};
									updateProgressMessage();
								}

								return tbTargets.map((result) => {
									const entry = allCached[result.hash];
									const isCachedInTB =
										!!entry &&
										Array.isArray(entry.files) &&
										entry.files.length > 0;
									if (isCachedInTB) realtimeAvailable.TB++;
									removeChecking(result.hash, ['TB']);
									return {
										item: result,
										success: true,
										result: { result, isCachedInTB },
									};
								});
							})()
						: Promise.resolve([]),

					// Premiumize availability checks. One POST answers up to
					// 1,000 hashes and adds nothing to the account, so this is
					// the cheapest of the four by an order of magnitude - a
					// whole page of results is usually a single request.
					services.includes('PM')
						? (async () => {
								const cached = new Set<string>();
								for (let i = 0; i < pmTargets.length; i += CACHE_CHECK_CHUNK_SIZE) {
									const batch = pmTargets.slice(i, i + CACHE_CHECK_CHUNK_SIZE);
									const probes = await checkPremiumizeCache(
										premiumizeKey!,
										batch.map((t) => t.hash)
									);
									for (const probe of probes) {
										if (probe.cached) cached.add(probe.hash.toLowerCase());
									}
									checkProgress.PM = {
										completed: Math.min(
											i + CACHE_CHECK_CHUNK_SIZE,
											pmTargets.length
										),
										total: pmTargets.length,
									};
									updateProgressMessage();
								}

								return pmTargets.map((result) => {
									const isCachedInPM = cached.has(result.hash.toLowerCase());
									if (isCachedInPM) realtimeAvailable.PM++;
									removeChecking(result.hash, ['PM']);
									return {
										item: result,
										success: true,
										result: { result, isCachedInPM },
									};
								});
							})()
						: Promise.resolve([]),

					// Offcloud availability checks. Same shape as Premiumize's -
					// one batch POST, nothing added to the account - but the
					// reply carries hits only, so `checkOffcloudCache` rebuilds
					// per-hash answers by set membership and a miss is simply an
					// absent hash. Kept as its own request even though Offcloud
					// serves Premiumize's cache: separate keys, separate outages.
					services.includes('OC')
						? (async () => {
								const cached = new Set<string>();
								for (
									let i = 0;
									i < ocTargets.length;
									i += OC_CACHE_CHECK_CHUNK_SIZE
								) {
									const batch = ocTargets.slice(i, i + OC_CACHE_CHECK_CHUNK_SIZE);
									const probes = await checkOffcloudCache(
										offcloudKey!,
										batch.map((t) => t.hash)
									);
									for (const probe of probes) {
										if (probe.cached) cached.add(probe.hash.toLowerCase());
									}
									checkProgress.OC = {
										completed: Math.min(
											i + OC_CACHE_CHECK_CHUNK_SIZE,
											ocTargets.length
										),
										total: ocTargets.length,
									};
									updateProgressMessage();
								}

								return ocTargets.map((result) => {
									const isCachedInOC = cached.has(result.hash.toLowerCase());
									if (isCachedInOC) realtimeAvailable.OC++;
									removeChecking(result.hash, ['OC']);
									return {
										item: result,
										success: true,
										result: { result, isCachedInOC },
									};
								});
							})()
						: Promise.resolve([]),

					// Tracker stats checks (only for non-available torrents)
					(async () => {
						if (!shouldIncludeTrackerStats()) {
							return [];
						}

						// Filter out torrents that are already available in any service
						const torrentsNeedingStats = torrentsToCheck.filter(
							(t) =>
								!t.rdAvailable &&
								!t.adAvailable &&
								!t.tbAvailable &&
								!t.pmAvailable &&
								!t.ocAvailable
						);

						if (torrentsNeedingStats.length === 0) {
							return [];
						}

						statsProgress.total = torrentsNeedingStats.length;
						updateProgressMessage();

						return processWithConcurrency(
							torrentsNeedingStats,
							async (result: SearchResult) => {
								try {
									// For bulk checks, use 72-hour cache to reduce load
									const trackerStats = await getCachedTrackerStats(
										result.hash,
										72,
										false
									);
									if (trackerStats) {
										result.trackerStats = {
											seeders: trackerStats.seeders,
											leechers: trackerStats.leechers,
											downloads: trackerStats.downloads,
											hasActivity:
												trackerStats.seeders >= 1 &&
												trackerStats.leechers + trackerStats.downloads >= 1,
										};

										// Count torrents with seeds
										if (trackerStats.seeders > 0) {
											torrentsWithSeeds++;
										}
									}
									return { result, trackerStats };
								} catch (error) {
									console.error(
										`Failed to get tracker stats for ${result.title}:`,
										error
									);
									return { result, trackerStats: null };
								}
							},
							5, // Higher concurrency for tracker stats since they're lighter
							(completed: number, total: number) => {
								statsProgress = { completed, total };
								updateProgressMessage();
							}
						);
					})(),
				]);

				// Filter out tracker stats for torrents that turned out to be cached
				const cachedHashes = new Set([
					...rdCheckResults
						.filter((r) => r.success && r.result?.isCachedInRD)
						.map((r) => r.item.hash),
					...adCheckResults
						.filter((r) => r.success && r.result?.isCachedInAD)
						.map((r) => r.item.hash),
					...tbCheckResults
						.filter((r) => r.success && r.result?.isCachedInTB)
						.map((r) => r.item.hash),
					...pmCheckResults
						.filter((r) => r.success && r.result?.isCachedInPM)
						.map((r) => r.item.hash),
					...ocCheckResults
						.filter((r) => r.success && r.result?.isCachedInOC)
						.map((r) => r.item.hash),
				]);

				// Apply tracker stats only to non-cached torrents
				trackerStatsResults.forEach((statsResult: any) => {
					if (
						statsResult.success &&
						statsResult.result?.trackerStats &&
						!cachedHashes.has(statsResult.item.hash)
					) {
						// Stats will already be set on the result object
					} else if (statsResult.success && cachedHashes.has(statsResult.item.hash)) {
						// Clear tracker stats for cached torrents
						delete statsResult.item.trackerStats;
					}
				});

				const allResults = [
					...rdCheckResults,
					...adCheckResults,
					...tbCheckResults,
					...pmCheckResults,
					...ocCheckResults,
				];
				const succeeded = allResults.filter((r) => r.success);
				const failed = allResults.filter((r) => !r.success);

				if (progressToast && isMounted.current) {
					toast.dismiss(progressToast);
				}

				const availableByService: Record<DebridService, number> = {
					RD: 0,
					AD: 0,
					TB: 0,
					PM: 0,
					OC: 0,
				};

				// Update database cache and get final count
				if (succeeded.length > 0 && isMounted.current) {
					const rdSuccessfulHashes = rdCheckResults
						.filter((r) => r.success && r.result?.isCachedInRD)
						.map((r) => r.item.hash);
					const adSuccessfulHashes = adCheckResults
						.filter((r) => r.success && r.result?.isCachedInAD)
						.map((r) => r.item.hash);
					const tbSuccessfulHashes = tbCheckResults
						.filter((r) => r.success && r.result?.isCachedInTB)
						.map((r) => r.item.hash);
					const pmSuccessfulHashes = pmCheckResults
						.filter((r) => r.success && r.result?.isCachedInPM)
						.map((r) => r.item.hash);
					const ocSuccessfulHashes = ocCheckResults
						.filter((r) => r.success && r.result?.isCachedInOC)
						.map((r) => r.item.hash);

					const positiveAvailability: Partial<Record<DebridService, Set<string>>> = {};
					if (rdSuccessfulHashes.length > 0) {
						positiveAvailability.RD = new Set(rdSuccessfulHashes);
						availableByService.RD = rdSuccessfulHashes.length;
					}
					if (adSuccessfulHashes.length > 0) {
						positiveAvailability.AD = new Set(adSuccessfulHashes);
						availableByService.AD = adSuccessfulHashes.length;
					}
					if (pmSuccessfulHashes.length > 0) {
						positiveAvailability.PM = new Set(pmSuccessfulHashes);
						availableByService.PM = pmSuccessfulHashes.length;
					}
					if (ocSuccessfulHashes.length > 0) {
						positiveAvailability.OC = new Set(ocSuccessfulHashes);
						availableByService.OC = ocSuccessfulHashes.length;
					}
					if (tbSuccessfulHashes.length > 0) {
						positiveAvailability.TB = new Set(tbSuccessfulHashes);
						availableByService.TB = tbSuccessfulHashes.length;
					}

					if (Object.keys(positiveAvailability).length > 0) {
						markAvailableServices(setSearchResults, sortFunction, positiveAvailability);
					}

					// Clear stale transfer badges for hashes RD says are not cached
					// `addRdResponse === null` means RD never answered the probe
					// (its 451 throttle, most often, which this sweep earns for
					// itself) — that is not RD saying the content is gone, and
					// `removeDebridTransfer` is keyed by hash alone, so acting on
					// it retires a working transfer for every user.
					const staleTransferHashes = rdCheckResults
						.filter(
							(r) =>
								r.success &&
								!r.result?.isCachedInRD &&
								Boolean(r.result?.addRdResponse) &&
								r.item.tbTransferred
						)
						.map((r) => r.item.hash);
					if (staleTransferHashes.length > 0) {
						const staleSet = new Set(staleTransferHashes);
						setSearchResults((prev) =>
							prev.map((r) =>
								staleSet.has(r.hash)
									? { ...r, tbTransferred: false, tbTransferredHash: undefined }
									: r
							)
						);
						for (const hash of staleTransferHashes) {
							fetch('/api/debrid-uploader/unregister', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ hash }),
							}).catch(() => {});
						}
					}

					// Update RD database cache
					if (rdKey && services.includes('RD') && rdSuccessfulHashes.length > 0) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						const dbAvailableCount = await checkDatabaseAvailabilityRd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							rdSuccessfulHashes,
							setSearchResults,
							sortFunction
						);
						availableByService.RD = Math.max(
							availableByService.RD,
							dbAvailableCount ?? 0
						);
					}

					// Update AD database cache
					if (adKey && services.includes('AD') && adSuccessfulHashes.length > 0) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						const dbAvailableCount = await checkDatabaseAvailabilityAd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							adSuccessfulHashes,
							setSearchResults,
							sortFunction
						);
						availableByService.AD = Math.max(
							availableByService.AD,
							dbAvailableCount ?? 0
						);
					}

					// Update TorBox database cache
					if (torboxKey && services.includes('TB') && tbSuccessfulHashes.length > 0) {
						const dbAvailableCount = await checkDatabaseAvailabilityTb(
							torboxKey,
							tbSuccessfulHashes,
							setSearchResults,
							sortFunction
						);
						availableByService.TB = Math.max(
							availableByService.TB,
							dbAvailableCount ?? 0
						);
					}
				}

				// Update search results with tracker stats for torrents that have them
				if (isMounted.current) {
					setSearchResults((prevResults) => {
						return prevResults.map((r) => {
							const torrentWithStats = torrentsToCheck.find((t) => t.hash === r.hash);
							if (torrentWithStats && torrentWithStats.trackerStats) {
								return {
									...r,
									trackerStats: torrentWithStats.trackerStats,
								};
							}
							return r;
						});
					});
				}

				const totalCount = torrentsToCheck.length;
				const availableSummaryParts = services
					.map((service) =>
						availableByService[service] > 0
							? `${service}: ${availableByService[service]}`
							: null
					)
					.filter(Boolean);
				const availableSummary =
					availableSummaryParts.length > 0 ? availableSummaryParts.join(', ') : '0';

				// Say so when RD stopped answering. Silently reporting the
				// remaining rows as "not available" is what teaches people the
				// content is gone when RD is only refusing to be asked.
				if (rdAbandoned) {
					toast.error(
						`RD is throttling adds — stopped after ${rdProbesStarted} of ${rdTargets.length}. ${rdUnprobed} left unchecked; try again in a minute.`,
						{ duration: 8000 }
					);
				}

				if (failed.length > 0) {
					toast.error(
						`${servicesLabel}: failed to check ${failed.length}/${totalCount}; ${availableSummary} available.`,
						{ duration: 5000 }
					);
				} else {
					toast.success(
						`${servicesLabel}: checked ${totalCount - rdUnprobed}; ${availableSummary} available.`,
						{ duration: 3000 }
					);
				}
			} catch (error) {
				if (progressToast && isMounted.current) {
					toast.dismiss(progressToast);
				}
				if (isMounted.current) {
					toast.error(`${servicesLabel}: service check failed.`);
				}
				console.error('Service check error:', error);
			}
		},
		[
			imdbId,
			rdKey,
			adKey,
			torboxKey,
			premiumizeKey,
			offcloudKey,
			setSearchResults,
			hashAndProgress,
			addRd,
			addAd,
			deleteRd,
			deleteAd,
			sortFunction,
			isAnyChecking,
			resolveServicesToCheck,
			isServiceAvailable,
			addChecking,
			removeChecking,
		]
	);

	return {
		isAnyChecking,
		isHashServiceChecking,
		checkServiceAvailability,
		checkServiceAvailabilityBulk,
	};
}
