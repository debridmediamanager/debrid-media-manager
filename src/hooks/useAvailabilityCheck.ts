import { SearchResult } from '@/services/mediasearch';
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

export type DebridService = 'RD' | 'AD' | 'TB';

const formatServicesLabel = (services: DebridService[]) =>
	services.length ? services.join(' / ') : 'services';

const checkingKey = (hash: string, service: DebridService) => `${hash}:${service}`;

export function useAvailabilityCheck(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	imdbId: string,
	searchResults: SearchResult[],
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>,
	hashAndProgress: Record<string, number>,
	addRd: (hash: string, isCheckingAvailability: boolean) => Promise<any>,
	addAd: (hash: string, isCheckingAvailability: boolean) => Promise<any>,
	addTb: (hash: string, isCheckingAvailability: boolean) => Promise<any>,
	deleteRd: (hash: string) => Promise<void>,
	deleteAd: (hash: string) => Promise<void>,
	deleteTb: (hash: string) => Promise<void>,
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

			if (!requested || requested.length === 0) {
				return available;
			}

			const requestedSet = new Set(requested);
			return available.filter((service) => requestedSet.has(service));
		},
		[rdKey, adKey, torboxKey]
	);

	const isServiceAvailable = useCallback((service: DebridService, result: SearchResult) => {
		switch (service) {
			case 'RD':
				return Boolean(result.rdAvailable);
			case 'AD':
				return Boolean(result.adAvailable);
			case 'TB':
				return Boolean(result.tbAvailable);
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
			const servicesNeedingCheck = services.filter(
				(service) => !alreadyAvailableServices.includes(service)
			);

			if (servicesNeedingCheck.length === 0) {
				const cachedLabel = formatServicesLabel(alreadyAvailableServices);
				toast.success(`Already cached in ${cachedLabel}.`);
				return;
			}

			addChecking(result.hash, servicesNeedingCheck);

			const toastId = toast.loading(
				`Checking availability (${formatServicesLabel(servicesNeedingCheck)})...`
			);

			try {
				// Run checks in parallel for RD, AD, and TorBox
				const [rdCheckResult, adCheckResult, tbCheckResult, trackerStatsResult] =
					await Promise.allSettled([
						// RD availability check
						rdKey && servicesNeedingCheck.includes('RD')
							? (async () => {
									let addRdResponse: any;
									// Check if torrent is in progress
									if (`rd:${result.hash}` in hashAndProgress) {
										await deleteRd(result.hash);
										addRdResponse = await addRd(result.hash, true);
									} else {
										addRdResponse = await addRd(result.hash, true);
										await deleteRd(result.hash);
									}

									// Check if addRd found it cached (returns response with ID)
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
									// Check if torrent is in progress
									if (`ad:${result.hash}` in hashAndProgress) {
										await deleteAd(result.hash);
										addAdResponse = await addAd(result.hash, true);
									} else {
										addAdResponse = await addAd(result.hash, true);
										await deleteAd(result.hash);
									}

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

						// TorBox availability check
						torboxKey && servicesNeedingCheck.includes('TB')
							? (async () => {
									let addTbResponse: any;
									// Check if torrent is in progress
									if (`tb:${result.hash}` in hashAndProgress) {
										await deleteTb(result.hash);
										addTbResponse = await addTb(result.hash, true);
									} else {
										addTbResponse = await addTb(result.hash, true);
										await deleteTb(result.hash);
									}

									// Check if addTb found it cached
									const isCachedInTB =
										addTbResponse &&
										addTbResponse.id &&
										addTbResponse.download_finished;

									return { addTbResponse, isCachedInTB };
								})()
							: Promise.resolve({
									addTbResponse: null,
									isCachedInTB: Boolean(result.tbAvailable),
								}),

						// Tracker stats check (only if enabled and not already available)
						(async () => {
							if (
								!shouldIncludeTrackerStats() ||
								result.rdAvailable ||
								result.adAvailable ||
								result.tbAvailable
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
				if (rdCheckResult.status === 'fulfilled') {
					isCachedInRD = rdCheckResult.value.isCachedInRD;
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

				// Process tracker stats result (only if not cached in any service)
				if (
					trackerStatsResult.status === 'fulfilled' &&
					trackerStatsResult.value &&
					!isCachedInRD &&
					!isCachedInAD &&
					!isCachedInTB
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
					!isCachedInTB
				) {
					console.error('Failed to get tracker stats:', trackerStatsResult.reason);
				}

				toast.success(`Service check done (${formatServicesLabel(services)}).`, {
					id: toastId,
				});

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
			searchResults,
			setSearchResults,
			hashAndProgress,
			addRd,
			addAd,
			addTb,
			deleteRd,
			deleteAd,
			deleteTb,
			sortFunction,
			resolveServicesToCheck,
			isServiceAvailable,
			addChecking,
			removeChecking,
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
				`Starting ${servicesLabel} check for ${torrentsToCheck.length} torrents...`
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

			const checkProgress: Record<DebridService, { completed: number; total: number }> = {
				RD: { completed: 0, total: rdTargets.length },
				AD: { completed: 0, total: adTargets.length },
				TB: { completed: 0, total: tbTargets.length },
			};
			let statsProgress = { completed: 0, total: 0 };
			let torrentsWithSeeds = 0;
			const realtimeAvailable: Record<DebridService, number> = {
				RD: 0,
				AD: 0,
				TB: 0,
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
					toast.loading(parts.join(' | '), { id: progressToast });
				}
			};

			try {
				const [rdCheckResults, adCheckResults, tbCheckResults, trackerStatsResults] =
					await Promise.all([
						// RD availability checks with concurrency limit
						services.includes('RD')
							? processWithConcurrency(
									rdTargets,
									async (result: SearchResult) => {
										try {
											let addRdResponse: any;
											if (`rd:${result.hash}` in hashAndProgress) {
												await deleteRd(result.hash);
												addRdResponse = await addRd(result.hash, true);
											} else {
												addRdResponse = await addRd(result.hash, true);
												await deleteRd(result.hash);
											}

											// Check if addRd returned a response with an ID AND is truly available
											const isCachedInRD =
												addRdResponse &&
												addRdResponse.id &&
												addRdResponse.status === 'downloaded' &&
												addRdResponse.progress === 100;

											if (isCachedInRD) {
												realtimeAvailable.RD++;
											}

											return { result, isCachedInRD };
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
									3,
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
												addAdResponse = await addAd(result.hash, true);
											} else {
												addAdResponse = await addAd(result.hash, true);
												await deleteAd(result.hash);
											}

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

						// TorBox availability checks with concurrency limit
						services.includes('TB')
							? processWithConcurrency(
									tbTargets,
									async (result: SearchResult) => {
										try {
											let addTbResponse: any;
											if (`tb:${result.hash}` in hashAndProgress) {
												await deleteTb(result.hash);
												addTbResponse = await addTb(result.hash, true);
											} else {
												addTbResponse = await addTb(result.hash, true);
												await deleteTb(result.hash);
											}

											// Check if addTb returned a response and is cached
											const isCachedInTB =
												addTbResponse &&
												addTbResponse.id &&
												addTbResponse.download_finished;

											if (isCachedInTB) {
												realtimeAvailable.TB++;
											}

											return { result, isCachedInTB };
										} catch (error) {
											console.error(
												`Failed TorBox check for ${result.title}:`,
												error
											);
											throw error;
										} finally {
											removeChecking(result.hash, ['TB']);
										}
									},
									3,
									(completed: number, total: number) => {
										checkProgress.TB = { completed, total };
										updateProgressMessage();
									}
								)
							: Promise.resolve([]),

						// Tracker stats checks (only for non-available torrents)
						(async () => {
							if (!shouldIncludeTrackerStats()) {
								return [];
							}

							// Filter out torrents that are already available in any service
							const torrentsNeedingStats = torrentsToCheck.filter(
								(t) => !t.rdAvailable && !t.adAvailable && !t.tbAvailable
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
													trackerStats.leechers +
														trackerStats.downloads >=
														1,
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

				const allResults = [...rdCheckResults, ...adCheckResults, ...tbCheckResults];
				const succeeded = allResults.filter((r) => r.success);
				const failed = allResults.filter((r) => !r.success);

				if (progressToast && isMounted.current) {
					toast.dismiss(progressToast);
				}

				const availableByService: Record<DebridService, number> = {
					RD: 0,
					AD: 0,
					TB: 0,
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

					// Update RD database cache
					if (rdKey && services.includes('RD') && rdSuccessfulHashes.length > 0) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						availableByService.RD += await checkDatabaseAvailabilityRd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							rdSuccessfulHashes,
							setSearchResults,
							sortFunction
						);
					}

					// Update AD database cache
					if (adKey && services.includes('AD') && adSuccessfulHashes.length > 0) {
						const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
						availableByService.AD += await checkDatabaseAvailabilityAd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							adSuccessfulHashes,
							setSearchResults,
							sortFunction
						);
					}

					// Update TorBox database cache
					if (torboxKey && services.includes('TB') && tbSuccessfulHashes.length > 0) {
						availableByService.TB += await checkDatabaseAvailabilityTb(
							torboxKey,
							tbSuccessfulHashes,
							setSearchResults,
							sortFunction
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

				if (failed.length > 0) {
					toast.error(
						`${servicesLabel}: failed to check ${failed.length}/${totalCount}; ${availableSummary} available.`,
						{ duration: 5000 }
					);
				} else {
					toast.success(
						`${servicesLabel}: checked ${totalCount}; ${availableSummary} available.`,
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
			setSearchResults,
			hashAndProgress,
			addRd,
			addAd,
			addTb,
			deleteRd,
			deleteAd,
			deleteTb,
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
