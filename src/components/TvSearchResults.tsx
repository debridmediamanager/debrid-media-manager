import type { DebridService } from '@/hooks/useAvailabilityCheck';
import { FileData, SearchResult } from '@/services/mediasearch';
import { downloadMagnetFile } from '@/utils/downloadMagnet';
import { getEpisodeCountClass, getEpisodeCountLabel } from '@/utils/episodeUtils';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize, totalFileSize } from '@/utils/results';
import {
	getBiggestVideoFile,
	openWatch,
	pickWatchService,
	WATCH_SERVICE_LABEL,
} from '@/utils/watchService';
import {
	Cast,
	Download,
	Eye as EyeIcon,
	Folder,
	HandHeart,
	Link2,
	Loader2,
	Search as SearchIcon,
	Send,
	X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ReportButton from './ReportButton';

// A rule between two action groups. Only rendered when the groups on both
// sides of it actually produced buttons, so a single-service user never sees
// a stray line.
const ActionSeparator = () => <hr data-action-separator="true" className="my-1 border-gray-600" />;

/**
 * The three states of an add button, written out in full.
 *
 * Tailwind only keeps class names it can find as literals in the source, so an
 * assembled one (`` `border-${color}-500` ``) is silently dropped from the
 * build. The older service blocks in this file still assemble theirs off
 * `btnColor` and render unstyled because of it - a latent bug, not a pattern to
 * copy.
 */
const addButtonClass = (avail: boolean, noVideos: boolean) =>
	avail
		? 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50'
		: noVideos
			? 'border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50'
			: 'border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50';

type TvSearchResultsProps = {
	filteredResults: SearchResult[];
	expectedEpisodeCount: number;
	onlyShowCached: boolean;
	episodeMaxSize: string;
	rdKey: string | null;
	adKey: string | null;
	torboxKey?: string | null;
	premiumizeKey?: string | null;
	offcloudKey?: string | null;
	/**
	 * Debrid-Link's OAuth token or pasted API token.
	 *
	 * Unlike every other key here it gates nothing but the buttons themselves:
	 * Debrid-Link has no cache probe, so there is no `dlAvailable` to consult and
	 * its add button is offered on every row.
	 */
	debridLinkKey?: string | null;
	player: string;
	hashAndProgress: Record<string, number>;
	handleShowInfo: (result: SearchResult) => void;
	handleCast: (hash: string, fileIds: string[]) => Promise<void>;
	handleCastTorBox?: (hash: string, fileIds: string[]) => Promise<void>;
	handleCastAllDebrid?: (hash: string, files: { filename: string }[]) => Promise<void>;
	handleCastPremiumize?: (hash: string) => Promise<void>;
	handleCastOffcloud?: (hash: string) => Promise<void>;
	handleCastDebridLink?: (hash: string) => Promise<void>;
	handleCopyMagnet: (hash: string) => void;
	checkServiceAvailability: (
		result: SearchResult,
		servicesToCheck?: DebridService[]
	) => Promise<void>;
	addRd: (hash: string) => Promise<void>;
	addAd: (hash: string) => Promise<void>;
	addTb: (hash: string) => Promise<void>;
	addPm: (hash: string) => Promise<void>;
	addOc: (hash: string) => Promise<void>;
	addDl?: (hash: string) => Promise<void>;
	sendTbToRd?: (hash: string) => Promise<void>;
	/**
	 * File a request for a release this account cannot fetch on its own.
	 *
	 * Absent unless the page decided the user has only Real-Debrid — the
	 * uploader needs a TorBox or AllDebrid key for the source side, so a user
	 * holding neither has no way to start a transfer themselves.
	 */
	requestContent?: (result: SearchResult) => Promise<void>;
	deleteRd: (hash: string) => Promise<void>;
	deleteAd: (hash: string) => Promise<void>;
	deleteTb: (hash: string) => Promise<void>;
	deletePm: (hash: string) => Promise<void>;
	deleteOc: (hash: string) => Promise<void>;
	deleteDl?: (hash: string) => Promise<void>;
	imdbId?: string;
	isHashServiceChecking: (hash: string, service: DebridService) => boolean;
};

const TvSearchResults: React.FC<TvSearchResultsProps> = ({
	filteredResults,
	expectedEpisodeCount,
	onlyShowCached,
	episodeMaxSize,
	rdKey,
	adKey,
	torboxKey,
	premiumizeKey,
	offcloudKey,
	debridLinkKey,
	player,
	hashAndProgress,
	handleShowInfo,
	handleCast,
	handleCastTorBox,
	handleCastAllDebrid,
	handleCastPremiumize,
	handleCastOffcloud,
	handleCastDebridLink,
	handleCopyMagnet,
	checkServiceAvailability,
	addRd,
	addAd,
	addTb,
	addPm,
	addOc,
	addDl,
	sendTbToRd,
	requestContent,
	deleteRd,
	deleteAd,
	deleteTb,
	deletePm,
	deleteOc,
	deleteDl,
	imdbId,
	isHashServiceChecking,
}) => {
	const [loadingHashes, setLoadingHashes] = useState<Set<string>>(new Set());
	const [sendingToRdHashes, setSendingToRdHashes] = useState<Set<string>>(new Set());
	const [castingHashes, setCastingHashes] = useState<Set<string>>(new Set());
	const [castingTbHashes, setCastingTbHashes] = useState<Set<string>>(new Set());
	const [castingAdHashes, setCastingAdHashes] = useState<Set<string>>(new Set());
	const [castingPmHashes, setCastingPmHashes] = useState<Set<string>>(new Set());
	const [castingOcHashes, setCastingOcHashes] = useState<Set<string>>(new Set());
	const [castingDlHashes, setCastingDlHashes] = useState<Set<string>>(new Set());
	const [watchingHashes, setWatchingHashes] = useState<Set<string>>(new Set());
	const [requestingHashes, setRequestingHashes] = useState<Set<string>>(new Set());
	const [downloadMagnets, setDownloadMagnets] = useState(false);

	useEffect(() => {
		const shouldDownloadMagnets =
			window.localStorage.getItem('settings:downloadMagnets') === 'true';
		setDownloadMagnets(shouldDownloadMagnets);
	}, []);

	const isDownloading = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] < 100;
	const isDownloaded = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] === 100;
	const inLibrary = (service: string, hash: string) => `${service}:${hash}` in hashAndProgress;
	const notInLibrary = (service: string, hash: string) =>
		!(`${service}:${hash}` in hashAndProgress);

	const handleAddRd = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await addRd(hash);
		} finally {
			setLoadingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleAddAd = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await addAd(hash);
		} finally {
			setLoadingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleRequest = async (result: SearchResult) => {
		if (!requestContent || requestingHashes.has(result.hash)) return;
		setRequestingHashes((prev) => new Set(prev).add(result.hash));
		try {
			await requestContent(result);
		} finally {
			setRequestingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(result.hash);
				return newSet;
			});
		}
	};

	const handleDeleteRd = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await deleteRd(hash);
		} finally {
			setLoadingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleDeleteAd = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await deleteAd(hash);
		} finally {
			setLoadingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const runSendToRd = async (hash: string, fn?: (hash: string) => Promise<void>) => {
		if (!fn || sendingToRdHashes.has(hash)) return;
		setSendingToRdHashes((prev) => new Set(prev).add(hash));
		try {
			await fn(hash);
		} finally {
			setSendingToRdHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};
	const handleSendTbToRd = (hash: string) => runSendToRd(hash, sendTbToRd);

	const handleCastWithLoading = async (hash: string, fileIds: string[]) => {
		if (castingHashes.has(hash)) return;
		setCastingHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCast(hash, fileIds);
		} finally {
			setCastingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastTorBoxWithLoading = async (hash: string, fileIds: string[]) => {
		if (!handleCastTorBox || castingTbHashes.has(hash)) return;
		setCastingTbHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastTorBox(hash, fileIds);
		} finally {
			setCastingTbHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastAllDebridWithLoading = async (hash: string, files: { filename: string }[]) => {
		if (!handleCastAllDebrid || castingAdHashes.has(hash)) return;
		setCastingAdHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastAllDebrid(hash, files);
		} finally {
			setCastingAdHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastPremiumizeWithLoading = async (hash: string) => {
		if (!handleCastPremiumize || castingPmHashes.has(hash)) return;
		setCastingPmHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastPremiumize(hash);
		} finally {
			setCastingPmHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastOffcloudWithLoading = async (hash: string) => {
		if (!handleCastOffcloud || castingOcHashes.has(hash)) return;
		setCastingOcHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastOffcloud(hash);
		} finally {
			setCastingOcHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastDebridLinkWithLoading = async (hash: string) => {
		if (!handleCastDebridLink || castingDlHashes.has(hash)) return;
		setCastingDlHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastDebridLink(hash);
		} finally {
			setCastingDlHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleMagnetAction = (hash: string) => {
		if (downloadMagnets) {
			downloadMagnetFile(hash);
		} else {
			handleCopyMagnet(hash);
		}
	};

	const EpisodeCountDisplay = ({
		result,
		videoCount,
	}: {
		result: SearchResult;
		videoCount: number;
	}) => (
		<span
			className="haptic-sm inline-flex cursor-pointer items-center rounded bg-black bg-opacity-50 px-2 py-1 hover:bg-opacity-75"
			onClick={() => handleShowInfo(result)}
		>
			<Folder className="mr-1 h-4 w-4" />
			{getEpisodeCountLabel(videoCount, expectedEpisodeCount)}
		</span>
	);

	const handleWatch = async (result: SearchResult) => {
		// The render-time and click-time service picks are two separate calls, and
		// both need every key: leaving one out of the second silently does nothing
		// on click, which is exactly what happened to Premiumize in 91aad488.
		const service = pickWatchService(result, {
			rdKey,
			adKey,
			torboxKey,
			premiumizeKey,
			offcloudKey,
		});
		if (!service) return;
		const biggest = getBiggestVideoFile(result);
		setWatchingHashes((prev) => new Set(prev).add(result.hash));
		try {
			await openWatch({
				service,
				player,
				hash: result.hash,
				keys: { rdKey, adKey, torboxKey, premiumizeKey, offcloudKey, debridLinkKey },
				fileName: biggest?.filename,
				fileId: biggest?.fileId,
				adInLibrary: inLibrary('ad', result.hash),
			});
		} finally {
			setWatchingHashes((prev) => {
				const next = new Set(prev);
				next.delete(result.hash);
				return next;
			});
		}
	};

	/**
	 * Watch through Debrid-Link, which `pickWatchService` can never choose.
	 *
	 * That is not an oversight: choosing needs an availability flag and
	 * Debrid-Link has no cache probe to set one from. Its watch button is offered
	 * on rows the user has already added instead, where the torrent is known to
	 * be in the account and the resolve is a re-add that returns the same id.
	 */
	const handleWatchDl = async (result: SearchResult) => {
		if (!debridLinkKey) return;
		const biggest = getBiggestVideoFile(result);
		setWatchingHashes((prev) => new Set(prev).add(result.hash));
		try {
			await openWatch({
				service: 'dl',
				player,
				hash: result.hash,
				keys: { rdKey, adKey, torboxKey, premiumizeKey, offcloudKey, debridLinkKey },
				fileName: biggest?.filename,
				fileId: biggest?.fileId,
			});
		} finally {
			setWatchingHashes((prev) => {
				const next = new Set(prev);
				next.delete(result.hash);
				return next;
			});
		}
	};

	return (
		<div className="mx-1 my-1 grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
			{filteredResults && filteredResults.length > 0
				? filteredResults.map((r: SearchResult, i: number) => {
						const downloaded =
							isDownloaded('rd', r.hash) ||
							isDownloaded('ad', r.hash) ||
							isDownloaded('tb', r.hash) ||
							isDownloaded('pm', r.hash) ||
							isDownloaded('oc', r.hash) ||
							isDownloaded('dl', r.hash);
						const downloading =
							isDownloading('rd', r.hash) ||
							isDownloading('ad', r.hash) ||
							isDownloading('tb', r.hash) ||
							isDownloading('pm', r.hash) ||
							isDownloading('oc', r.hash) ||
							// Debrid-Link contributes to the library state but never
							// to the availability flags beside it - it has no cache
							// probe to set one.
							isDownloading('dl', r.hash);
						const inYourLibrary = downloaded || downloading;

						if (
							onlyShowCached &&
							!r.rdAvailable &&
							!r.adAvailable &&
							!r.tbAvailable &&
							!r.pmAvailable &&
							!r.ocAvailable &&
							!inYourLibrary
						)
							return null;
						if (
							episodeMaxSize !== '0' &&
							(r.medianFileSize ?? r.fileSize) > parseFloat(episodeMaxSize) * 1024 &&
							!inYourLibrary
						)
							return null;

						const rdColor = btnColor(r.rdAvailable, r.noVideos);
						const adColor = btnColor(r.adAvailable, r.noVideos);
						let epRegex1 = /S(\d+)\s?E(\d+)/i;
						let epRegex2 = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
						const episodeFilesOf = (files: FileData[] | undefined) =>
							(files ?? []).filter(
								(f) => f.filename.match(epRegex1) || f.filename.match(epRegex2)
							);
						const castableFiles = episodeFilesOf(r.files);
						// `r.files` holds whichever availability check answered last, and
						// the four run concurrently. RD file ids and TorBox file ids are
						// different numbering systems, so each cast button reads its own
						// provider's array - see the same reasoning in `pickRdLink`.
						const castableRdFileIds = episodeFilesOf(r.rdFiles).map(
							(f) => `${f.fileId}`
						);
						const castableTbFileIds = episodeFilesOf(r.tbFiles).map(
							(f) => `${f.fileId}`
						);
						// AllDebrid casts by filename, so it is unaffected by the above.
						const castableAdFiles = castableFiles.map((f) => ({
							filename: f.filename.split('/').pop() || f.filename,
						}));

						const isLoading = loadingHashes.has(r.hash);
						const isSendingToRd = sendingToRdHashes.has(r.hash);
						const isCasting = castingHashes.has(r.hash);
						const isCastingTb = castingTbHashes.has(r.hash);
						const isRequesting = requestingHashes.has(r.hash);
						const isCastingAd = castingAdHashes.has(r.hash);
						const isCastingPm = castingPmHashes.has(r.hash);
						const isCastingOc = castingOcHashes.has(r.hash);
						const isCastingDl = castingDlHashes.has(r.hash);
						const isCheckingRd = isHashServiceChecking(r.hash, 'RD');
						const isCheckingAd = isHashServiceChecking(r.hash, 'AD');
						const watchService = pickWatchService(r, {
							rdKey,
							adKey,
							torboxKey,
							premiumizeKey,
							offcloudKey,
						});
						const isWatching = watchingHashes.has(r.hash);

						return (
							<div
								key={i}
								className={`border-2 border-gray-700 ${borderColor(downloaded, downloading)} ${getEpisodeCountClass(r.videoCount, expectedEpisodeCount, r.rdAvailable || r.adAvailable || r.tbAvailable || r.pmAvailable || r.ocAvailable)} overflow-hidden rounded-lg bg-opacity-30 shadow transition-shadow duration-200 ease-in hover:shadow-lg`}
							>
								<div className="space-y-2 p-1">
									<h2 className="line-clamp-2 overflow-hidden text-ellipsis break-words text-sm font-bold leading-tight">
										{r.title}
									</h2>

									{r.videoCount > 0 ? (
										<div className="text-xs text-gray-300">
											<EpisodeCountDisplay
												result={r}
												videoCount={r.videoCount}
											/>
											<span className="ml-2">
												Total: {fileSize(totalFileSize(r))} GB; Median:{' '}
												{fileSize(r.medianFileSize)} GB
												{r.trackerStats &&
													!r.rdAvailable &&
													!r.adAvailable &&
													!r.tbAvailable &&
													!r.pmAvailable &&
													!r.ocAvailable &&
													(r.trackerStats.seeders > 0 ? (
														<span className="text-green-400">
															{' '}
															• Has seeders
														</span>
													) : (
														<span className="text-red-400">
															{' '}
															• No seeders
														</span>
													))}
											</span>
										</div>
									) : (
										<div className="text-xs text-gray-300">
											Total: {fileSize(totalFileSize(r))} GB
											{r.trackerStats &&
												!r.rdAvailable &&
												!r.adAvailable &&
												!r.tbAvailable &&
												!r.pmAvailable &&
												!r.ocAvailable &&
												(r.trackerStats.hasActivity ? (
													<span className="text-green-400">
														{' '}
														• Has seeders
													</span>
												) : (
													<span className="text-red-400">
														{' '}
														• No seeders
													</span>
												))}
										</div>
									)}

									<div className="space-x-1 space-y-1">
										{/* — RD — */}
										{rdKey && inLibrary('rd', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => handleDeleteRd(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `RD (${hashAndProgress[`rd:${r.hash}`] + '%'})`}
											</button>
										)}
										{rdKey && notInLibrary('rd', r.hash) && (
											<button
												className={`border-2 border-${rdColor}-500 bg-${rdColor}-900/30 text-${rdColor}-100 hover:bg-${rdColor}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => handleAddRd(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													btnIcon(r.rdAvailable)
												)}
												{isLoading
													? 'Adding...'
													: btnLabel(r.rdAvailable, 'RD')}
											</button>
										)}
										{rdKey &&
											(torboxKey || adKey) &&
											r.tbTransferred &&
											!r.rdAvailable && (
												<span
													className="inline rounded border-2 border-indigo-500/50 bg-indigo-900/20 px-1 text-xs text-indigo-300"
													title="Already in Real-Debrid via a transfer — use its Instant RD result for this title."
												>
													<span className="inline-flex items-center">
														<Send className="mr-1 h-3 w-3 text-indigo-400" />
														In RD
													</span>
												</span>
											)}
										{rdKey && r.rdAvailable && castableRdFileIds.length > 0 && (
											<button
												className={`haptic-sm inline rounded border-2 border-green-500 bg-green-900/30 px-1 text-xs text-green-100 transition-colors hover:bg-green-800/50 ${isCasting ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() =>
													handleCastWithLoading(r.hash, castableRdFileIds)
												}
												disabled={isCasting}
											>
												{isCasting ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Casting...
													</>
												) : (
													<>
														<Cast className="mr-1 inline-block h-3 w-3 text-green-400" />
														Cast (RD)
													</>
												)}
											</button>
										)}
										{rdKey && !r.rdAvailable && (
											<button
												className={`haptic-sm inline rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 ${isCheckingRd ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => checkServiceAvailability(r, ['RD'])}
												disabled={isCheckingRd}
											>
												{isCheckingRd ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Checking RD...
													</>
												) : (
													<>
														<SearchIcon className="mr-1 inline-block h-3 w-3 text-yellow-400" />
														Check RD
													</>
												)}
											</button>
										)}
										{rdKey && adKey && <ActionSeparator />}

										{/* — AD — */}
										{adKey && inLibrary('ad', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => handleDeleteAd(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `AD (${hashAndProgress[`ad:${r.hash}`] + '%'})`}
											</button>
										)}
										{adKey && notInLibrary('ad', r.hash) && (
											<button
												className={`border-2 border-${adColor}-500 bg-${adColor}-900/30 text-${adColor}-100 hover:bg-${adColor}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => handleAddAd(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													btnIcon(r.adAvailable)
												)}
												{isLoading
													? 'Adding...'
													: btnLabel(r.adAvailable, 'AD')}
											</button>
										)}
										{adKey &&
											handleCastAllDebrid &&
											r.adAvailable &&
											castableAdFiles.length > 0 && (
												<button
													className={`haptic-sm inline rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 ${isCastingAd ? 'cursor-not-allowed opacity-50' : ''}`}
													onClick={() =>
														handleCastAllDebridWithLoading(
															r.hash,
															castableAdFiles
														)
													}
													disabled={isCastingAd}
												>
													{isCastingAd ? (
														<>
															<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
															Casting...
														</>
													) : (
														<>
															<Cast className="mr-1 inline-block h-3 w-3 text-yellow-400" />
															Cast (AD)
														</>
													)}
												</button>
											)}
										{adKey && !r.adAvailable && (
											<button
												className={`haptic-sm inline rounded border-2 border-orange-500 bg-orange-900/30 px-1 text-xs text-orange-100 transition-colors hover:bg-orange-800/50 ${isCheckingAd ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => checkServiceAvailability(r, ['AD'])}
												disabled={isCheckingAd}
											>
												{isCheckingAd ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Checking AD...
													</>
												) : (
													<>
														<SearchIcon className="mr-1 inline-block h-3 w-3 text-orange-400" />
														Check AD
													</>
												)}
											</button>
										)}

										{(rdKey || adKey) && torboxKey && <ActionSeparator />}

										{/* — TB — */}
										{torboxKey && inLibrary('tb', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => deleteTb(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `TB (${hashAndProgress[`tb:${r.hash}`] + '%'})`}
											</button>
										)}
										{torboxKey && notInLibrary('tb', r.hash) && (
											<button
												className={`border-2 border-${btnColor(r.tbAvailable, r.noVideos)}-500 bg-${btnColor(r.tbAvailable, r.noVideos)}-900/30 text-${btnColor(r.tbAvailable, r.noVideos)}-100 hover:bg-${btnColor(r.tbAvailable, r.noVideos)}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => addTb(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													btnIcon(r.tbAvailable)
												)}
												{isLoading
													? 'Adding...'
													: btnLabel(r.tbAvailable, 'TB')}
											</button>
										)}
										{rdKey &&
											torboxKey &&
											sendTbToRd &&
											r.tbAvailable &&
											!r.rdAvailable &&
											!r.tbTransferred &&
											notInLibrary('rd', r.hash) && (
												<button
													className={`haptic-sm inline rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50 ${isSendingToRd ? 'cursor-not-allowed opacity-50' : ''}`}
													onClick={() => handleSendTbToRd(r.hash)}
													disabled={isSendingToRd}
												>
													{isSendingToRd ? (
														<>
															<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
															Sending...
														</>
													) : (
														<>
															<Send className="mr-1 inline-block h-3 w-3 text-indigo-400" />
															TB → RD
														</>
													)}
												</button>
											)}
										{torboxKey &&
											handleCastTorBox &&
											r.tbAvailable &&
											castableTbFileIds.length > 0 && (
												<button
													className={`haptic-sm inline rounded border-2 border-purple-500 bg-purple-900/30 px-1 text-xs text-purple-100 transition-colors hover:bg-purple-800/50 ${isCastingTb ? 'cursor-not-allowed opacity-50' : ''}`}
													onClick={() =>
														handleCastTorBoxWithLoading(
															r.hash,
															castableTbFileIds
														)
													}
													disabled={isCastingTb}
												>
													{isCastingTb ? (
														<>
															<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
															Casting...
														</>
													) : (
														<>
															<Cast className="mr-1 inline-block h-3 w-3 text-purple-400" />
															Cast (TB)
														</>
													)}
												</button>
											)}

										{(rdKey || adKey || torboxKey) && premiumizeKey && (
											<ActionSeparator />
										)}

										{/* — PM — */}
										{premiumizeKey && inLibrary('pm', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => deletePm(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `PM (${hashAndProgress[`pm:${r.hash}`] + '%'})`}
											</button>
										)}
										{premiumizeKey && notInLibrary('pm', r.hash) && (
											<button
												className={`border-2 border-${btnColor(r.pmAvailable, r.noVideos)}-500 bg-${btnColor(r.pmAvailable, r.noVideos)}-900/30 text-${btnColor(r.pmAvailable, r.noVideos)}-100 hover:bg-${btnColor(r.pmAvailable, r.noVideos)}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => addPm(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													btnIcon(r.pmAvailable)
												)}
												{isLoading
													? 'Adding...'
													: btnLabel(r.pmAvailable, 'PM')}
											</button>
										)}
										{/* No `castableAdFiles` gate: Premiumize's cache probe
										    returns no file listing, so this browser may know of
										    no episodes at all. The server resolves them. */}
										{premiumizeKey && handleCastPremiumize && r.pmAvailable && (
											<button
												className={`haptic-sm inline rounded border-2 border-[#aa0000] bg-[#aa0000]/30 px-1 text-xs text-red-100 transition-colors hover:bg-[#aa0000]/50 ${isCastingPm ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() =>
													handleCastPremiumizeWithLoading(r.hash)
												}
												disabled={isCastingPm}
											>
												{isCastingPm ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Casting...
													</>
												) : (
													<>
														<Cast className="mr-1 inline-block h-3 w-3 text-red-400" />
														Cast (PM)
													</>
												)}
											</button>
										)}

										{(rdKey || adKey || torboxKey || premiumizeKey) &&
											offcloudKey && <ActionSeparator />}

										{/* — OC —
										    No "Check OC" button on purpose: the
										    page-load sweep already probed every row
										    with the same `/cache` call, so a per-row
										    repeat finds nothing new. Premiumize had
										    one and it was removed in d3d6dd49 for
										    exactly that reason. */}
										{offcloudKey && inLibrary('oc', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => deleteOc(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `OC (${hashAndProgress[`oc:${r.hash}`] + '%'})`}
											</button>
										)}
										{offcloudKey && notInLibrary('oc', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 px-1 text-xs transition-colors ${addButtonClass(r.ocAvailable, r.noVideos)} ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => addOc(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													btnIcon(r.ocAvailable)
												)}
												{isLoading
													? 'Adding...'
													: btnLabel(r.ocAvailable, 'OC')}
											</button>
										)}

										{/* No file-list gate, the same as Premiumize's: the
										    episodes are resolved server-side out of one
										    `cache/info`, so this browser needing to know
										    them first would make Cast (OC) a movies-only
										    button. */}
										{offcloudKey && handleCastOffcloud && r.ocAvailable && (
											<button
												className={`haptic-sm inline rounded border-2 border-[#f97316] bg-[#f97316]/30 px-1 text-xs text-orange-100 transition-colors hover:bg-[#f97316]/50 ${isCastingOc ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() =>
													handleCastOffcloudWithLoading(r.hash)
												}
												disabled={isCastingOc}
											>
												{isCastingOc ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Casting...
													</>
												) : (
													<>
														<Cast className="mr-1 inline-block h-3 w-3 text-orange-400" />
														Cast (OC)
													</>
												)}
											</button>
										)}

										{(rdKey ||
											adKey ||
											torboxKey ||
											premiumizeKey ||
											offcloudKey) &&
											debridLinkKey && <ActionSeparator />}

										{/* — DL —
										    The add button renders on **every** row,
										    and no badge, pill or "Check DL" goes
										    with it. Debrid-Link retired
										    `/seedbox/cached` and put nothing in its
										    place, so its only remaining cache probe
										    is a mutating add — there is nothing to
										    check with, and a permanently-false
										    `dlAvailable` would lie to the pills, the
										    sorts and `pickWatchService` alike. The
										    add is the probe: it sends the full
										    magnet, so a cached release comes back
										    playable in one request and an uncached
										    one downloads for real. */}
										{debridLinkKey && inLibrary('dl', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => deleteDl?.(r.hash)}
												disabled={isLoading}
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<X className="mr-2 inline h-3 w-3" />
												)}
												{isLoading
													? 'Removing...'
													: `DL (${hashAndProgress[`dl:${r.hash}`] + '%'})`}
											</button>
										)}
										{debridLinkKey && notInLibrary('dl', r.hash) && (
											<button
												className={`haptic-sm inline rounded border-2 border-[#38bdf8] bg-[#38bdf8]/20 px-1 text-xs text-sky-100 transition-colors hover:bg-[#38bdf8]/40 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() => addDl?.(r.hash)}
												disabled={isLoading}
												title="Debrid-Link has no cache check — adding is the only way to find out, and an uncached release downloads for real"
											>
												{isLoading ? (
													<span className="inline-block animate-spin">
														⌛
													</span>
												) : (
													<Download className="mr-2 inline h-3 w-3" />
												)}
												{isLoading ? 'Adding...' : 'Add to DL'}
											</button>
										)}
										{/* No file-list gate and no availability gate.
										    The episodes are resolved server-side out of
										    one `seedbox/add`, so this browser needing to
										    know them first would make Cast (DL) a
										    movies-only button — and Debrid-Link
										    publishes no cache probe at all, so there is
										    no `dlAvailable` to gate on either. */}
										{debridLinkKey && handleCastDebridLink && (
											<button
												className={`haptic-sm inline rounded border-2 border-[#38bdf8] bg-[#38bdf8]/20 px-1 text-xs text-sky-100 transition-colors hover:bg-[#38bdf8]/40 ${isCastingDl ? 'cursor-not-allowed opacity-50' : ''}`}
												onClick={() =>
													handleCastDebridLinkWithLoading(r.hash)
												}
												disabled={isCastingDl}
												title="Debrid-Link has no cache check — casting adds the release, and an uncached one downloads for real"
											>
												{isCastingDl ? (
													<>
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
														Casting...
													</>
												) : (
													<>
														<Cast className="mr-1 inline-block h-3 w-3 text-sky-400" />
														Cast (DL)
													</>
												)}
											</button>
										)}

										{debridLinkKey && inLibrary('dl', r.hash) && player && (
											<button
												className={`haptic-sm inline rounded border-2 border-[#38bdf8] bg-[#38bdf8]/20 px-1 text-xs text-sky-100 transition-colors hover:bg-[#38bdf8]/40 ${isWatching ? 'cursor-not-allowed opacity-50' : ''}`}
												title="Watch via Debrid-Link"
												onClick={() => handleWatchDl(r)}
												disabled={isWatching}
											>
												<>
													{isWatching ? (
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
													) : (
														<EyeIcon className="mr-1 inline-block h-3 w-3 text-sky-400" />
													)}
													Watch (DL)
												</>
											</button>
										)}

										{/* — Separator: everything above belongs to one service, everything below does not — */}
										{(rdKey ||
											adKey ||
											torboxKey ||
											premiumizeKey ||
											offcloudKey ||
											debridLinkKey) && <ActionSeparator />}

										{watchService && player && (
											<button
												className={`haptic-sm inline rounded border-2 border-teal-500 bg-teal-900/30 px-1 text-xs text-teal-100 transition-colors hover:bg-teal-800/50 ${isWatching ? 'cursor-not-allowed opacity-50' : ''}`}
												title={`Watch via ${WATCH_SERVICE_LABEL[watchService]}`}
												onClick={() => handleWatch(r)}
												disabled={isWatching}
											>
												<>
													{isWatching ? (
														<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
													) : (
														<EyeIcon className="mr-1 inline-block h-3 w-3 text-teal-400" />
													)}
													Watch
												</>
											</button>
										)}

										{/* — Generic — */}
										<button
											className="haptic-sm inline rounded border-2 border-pink-500 bg-pink-900/30 px-1 text-xs text-pink-100 transition-colors hover:bg-pink-800/50"
											onClick={() => handleMagnetAction(r.hash)}
										>
											<Link2 className="inline h-3 w-3 text-teal-400" />{' '}
											{downloadMagnets ? 'Download' : 'Copy'}
										</button>
										{requestContent &&
											!r.rdAvailable &&
											notInLibrary('rd', r.hash) && (
												<button
													className={`haptic-sm inline rounded border-2 border-cyan-500 bg-cyan-900/30 px-1 text-xs text-cyan-100 transition-colors hover:bg-cyan-800/50 ${isRequesting ? 'cursor-not-allowed opacity-50' : ''}`}
													onClick={() => handleRequest(r)}
													disabled={isRequesting}
													title="Ask someone with a TorBox or AllDebrid account to send this to your Real-Debrid"
												>
													{isRequesting ? (
														<>
															<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
															Requesting...
														</>
													) : (
														<>
															<HandHeart className="mr-1 inline-block h-3 w-3 text-cyan-400" />
															Request
														</>
													)}
												</button>
											)}
										<ReportButton
											hash={r.hash}
											imdbId={imdbId!}
											userId={rdKey || adKey || ''}
											isShow={true}
										/>
									</div>
								</div>
							</div>
						);
					})
				: null}
		</div>
	);
};

export default TvSearchResults;
