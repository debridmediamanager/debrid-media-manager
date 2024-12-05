import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { handleReinsertTorrentinRd, handleRestartTorrent } from '@/utils/addMagnet';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { handleShare } from '@/utils/hashList';
import { normalize } from '@/utils/mediaId';
import { torrentPrefix } from '@/utils/results';
import { shortenNumber } from '@/utils/speed';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaMagnet, FaRecycle, FaSeedling, FaShare, FaTrash } from 'react-icons/fa';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface TorrentRowProps {
	torrent: UserTorrent;
	rdKey: string | null;
	adKey: string | null;
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
}

export default function TorrentRow({
	torrent,
	rdKey,
	adKey,
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
}: TorrentRowProps) {
	const router = useRouter();

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
		<tr
			className={`border-b border-gray-800 align-middle lg:hover:bg-gray-800/50 ${isSelected ? 'bg-green-800' : ''}`}
		>
			<td
				onClick={() => onSelect(torrent.id)}
				className="truncate px-0.5 py-1 text-center text-sm"
			>
				{isSelected ? '✅' : '➕'}
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
								['🎥', '📺', '🗂️'][
									['movie', 'tv', 'other'].indexOf(torrent.mediaType)
								]
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
									(torrent.info.title + ' ' + (torrent.info.year || '')).trim() ||
										torrent.title
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
				{rdKey && adKey && torrentPrefix(torrent.id)}{' '}
				{torrent.filename === torrent.hash ? 'Magnet' : torrent.filename}
				{torrent.filename === torrent.hash || torrent.filename === 'Magnet'
					? ` (${torrent.status})`
					: ''}
			</td>
			<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
				{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
			</td>
			<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
				{torrent.status !== UserTorrentStatus.finished ? (
					<>
						<span className="inline-block align-middle">
							{torrent.progress.toFixed(2)}%&nbsp;
						</span>
						<span className="inline-block align-middle">
							<FaSeedling />
						</span>
						<span className="inline-block align-middle">{torrent.seeders}</span>
						<br />
						<span className="inline-block align-middle">
							{shortenNumber(torrent.speed)}B/s
						</span>
					</>
				) : (
					`${torrent.serviceStatus}`
				)}
			</td>
			<td onClick={() => onShowInfo(torrent)} className="px-0.5 py-1 text-center text-xs">
				{new Date(torrent.added).toLocaleString()}
			</td>
			<td
				onClick={() => onShowInfo(torrent)}
				className="flex place-content-center px-0.5 py-1"
			>
				<button
					title="Share"
					className="mb-2 mr-2 cursor-pointer text-indigo-600"
					onClick={async (e) => {
						e.stopPropagation();
						router.push(await handleShare(torrent));
					}}
				>
					<FaShare />
				</button>
				<button
					title="Delete"
					className="mb-2 mr-2 cursor-pointer text-red-500"
					onClick={async (e) => {
						e.stopPropagation();
						if (rdKey && torrent.id.startsWith('rd:')) {
							await handleDeleteRdTorrent(rdKey, torrent.id);
						}
						if (adKey && torrent.id.startsWith('ad:')) {
							await handleDeleteAdTorrent(adKey, torrent.id);
						}
						onDelete(torrent.id);
					}}
				>
					<FaTrash />
				</button>
				<button
					title="Copy magnet url"
					className="mb-2 mr-2 cursor-pointer text-pink-500"
					onClick={(e) => {
						e.stopPropagation();
						handleCopyOrDownloadMagnet(torrent.hash, shouldDownloadMagnets);
					}}
				>
					<FaMagnet />
				</button>
				<button
					title="Reinsert"
					className="mb-2 mr-2 cursor-pointer text-green-500"
					onClick={async (e) => {
						e.stopPropagation();
						try {
							if (rdKey && torrent.id.startsWith('rd:')) {
								await handleReinsertTorrentinRd(rdKey, torrent, true);
								onDelete(torrent.id);
							}
							if (adKey && torrent.id.startsWith('ad:')) {
								await handleRestartTorrent(adKey, torrent.id);
							}
						} catch (error) {
							console.error(error);
						}
					}}
				>
					<FaRecycle />
				</button>
			</td>
		</tr>
	);
}
