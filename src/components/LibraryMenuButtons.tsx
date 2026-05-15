import { ChevronLeft, ChevronRight, Eye, Film, FolderOpen, RotateCcw, Tv } from 'lucide-react';
import LibraryButton from './LibraryButton';
import LibraryLinkButton from './LibraryLinkButton';

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
	activeMediaType?: string;
	activeStatus?: string;
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
	activeMediaType,
	activeStatus,
}: LibraryMenuButtonsProps) {
	const hasActiveFilter = !!activeMediaType || !!activeStatus;
	return (
		<div className="mb-0 flex overflow-x-auto">
			<LibraryButton
				variant="indigo"
				onClick={onPrevPage}
				disabled={currentPage <= 1}
				className="mr-1"
			>
				<ChevronLeft className="h-4 w-4 text-indigo-400" />
			</LibraryButton>
			<span className="w-16 text-center">
				{currentPage}/{maxPages}
			</span>
			<LibraryButton
				variant="indigo"
				size="xs"
				onClick={onNextPage}
				disabled={currentPage >= maxPages}
				className="ml-1"
			>
				<ChevronRight className="h-4 w-4 text-indigo-400" />
			</LibraryButton>
			<LibraryLinkButton
				href="/library?mediaType=movie&page=1"
				variant="yellow"
				active={activeMediaType === 'movie'}
			>
				<Film className="mr-1 inline-block h-4 w-4 text-yellow-400" />
				Movies
			</LibraryLinkButton>
			<LibraryLinkButton
				href="/library?mediaType=tv&page=1"
				variant="yellow"
				active={activeMediaType === 'tv'}
			>
				<Tv className="mr-1 inline-block h-4 w-4 text-cyan-400" />
				TV&nbsp;shows
			</LibraryLinkButton>
			<LibraryLinkButton
				href="/library?mediaType=other&page=1"
				variant="yellow"
				active={activeMediaType === 'other'}
			>
				<FolderOpen className="mr-1 inline-block h-4 w-4 text-orange-400" />
				Others
			</LibraryLinkButton>
			{sameHashSize > 0 && (
				<LibraryLinkButton
					href="/library?status=samehash&page=1"
					variant="orange"
					size="sm"
					active={activeStatus === 'samehash'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-orange-400" />
					Same&nbsp;hash
				</LibraryLinkButton>
			)}
			{sameTitleSize > 0 && sameHashSize < sameTitleSize && (
				<LibraryLinkButton
					href="/library?status=sametitle&page=1"
					variant="amber"
					size="sm"
					active={activeStatus === 'sametitle'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-amber-400" />
					Same&nbsp;title
				</LibraryLinkButton>
			)}

			{selectedTorrentsSize > 0 && (
				<LibraryLinkButton
					href="/library?status=selected&page=1"
					variant="slate"
					active={activeStatus === 'selected'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Selected ({selectedTorrentsSize})
				</LibraryLinkButton>
			)}
			{uncachedCount > 0 && (
				<LibraryLinkButton
					href="/library?status=uncached&page=1"
					variant="slate"
					active={activeStatus === 'uncached'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Uncached
				</LibraryLinkButton>
			)}

			{inProgressCount > 0 && (
				<LibraryLinkButton
					href="/library?status=inprogress&page=1"
					variant="slate"
					active={activeStatus === 'inprogress'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					In&nbsp;progress
				</LibraryLinkButton>
			)}
			{slowCount > 0 && (
				<LibraryLinkButton
					href="/library?status=slow&page=1"
					variant="slate"
					active={activeStatus === 'slow'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					No&nbsp;seeds
				</LibraryLinkButton>
			)}
			{failedCount > 0 && (
				<LibraryLinkButton
					href="/library?status=failed&page=1"
					variant="slate"
					active={activeStatus === 'failed'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Failed
				</LibraryLinkButton>
			)}
			{hasActiveFilter && (
				<LibraryButton variant="red" size="xs" onClick={onResetFilters}>
					<RotateCcw className="mr-1 inline-block h-3 w-3 text-red-300" />
					Reset
				</LibraryButton>
			)}
		</div>
	);
}
