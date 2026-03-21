import type { DebridService } from '@/hooks/useAvailabilityCheck';
import { SearchResult } from '@/services/mediasearch';
import { downloadMagnetFile } from '@/utils/downloadMagnet';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import {
	Cast,
	Eye as EyeIcon,
	Folder,
	Link2,
	Loader2,
	Search as SearchIcon,
	X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ReportButton from './ReportButton';

type MovieSearchResultsProps = {
	filteredResults: SearchResult[];
	onlyShowCached: boolean;
	movieMaxSize: string;
	rdKey: string | null;
	adKey: string | null;
	torboxKey: string | null;
	player: string;
	hashAndProgress: Record<string, number>;
	handleShowInfo: (result: SearchResult) => void;
	handleCast: (hash: string) => Promise<void>;
	handleCastTorBox?: (hash: string) => Promise<void>;
	handleCastAllDebrid?: (hash: string) => Promise<void>;
	handleCopyMagnet: (hash: string) => void;
	checkServiceAvailability: (
		result: SearchResult,
		servicesToCheck?: DebridService[]
	) => Promise<void>;
	addRd: (hash: string) => Promise<void>;
	addAd: (hash: string) => Promise<void>;
	addTb: (hash: string) => Promise<void>;
	deleteRd: (hash: string) => Promise<void>;
	deleteAd: (hash: string) => Promise<void>;
	deleteTb: (hash: string) => Promise<void>;
	imdbId?: string;
	isHashServiceChecking: (hash: string, service: DebridService) => boolean;
};

const MovieSearchResults = ({
	filteredResults,
	onlyShowCached,
	movieMaxSize,
	rdKey,
	adKey,
	torboxKey,
	player,
	hashAndProgress,
	handleShowInfo,
	handleCast,
	handleCastTorBox,
	handleCastAllDebrid,
	handleCopyMagnet,
	checkServiceAvailability,
	addRd,
	addAd,
	addTb,
	deleteRd,
	deleteAd,
	deleteTb,
	imdbId,
	isHashServiceChecking,
}: MovieSearchResultsProps) => {
	const [loadingHashes, setLoadingHashes] = useState<Set<string>>(new Set());
	const [castingHashes, setCastingHashes] = useState<Set<string>>(new Set());
	const [castingTbHashes, setCastingTbHashes] = useState<Set<string>>(new Set());
	const [castingAdHashes, setCastingAdHashes] = useState<Set<string>>(new Set());
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

	const handleAddTb = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await addTb(hash);
		} finally {
			setLoadingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
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

	const handleDeleteTb = async (hash: string) => {
		if (loadingHashes.has(hash)) return;
		setLoadingHashes((prev) => new Set(prev).add(hash));
		try {
			await deleteTb(hash);
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

	const handleCastWithLoading = async (hash: string) => {
		if (castingHashes.has(hash)) return;
		setCastingHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCast(hash);
		} finally {
			setCastingHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastTorBoxWithLoading = async (hash: string) => {
		if (!handleCastTorBox || castingTbHashes.has(hash)) return;
		setCastingTbHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastTorBox(hash);
		} finally {
			setCastingTbHashes((prev) => {
				const newSet = new Set(prev);
				newSet.delete(hash);
				return newSet;
			});
		}
	};

	const handleCastAllDebridWithLoading = async (hash: string) => {
		if (!handleCastAllDebrid || castingAdHashes.has(hash)) return;
		setCastingAdHashes((prev) => new Set(prev).add(hash));
		try {
			await handleCastAllDebrid(hash);
		} finally {
			setCastingAdHashes((prev) => {
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

	const getBiggestFileId = (result: SearchResult) => {
		if (!result.files || !result.files.length) return '';
		const biggestFile = result.files
			.filter((f) => isVideo({ path: f.filename }))
			.sort((a, b) => b.filesize - a.filesize)[0];
		return biggestFile?.fileId ?? '';
	};

	const getMovieCountLabel = (videoCount: number) => {
		if (videoCount === 1) return `Single`;
		return `With extras (${videoCount})`;
	};

	const getMovieCountClass = (videoCount: number, isInstantlyAvailable: boolean) => {
		if (!isInstantlyAvailable) return ''; // No color for unavailable torrents
		if (videoCount === 1) return 'bg-gray-800';
		return 'bg-blue-900';
	};

	return (
		<div className="mx-1 my-1 grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
			{filteredResults.map((r: SearchResult, i: number) => {
				const downloaded =
					isDownloaded('rd', r.hash) ||
					isDownloaded('ad', r.hash) ||
					isDownloaded('tb', r.hash);
				const downloading =
					isDownloading('rd', r.hash) ||
					isDownloading('ad', r.hash) ||
					isDownloading('tb', r.hash);
				const inYourLibrary = downloaded || downloading;

				if (
					onlyShowCached &&
					!r.rdAvailable &&
					!r.adAvailable &&
					!r.tbAvailable &&
					!inYourLibrary
				)
					return null;
				if (
					movieMaxSize !== '0' &&
					(r.biggestFileSize ?? r.fileSize) > parseInt(movieMaxSize) * 1024 &&
					!inYourLibrary
				)
					return null;

				const rdColor = btnColor(r.rdAvailable, r.noVideos);
				const adColor = btnColor(r.adAvailable, r.noVideos);
				const tbColor = btnColor(r.tbAvailable, r.noVideos);
				const isLoading = loadingHashes.has(r.hash);
				const isCasting = castingHashes.has(r.hash);
				const isCastingTb = castingTbHashes.has(r.hash);
				const isCastingAd = castingAdHashes.has(r.hash);
				const isCheckingRd = isHashServiceChecking(r.hash, 'RD');
				const isCheckingAd = isHashServiceChecking(r.hash, 'AD');
				const isCheckingTb = isHashServiceChecking(r.hash, 'TB');

				return (
					<div
						key={i}
						className={`border-2 border-gray-700 ${borderColor(downloaded, downloading)} ${getMovieCountClass(r.videoCount, r.rdAvailable || r.adAvailable || r.tbAvailable)} overflow-hidden rounded-lg bg-opacity-30 shadow transition-shadow duration-200 ease-in hover:shadow-lg`}
					>
						<div className="space-y-2 p-1">
							<h2 className="line-clamp-2 overflow-hidden text-ellipsis break-words text-sm font-bold leading-tight">
								{r.title}
							</h2>

							{r.videoCount > 0 ? (
								<div className="text-xs text-gray-300">
									<span
										className="haptic-sm inline-flex cursor-pointer items-center rounded bg-black bg-opacity-50 px-2 py-1 hover:bg-opacity-75"
										onClick={() => handleShowInfo(r)}
									>
										<Folder className="mr-1 h-4 w-4" />
										{getMovieCountLabel(r.videoCount)}
									</span>
									{r.videoCount > 1 ? (
										<span className="ml-2">
											Total: {fileSize(r.fileSize)} GB; Biggest:{' '}
											{fileSize(r.biggestFileSize)} GB
											{r.trackerStats &&
												!r.rdAvailable &&
												!r.adAvailable &&
												!r.tbAvailable &&
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
									) : (
										<span className="ml-2">
											Total: {fileSize(r.fileSize)} GB
											{r.trackerStats &&
												!r.rdAvailable &&
												!r.adAvailable &&
												!r.tbAvailable &&
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
									)}
								</div>
							) : (
								<div className="text-xs text-gray-300">
									Total: {fileSize(r.fileSize)} GB
									{r.trackerStats &&
										!r.rdAvailable &&
										!r.adAvailable &&
										!r.tbAvailable &&
										(r.trackerStats.seeders > 0 ? (
											<span className="text-green-400"> • Has seeders</span>
										) : (
											<span className="text-red-400"> • No seeders</span>
										))}
								</div>
							)}

							<div className="space-x-1 space-y-1">
								{/* RD download/delete */}
								{rdKey && inLibrary('rd', r.hash) && (
									<button
										className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleDeleteRd(r.hash)}
										disabled={isLoading}
									>
										{isLoading ? (
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
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
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
										) : (
											btnIcon(r.rdAvailable)
										)}
										{isLoading ? 'Adding...' : btnLabel(r.rdAvailable, 'RD')}
									</button>
								)}

								{/* AD download/delete */}
								{adKey && inLibrary('ad', r.hash) && (
									<button
										className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleDeleteAd(r.hash)}
										disabled={isLoading}
									>
										{isLoading ? (
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
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
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
										) : (
											btnIcon(r.adAvailable)
										)}
										{isLoading ? 'Adding...' : btnLabel(r.adAvailable, 'AD')}
									</button>
								)}

								{/* TorBox download/delete */}
								{torboxKey && inLibrary('tb', r.hash) && (
									<button
										className={`haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleDeleteTb(r.hash)}
										disabled={isLoading}
									>
										{isLoading ? (
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
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
										className={`border-2 border-${tbColor}-500 bg-${tbColor}-900/30 text-${tbColor}-100 hover:bg-${tbColor}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleAddTb(r.hash)}
										disabled={isLoading}
									>
										{isLoading ? (
											<Loader2 className="inline-block h-3 w-3 animate-spin" />
										) : (
											btnIcon(r.tbAvailable)
										)}
										{isLoading ? 'Adding...' : btnLabel(r.tbAvailable, 'TB')}
									</button>
								)}

								{/* Cast (RD) btn - only show if cached on RD */}
								{rdKey && r.rdAvailable && (
									<button
										className={`haptic-sm inline rounded border-2 border-green-500 bg-green-900/30 px-1 text-xs text-green-100 transition-colors hover:bg-green-800/50 ${isCasting ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleCastWithLoading(r.hash)}
										disabled={isCasting}
									>
										{isCasting ? (
											<>
												<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
												Casting...
											</>
										) : (
											<span className="inline-flex items-center">
												<Cast className="mr-1 h-3 w-3 text-green-400" />
												Cast (RD)
											</span>
										)}
									</button>
								)}

								{/* Cast (TB) btn - only show if cached on TB */}
								{torboxKey && handleCastTorBox && r.tbAvailable && (
									<button
										className={`haptic-sm inline rounded border-2 border-purple-500 bg-purple-900/30 px-1 text-xs text-purple-100 transition-colors hover:bg-purple-800/50 ${isCastingTb ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleCastTorBoxWithLoading(r.hash)}
										disabled={isCastingTb}
									>
										{isCastingTb ? (
											<>
												<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
												Casting...
											</>
										) : (
											<span className="inline-flex items-center">
												<Cast className="mr-1 h-3 w-3 text-purple-400" />
												Cast (TB)
											</span>
										)}
									</button>
								)}

								{/* Cast (AD) btn - only show if cached on AD */}
								{adKey && handleCastAllDebrid && r.adAvailable && (
									<button
										className={`haptic-sm inline rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 ${isCastingAd ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => handleCastAllDebridWithLoading(r.hash)}
										disabled={isCastingAd}
									>
										{isCastingAd ? (
											<>
												<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
												Casting...
											</>
										) : (
											<span className="inline-flex items-center">
												<Cast className="mr-1 h-3 w-3 text-yellow-400" />
												Cast (AD)
											</span>
										)}
									</button>
								)}

								{/* Check service availability btns per service */}
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
											<span className="inline-flex items-center">
												<SearchIcon className="mr-1 h-3 w-3 text-yellow-500" />
												Check RD
											</span>
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
											<span className="inline-flex items-center">
												<SearchIcon className="mr-1 h-3 w-3 text-orange-500" />
												Check AD
											</span>
										)}
									</button>
								)}
								{torboxKey && !r.tbAvailable && (
									<button
										className={`haptic-sm inline rounded border-2 border-cyan-500 bg-cyan-900/30 px-1 text-xs text-cyan-100 transition-colors hover:bg-cyan-800/50 ${isCheckingTb ? 'cursor-not-allowed opacity-50' : ''}`}
										onClick={() => checkServiceAvailability(r, ['TB'])}
										disabled={isCheckingTb}
									>
										{isCheckingTb ? (
											<>
												<Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />
												Checking TB...
											</>
										) : (
											<span className="inline-flex items-center">
												<SearchIcon className="mr-1 h-3 w-3 text-cyan-500" />
												Check TB
											</span>
										)}
									</button>
								)}

								{/* Watch btn */}
								{(r.rdAvailable || r.adAvailable || r.tbAvailable) && (
									<>
										{r.rdAvailable && player && (
											<button
												className="haptic-sm inline rounded border-2 border-teal-500 bg-teal-900/30 px-1 text-xs text-teal-100 transition-colors hover:bg-teal-800/50"
												onClick={() =>
													window.open(
														`/api/watch/instant/${player}?token=${rdKey}&hash=${r.hash}&fileId=${getBiggestFileId(r)}`
													)
												}
											>
												<span className="inline-flex items-center">
													<EyeIcon className="mr-1 h-3 w-3 text-teal-500" />
													Watch
												</span>
											</button>
										)}
									</>
								)}

								{/* Magnet btn */}
								<button
									className="haptic-sm inline rounded border-2 border-pink-500 bg-pink-900/30 px-1 text-xs text-pink-100 transition-colors hover:bg-pink-800/50"
									onClick={() => handleMagnetAction(r.hash)}
								>
									<span className="inline-flex items-center">
										<Link2 className="mr-1 h-3 w-3 text-teal-500" />
										{downloadMagnets ? 'Download' : 'Copy'}
									</span>
								</button>

								{/* Report btn */}
								<ReportButton
									hash={r.hash}
									imdbId={imdbId!}
									userId={rdKey || adKey || torboxKey || ''}
								/>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
};

export default MovieSearchResults;
