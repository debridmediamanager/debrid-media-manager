import Link from 'next/link';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa';

interface LibraryMenuButtonsProps {
	currentPage: number;
	maxPages: number;
	onPrevPage: () => void;
	onNextPage: () => void;
	onResetFilters: () => void;
	sameHashSize: number;
	sameTitleSize: number;
	selectedTorrentsSize: number;
	uncachedCount: number;
	inProgressCount: number;
	slowCount: number;
	failedCount: number;
}

export default function LibraryMenuButtons({
	currentPage,
	maxPages,
	onPrevPage,
	onNextPage,
	onResetFilters,
	sameHashSize,
	sameTitleSize,
	selectedTorrentsSize,
	uncachedCount,
	inProgressCount,
	slowCount,
	failedCount,
}: LibraryMenuButtonsProps) {
	return (
		<div className="mb-0 flex overflow-x-auto">
			<button
				className={`mb-1 mr-1 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
					currentPage <= 1 ? 'cursor-not-allowed opacity-60' : ''
				}`}
				onClick={onPrevPage}
				disabled={currentPage <= 1}
			>
				<FaArrowLeft />
			</button>
			<span className="w-16 text-center">
				{currentPage}/{maxPages}
			</span>
			<button
				className={`mb-1 ml-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
					currentPage >= maxPages ? 'cursor-not-allowed opacity-60' : ''
				}`}
				onClick={onNextPage}
				disabled={currentPage >= maxPages}
			>
				<FaArrowRight />
			</button>
			<Link
				href="/library?mediaType=movie&page=1"
				className="mb-1 mr-2 rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 py-0.5 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50"
			>
				🎥 Movies
			</Link>
			<Link
				href="/library?mediaType=tv&page=1"
				className="mb-1 mr-2 rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 py-0.5 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50"
			>
				📺 TV&nbsp;shows
			</Link>
			<Link
				href="/library?mediaType=other&page=1"
				className="mb-1 mr-2 rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 py-0.5 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50"
			>
				🗂️ Others
			</Link>
			<button
				className="mb-1 mr-2 rounded border-2 border-yellow-500 bg-yellow-900/30 px-1 py-0.5 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50"
				onClick={onResetFilters}
			>
				Reset
			</button>

			{sameHashSize > 0 && (
				<Link
					href="/library?status=samehash&page=1"
					className="mb-1 mr-2 rounded border-2 border-orange-500 bg-orange-900/30 px-1 py-0 text-xs text-orange-100 transition-colors hover:bg-orange-800/50"
				>
					👀 Same&nbsp;hash
				</Link>
			)}
			{sameTitleSize > 0 && sameHashSize < sameTitleSize && (
				<Link
					href="/library?status=sametitle&page=1"
					className="mb-1 mr-2 rounded border-2 border-amber-500 bg-amber-900/30 px-1 py-0 text-xs text-amber-100 transition-colors hover:bg-amber-800/50"
				>
					👀 Same&nbsp;title
				</Link>
			)}

			{selectedTorrentsSize > 0 && (
				<Link
					href="/library?status=selected&page=1"
					className="mb-1 mr-2 rounded border-2 border-slate-500 bg-slate-900/30 px-1 py-0.5 text-xs text-slate-100 transition-colors hover:bg-slate-800/50"
				>
					👀 Selected ({selectedTorrentsSize})
				</Link>
			)}
			{uncachedCount > 0 && (
				<Link
					href="/library?status=uncached&page=1"
					className="mb-1 mr-2 rounded border-2 border-slate-500 bg-slate-900/30 px-1 py-0.5 text-xs text-slate-100 transition-colors hover:bg-slate-800/50"
				>
					👀 Uncached
				</Link>
			)}

			{inProgressCount > 0 && (
				<Link
					href="/library?status=inprogress&page=1"
					className="mb-1 mr-2 rounded border-2 border-slate-500 bg-slate-900/30 px-1 py-0.5 text-xs text-slate-100 transition-colors hover:bg-slate-800/50"
				>
					👀 In&nbsp;progress
				</Link>
			)}
			{slowCount > 0 && (
				<Link
					href="/library?status=slow&page=1"
					className="mb-1 mr-2 rounded border-2 border-slate-500 bg-slate-900/30 px-1 py-0.5 text-xs text-slate-100 transition-colors hover:bg-slate-800/50"
				>
					👀 No&nbsp;seeds
				</Link>
			)}
			{failedCount > 0 && (
				<Link
					href="/library?status=failed&page=1"
					className="mb-1 mr-2 rounded border-2 border-slate-500 bg-slate-900/30 px-1 py-0.5 text-xs text-slate-100 transition-colors hover:bg-slate-800/50"
				>
					👀 Failed
				</Link>
			)}
		</div>
	);
}
