import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleReinsertTorrentinRd,
	handleRestartTbTorrent,
	handleRestartTorrent,
} from '@/utils/addMagnet';
import { getAllDebridStatusText } from '@/utils/allDebridStatus';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import {
	handleDeleteAdTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { handleShare } from '@/utils/hashList';
import { normalize } from '@/utils/mediaId';
import { getRealDebridStatusText } from '@/utils/realDebridStatus';
import { torrentPrefix } from '@/utils/results';
import { shortenNumber } from '@/utils/speed';
import { getTorBoxStatusText } from '@/utils/torBoxStatus';
import {
	Cast,
	Check,
	Film,
	FolderOpen,
	Leaf,
	Link2,
	Plus,
	RefreshCw,
	Share2,
	Trash2,
	Tv,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { memo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { CastSearchModal } from './CastSearchModal';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface TorrentRowProps {
	torrent: UserTorrent;
	rdKey: string | null;
	adKey: string | null;
	tbKey: string | null;
	shouldDownloadMagnets: boolean;
	hashGrouping: Record<string, number>;
	titleGrouping: Record<string, number>;
	tvGroupingByTitle: Record<string, number>;
	hashFilter?: string;
	titleFilter?: string;
	tvTitleFilter?: string;
	isSelected: boolean;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onShowInfo: (torrent: UserTorrent) => void;
	onTypeChange: (torrent: UserTorrent) => void;
	onRefreshLibrary?: () => Promise<void>;
}

function TorrentRow({
	torrent,
	rdKey,
	adKey,
	tbKey,
	shouldDownloadMagnets,
	hashGrouping,
	titleGrouping,
	tvGroupingByTitle,
	hashFilter,
	titleFilter,
	tvTitleFilter,
	isSelected,
	onSelect,
	onDelete,
	onShowInfo,
	onTypeChange,
	onRefreshLibrary,
}: TorrentRowProps) {
	const router = useRouter();
	const [showCastModal, setShowCastModal] = useState(false);
	const [castTorrentInfo, setCastTorrentInfo] = useState<any>(null);
	const [isCasting, setIsCasting] = useState(false);

	// Helper function to get user-friendly status text for any service
	const getStatusText = (torrent: UserTorrent): string => {
		if (torrent.id.startsWith('rd:')) {
			return getRealDebridStatusText(torrent.serviceStatus);
		} else if (torrent.id.startsWith('ad:')) {
			return getAllDebridStatusText(torrent.serviceStatus);
		} else if (torrent.id.startsWith('tb:')) {
			return getTorBoxStatusText(torrent.serviceStatus);
		}
		return torrent.serviceStatus; // Fallback to raw status
	};

	// Handler for cast button click
	const handleCastClick = async (imdbId?: string) => {
		if (!rdKey || !torrent.id.startsWith('rd:')) return;

		const rdId = torrent.id.substring(3);
		if (!rdId || !torrent.hash) return;

		setIsCasting(true);
		try {
			const castUrl = `/api/stremio/cast/library/${rdId}:${torrent.hash}?rdToken=${rdKey}${imdbId ? `&imdbId=${imdbId}` : ''}`;
			const response = await fetch(castUrl);
			const data = await response.json();

			if (data.status === 'need_imdb_id') {
				// Show modal for user to search and select IMDB ID
				setCastTorrentInfo(data.torrentInfo);
				setShowCastModal(true);
			} else if (data.status === 'error') {
				// Show error toast
				toast.error(data.errorMessage || 'Failed to cast to Stremio');
			} else if (data.status === 'success') {
				// Success - open Stremio deep link
				window.location.href = data.redirectUrl;
				toast.success('Opening in Stremio...');
			}
		} catch (error) {
			console.error('Cast error:', error);
			toast.error('Failed to cast to Stremio');
		} finally {
			setIsCasting(false);
		}
	};

	// Handler for IMDB ID selection from modal
	const handleSelectImdbId = async (imdbId: string) => {
		setShowCastModal(false);
		await handleCastClick(imdbId);
	};

	// Calculate filter texts
	const hashGroupCount = hashGrouping[torrent.hash];
	const hashFilterText = hashGroupCount > 1 && !hashFilter ? `${hashGroupCount} same hash` : '';

	const titleGroupCount = titleGrouping[normalize(torrent.title)];
	const titleFilterText =
		titleGroupCount > 1 && !titleFilter && !hashFilter ? `${titleGroupCount} same title` : '';

	let tvTitleFilterText = '';
	if (torrent.mediaType === 'tv' && torrent.info?.title) {
		const tvTitleGroupCount = tvGroupingByTitle[normalize(torrent.info.title)];
		if (tvTitleGroupCount > 1 && !tvTitleFilter && titleGroupCount < tvTitleGroupCount) {
			tvTitleFilterText = `${tvTitleGroupCount} same show`;
		}
	}

	return (
		<>
			<tr
				className={`border-b border-gray-800 align-middle lg:hover:bg-gray-800/50 ${isSelected ? 'bg-green-800' : ''}`}
			>
				<td
					onClick={() => onSelect(torrent.id)}
					className="truncate px-0.5 py-1 text-center text-sm"
				>
					{isSelected ? (
						<Check className="inline-block h-4 w-4 text-green-500" />
					) : (
						<Plus className="inline-block h-4 w-4 text-gray-500" />
					)}
				</td>
				<td onClick={() => onShowInfo(torrent)} className="truncate px-0.5 py-1 text-sm">
					{!['Invalid Magnet', 'Magnet', 'noname'].includes(torrent.filename) && (
						<>
							<div
								className="inline-block cursor-pointer"
								onClick={(e) => {
									e.stopPropagation();
									onTypeChange(torrent);
								}}
							>
								{
									{
										movie: (
											<Film className="inline-block h-4 w-4 text-yellow-500" />
										),
										tv: <Tv className="inline-block h-4 w-4 text-cyan-500" />,
										other: (
											<FolderOpen className="inline-block h-4 w-4 text-orange-500" />
										),
									}[torrent.mediaType]
								}
							</div>
							&nbsp;<strong>{torrent.title}</strong>{' '}
							{hashFilterText ? (
								<Link
									href={`/library?hash=${torrent.hash}&page=1`}
									className="ml-1 inline-block cursor-pointer rounded border-2 border-orange-500 bg-orange-900/30 px-1 py-0 text-xs font-bold text-orange-100 transition-colors hover:bg-orange-800/50"
									onClick={(e) => e.stopPropagation()}
								>
									{hashFilterText}
								</Link>
							) : (
								titleFilterText && (
									<Link
										href={`/library?title=${encodeURIComponent(normalize(torrent.title))}&page=1`}
										className="ml-1 inline-block cursor-pointer rounded border-2 border-amber-500 bg-amber-900/30 px-1 py-0 text-xs font-bold text-amber-100 transition-colors hover:bg-amber-800/50"
										onClick={(e) => e.stopPropagation()}
									>
										{titleFilterText}
									</Link>
								)
							)}
							{tvTitleFilterText && torrent.info?.title && (
								<Link
									href={`/library?tvTitle=${encodeURIComponent(normalize(torrent.info.title))}&page=1`}
									className="ml-1 inline-block cursor-pointer rounded border-2 border-sky-500 bg-sky-900/30 px-1 py-0 text-xs font-bold text-sky-100 transition-colors hover:bg-sky-800/50"
									onClick={(e) => e.stopPropagation()}
								>
									{tvTitleFilterText}
								</Link>
							)}
							{torrent.info && (
								<Link
									href={`/search?query=${encodeURIComponent(
										(
											torrent.info.title +
											' ' +
											(torrent.info.year || '')
										).trim() || torrent.title
									)}`}
									target="_blank"
									className="ml-1 mr-2 inline-block cursor-pointer rounded border-2 border-blue-500 bg-blue-900/30 px-1 py-0 text-xs font-bold text-blue-100 transition-colors hover:bg-blue-800/50"
									onClick={(e) => e.stopPropagation()}
								>
									Search again
								</Link>
							)}
							<br />
						</>
					)}
					{[rdKey, adKey, tbKey].filter(Boolean).length > 1 && torrentPrefix(torrent.id)}{' '}
					{torrent.filename === torrent.hash ? 'Magnet' : torrent.filename}
					{torrent.filename === torrent.hash ||
					torrent.filename === 'Magnet' ||
					torrent.status === UserTorrentStatus.error
						? ` (${getStatusText(torrent)})`
						: ''}
				</td>
				<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
					{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
				</td>
				<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
					{torrent.status !== UserTorrentStatus.finished &&
					torrent.status !== UserTorrentStatus.error ? (
						<>
							<span className="inline-block align-middle">
								{(torrent.progress ?? 0).toFixed(2)}%&nbsp;
							</span>
							<span className="inline-block align-middle">
								<Leaf className="inline-block h-4 w-4 text-green-500" />
							</span>
							<span className="inline-block align-middle">{torrent.seeders}</span>
							<br />
							<span className="inline-block align-middle">
								{shortenNumber(torrent.speed)}B/s
							</span>
						</>
					) : (
						getStatusText(torrent)
					)}
				</td>
				<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
					{new Date(torrent.added).toLocaleString(undefined, { timeZone: 'UTC' })}
				</td>
				<td
					onClick={() => onShowInfo(torrent)}
					className="flex place-content-center px-0.5 py-1"
				>
					{rdKey && torrent.id.startsWith('rd:') && (
						<button
							title="Cast (RD)"
							className="mb-2 mr-2 cursor-pointer text-green-400 disabled:opacity-50"
							onClick={(e) => {
								e.stopPropagation();
								handleCastClick();
							}}
							disabled={isCasting}
						>
							<Cast className="h-4 w-4 text-green-400" />
						</button>
					)}
					<button
						title="Share"
						className="mb-2 mr-2 cursor-pointer text-indigo-600"
						onClick={async (e) => {
							e.stopPropagation();
							router.push(await handleShare(torrent));
						}}
					>
						<Share2 className="h-4 w-4 text-indigo-500" />
					</button>
					<button
						title="Delete"
						className="mb-2 mr-2 cursor-pointer text-red-500"
						onClick={async (e) => {
							e.stopPropagation();
							let success = false;
							if (rdKey && torrent.id.startsWith('rd:')) {
								success = await handleDeleteRdTorrent(rdKey, torrent.id);
							}
							if (adKey && torrent.id.startsWith('ad:')) {
								success = await handleDeleteAdTorrent(adKey, torrent.id);
							}
							if (tbKey && torrent.id.startsWith('tb:')) {
								success = await handleDeleteTbTorrent(tbKey, torrent.id);
							}
							if (success) onDelete(torrent.id);
						}}
					>
						<Trash2 className="h-4 w-4 text-red-500" />
					</button>
					<button
						title="Copy magnet url"
						className="mb-2 mr-2 cursor-pointer text-pink-500"
						onClick={(e) => {
							e.stopPropagation();
							void handleCopyOrDownloadMagnet(torrent.hash, shouldDownloadMagnets);
						}}
					>
						<Link2 className="h-4 w-4 text-teal-500" />
					</button>
					<button
						title="Reinsert"
						className="mb-2 mr-2 cursor-pointer text-green-500"
						onClick={async (e) => {
							e.stopPropagation();
							try {
								if (rdKey && torrent.id.startsWith('rd:')) {
									// The function now handles fetching info and preserving selection internally
									await handleReinsertTorrentinRd(rdKey, torrent, true);
									onDelete(torrent.id);
									// Trigger library refresh to fetch the newly reinserted torrent
									if (onRefreshLibrary) {
										await onRefreshLibrary();
									}
								}
								if (adKey && torrent.id.startsWith('ad:')) {
									await handleRestartTorrent(adKey, torrent.id);
									// AllDebrid might also need refresh
									if (onRefreshLibrary) {
										await onRefreshLibrary();
									}
								}
								if (tbKey && torrent.id.startsWith('tb:')) {
									await handleRestartTbTorrent(tbKey, torrent.id);
									// TorBox might also need refresh
									if (onRefreshLibrary) {
										await onRefreshLibrary();
									}
								}
							} catch (error) {
								console.error(error);
							}
						}}
					>
						<RefreshCw className="h-4 w-4 text-green-500" />
					</button>
				</td>
			</tr>
			{/* Cast Search Modal */}
			{showCastModal && castTorrentInfo && (
				<CastSearchModal
					isOpen={showCastModal}
					onClose={() => setShowCastModal(false)}
					torrentInfo={castTorrentInfo}
					onSelectImdbId={handleSelectImdbId}
				/>
			)}
		</>
	);
}

export default memo(TorrentRow);
