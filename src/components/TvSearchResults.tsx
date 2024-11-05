import { SearchResult } from '@/services/mediasearch';
import { getEpisodeCountClass, getEpisodeCountLabel } from '@/utils/episodeUtils';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize } from '@/utils/results';
import { FaMagnet, FaTimes } from 'react-icons/fa';

type TvSearchResultsProps = {
	filteredResults: SearchResult[];
	expectedEpisodeCount: number;
	onlyShowCached: boolean;
	episodeMaxSize: string;
	rdKey: string | null;
	adKey: string | null;
	dmmCastToken: string | null;
	player: string;
	imdbid: string;
	hashAndProgress: Record<string, number>;
	handleShowInfo: (result: SearchResult) => void;
	handleCast: (hash: string, fileIds: string[]) => Promise<void>;
	handleCopyMagnet: (hash: string) => void;
	addRd: (hash: string) => Promise<void>;
	addAd: (hash: string) => Promise<void>;
	deleteRd: (hash: string) => Promise<void>;
	deleteAd: (hash: string) => Promise<void>;
};

const TvSearchResults: React.FC<TvSearchResultsProps> = ({
	filteredResults,
	expectedEpisodeCount,
	onlyShowCached,
	episodeMaxSize,
	rdKey,
	adKey,
	dmmCastToken,
	player,
	imdbid,
	hashAndProgress,
	handleShowInfo,
	handleCast,
	handleCopyMagnet,
	addRd,
	addAd,
	deleteRd,
	deleteAd,
}) => {
	const isDownloading = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] < 100;
	const isDownloaded = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] === 100;
	const inLibrary = (service: string, hash: string) => `${service}:${hash}` in hashAndProgress;
	const notInLibrary = (service: string, hash: string) =>
		!(`${service}:${hash}` in hashAndProgress);

	const EpisodeCountDisplay = ({
		result,
		videoCount,
	}: {
		result: SearchResult;
		videoCount: number;
	}) => (
		<span
			className="inline-block px-2 py-1 rounded bg-opacity-50 bg-black cursor-pointer hover:bg-opacity-75 haptic-sm"
			onClick={() => handleShowInfo(result)}
		>
			📂&nbsp;{getEpisodeCountLabel(videoCount, expectedEpisodeCount)}
		</span>
	);

	const getBiggestFileId = (result: SearchResult) => {
		if (!result.files || !result.files.length) return '';
		const biggestFile = result.files
			.filter((f) => f.filename.match(/\.(mkv|mp4|avi)$/i))
			.sort((a, b) => b.filesize - a.filesize)[0];
		return biggestFile?.fileId ?? '';
	};

	return (
		<div className="mx-1 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
			{filteredResults.map((r: SearchResult, i: number) => {
				const downloaded = isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash);
				const downloading = isDownloading('rd', r.hash) || isDownloading('ad', r.hash);
				const inYourLibrary = downloaded || downloading;

				if (onlyShowCached && !r.rdAvailable && !r.adAvailable && !inYourLibrary)
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
				const castableFileIds = r.files
					.filter((f) => f.filename.match(epRegex1) || f.filename.match(epRegex2))
					.map((f) => `${f.fileId}`);

				return (
					<div
						key={i}
						className={`
                            border-2 border-gray-700 
                            ${borderColor(downloaded, downloading)}
                            ${getEpisodeCountClass(r.videoCount, expectedEpisodeCount, r.rdAvailable || r.adAvailable)}
                            shadow hover:shadow-lg 
                            transition-shadow duration-200 ease-in 
                            rounded-lg overflow-hidden 
                            bg-opacity-30
                        `}
					>
						<div className="p-1 space-y-2">
							<h2 className="text-sm font-bold leading-tight break-words line-clamp-2 overflow-hidden text-ellipsis">
								{r.title}
							</h2>

							{r.videoCount > 0 ? (
								<div className="text-gray-300 text-xs">
									<EpisodeCountDisplay result={r} videoCount={r.videoCount} />
									<span className="ml-2">
										Total: {fileSize(r.fileSize)} GB; Median:{' '}
										{fileSize(r.medianFileSize)} GB
									</span>
								</div>
							) : (
								<div className="text-gray-300 text-xs">
									Total: {fileSize(r.fileSize)} GB
								</div>
							)}

							<div className="space-x-1 space-y-1">
								{/* RD */}
								{rdKey && inLibrary('rd', r.hash) && (
									<button
										className="border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
										onClick={() => deleteRd(r.hash)}
									>
										<FaTimes className="mr-2 inline" />
										RD ({hashAndProgress[`rd:${r.hash}`] + '%'})
									</button>
								)}
								{rdKey && notInLibrary('rd', r.hash) && (
									<button
										className={`border-2 border-${rdColor}-500 bg-${rdColor}-900/30 text-${rdColor}-100 hover:bg-${rdColor}-800/50 text-xs rounded inline px-1 transition-colors haptic-sm`}
										onClick={() => addRd(r.hash)}
									>
										{btnIcon(r.rdAvailable)}
										{btnLabel(r.rdAvailable, 'RD')}
									</button>
								)}

								{/* AD */}
								{adKey && inLibrary('ad', r.hash) && (
									<button
										className="border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
										onClick={() => deleteAd(r.hash)}
									>
										<FaTimes className="mr-2 inline" />
										AD ({hashAndProgress[`ad:${r.hash}`] + '%'})
									</button>
								)}
								{adKey && notInLibrary('ad', r.hash) && (
									<button
										className={`border-2 border-${adColor}-500 bg-${adColor}-900/30 text-${adColor}-100 hover:bg-${adColor}-800/50 text-xs rounded inline px-1 transition-colors haptic-sm`}
										onClick={() => addAd(r.hash)}
									>
										{btnIcon(r.adAvailable)}
										{btnLabel(r.adAvailable, 'AD')}
									</button>
								)}

								{rdKey && dmmCastToken && castableFileIds.length > 0 && (
									<button
										className="border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
										onClick={() => handleCast(r.hash, castableFileIds)}
									>
										Cast✨
									</button>
								)}

								{rdKey && player && r.rdAvailable && (
									<button
										className="border-2 border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
										onClick={() =>
											window.open(
												`/api/watch/instant/${player}?token=${rdKey}&hash=${r.hash}&fileId=${getBiggestFileId(r)}`
											)
										}
									>
										🧐Watch
									</button>
								)}

								<button
									className="border-2 border-pink-500 bg-pink-900/30 text-pink-100 hover:bg-pink-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
									onClick={() => handleCopyMagnet(r.hash)}
								>
									<FaMagnet className="inline" /> Magnet
								</button>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
};

export default TvSearchResults;
