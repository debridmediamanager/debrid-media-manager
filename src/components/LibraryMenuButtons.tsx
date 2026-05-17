import {
	ChevronLeft,
	ChevronRight,
	Eye,
	Film,
	FolderOpen,
	RotateCcw,
	ShieldAlert,
	Tv,
} from 'lucide-react';
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
	rdBlockedCount: number;
	activeMediaType?: string;
	activeStatus?: string;
	activeService?: string;
	hasRd?: boolean;
	hasAd?: boolean;
	hasTb?: boolean;
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
	rdBlockedCount,
	activeMediaType,
	activeStatus,
	activeService,
	hasRd,
	hasAd,
	hasTb,
}: LibraryMenuButtonsProps) {
	const hasActiveFilter = !!activeMediaType || !!activeStatus || !!activeService;
	const multipleServices = [hasRd, hasAd, hasTb].filter(Boolean).length > 1;

	const buildHref = (params: Record<string, string | undefined>) => {
		const base: Record<string, string> = { page: '1' };
		if (activeMediaType && !('mediaType' in params)) base.mediaType = activeMediaType;
		if (activeStatus && !('status' in params)) base.status = activeStatus;
		if (activeService && !('service' in params)) base.service = activeService;
		for (const [k, v] of Object.entries(params)) {
			if (v) base[k] = v;
		}
		return `/library?${new URLSearchParams(base).toString()}`;
	};
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
				href={buildHref({ mediaType: 'movie' })}
				deactivateHref={buildHref({ mediaType: undefined })}
				variant="yellow"
				active={activeMediaType === 'movie'}
			>
				<Film className="mr-1 inline-block h-4 w-4 text-yellow-400" />
				Movies
			</LibraryLinkButton>
			<LibraryLinkButton
				href={buildHref({ mediaType: 'tv' })}
				deactivateHref={buildHref({ mediaType: undefined })}
				variant="yellow"
				active={activeMediaType === 'tv'}
			>
				<Tv className="mr-1 inline-block h-4 w-4 text-cyan-400" />
				TV&nbsp;shows
			</LibraryLinkButton>
			<LibraryLinkButton
				href={buildHref({ mediaType: 'other' })}
				deactivateHref={buildHref({ mediaType: undefined })}
				variant="yellow"
				active={activeMediaType === 'other'}
			>
				<FolderOpen className="mr-1 inline-block h-4 w-4 text-orange-400" />
				Others
			</LibraryLinkButton>
			{multipleServices && hasRd && (
				<LibraryLinkButton
					href={buildHref({ service: 'rd' })}
					deactivateHref={buildHref({ service: undefined })}
					variant="green"
					active={activeService === 'rd'}
				>
					RD
				</LibraryLinkButton>
			)}
			{multipleServices && hasAd && (
				<LibraryLinkButton
					href={buildHref({ service: 'ad' })}
					deactivateHref={buildHref({ service: undefined })}
					variant="green"
					active={activeService === 'ad'}
				>
					AD
				</LibraryLinkButton>
			)}
			{multipleServices && hasTb && (
				<LibraryLinkButton
					href={buildHref({ service: 'tb' })}
					deactivateHref={buildHref({ service: undefined })}
					variant="green"
					active={activeService === 'tb'}
				>
					TB
				</LibraryLinkButton>
			)}
			{sameHashSize > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'samehash' })}
					deactivateHref={buildHref({ status: undefined })}
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
					href={buildHref({ status: 'sametitle' })}
					deactivateHref={buildHref({ status: undefined })}
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
					href={buildHref({ status: 'selected' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="slate"
					active={activeStatus === 'selected'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Selected ({selectedTorrentsSize})
				</LibraryLinkButton>
			)}
			{uncachedCount > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'uncached' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="slate"
					active={activeStatus === 'uncached'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Uncached
				</LibraryLinkButton>
			)}

			{inProgressCount > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'inprogress' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="slate"
					active={activeStatus === 'inprogress'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					In&nbsp;progress
				</LibraryLinkButton>
			)}
			{slowCount > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'slow' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="slate"
					active={activeStatus === 'slow'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					No&nbsp;seeds
				</LibraryLinkButton>
			)}
			{failedCount > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'failed' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="slate"
					active={activeStatus === 'failed'}
				>
					<Eye className="mr-1 inline-block h-4 w-4 text-slate-400" />
					Failed
				</LibraryLinkButton>
			)}
			{hasRd && rdBlockedCount > 0 && (
				<LibraryLinkButton
					href={buildHref({ status: 'rdblocked' })}
					deactivateHref={buildHref({ status: undefined })}
					variant="red"
					size="sm"
					active={activeStatus === 'rdblocked'}
				>
					<ShieldAlert className="mr-1 inline-block h-4 w-4 text-red-400" />
					RD&nbsp;blocked
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
