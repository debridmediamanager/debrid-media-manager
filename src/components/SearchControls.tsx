import SearchTokens from '@/components/SearchTokens';
import { RotateCcw, Search } from 'lucide-react';
import React from 'react';

interface SearchControlsProps {
	query: string;
	onQueryChange: (query: string) => void;
	filteredCount: number;
	totalCount: number;
	showMassReportButtons: boolean;
	rdKey: string | null;
	onMassReport: (type: 'porn' | 'wrong_imdb' | 'wrong_season') => void;
	mediaType: 'movie' | 'tv';
	title: string;
	year: string;
	isShow?: boolean;
	colorScales?: Array<{ threshold: number; color: string; label: string }>;
	getQueryForScale?: (threshold: number) => string;
	extraTokens?: Array<{ label: string; query: string }>;
}

const SearchControls: React.FC<SearchControlsProps> = ({
	query,
	onQueryChange,
	filteredCount,
	totalCount,
	showMassReportButtons,
	rdKey,
	onMassReport,
	mediaType,
	title,
	year,
	isShow,
	colorScales,
	getQueryForScale,
	extraTokens,
}) => {
	return (
		<>
			<div className="mb-1 flex items-center border-b-2 border-gray-600 py-2">
				<Search className="mr-2 h-4 w-4 text-gray-400" />
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 text-sm leading-tight text-gray-100 focus:outline-none"
					type="text"
					id="query"
					placeholder="filter results, supports regex"
					value={query}
					onChange={(e) => onQueryChange(e.target.value.toLocaleLowerCase())}
				/>
				<span
					className="me-2 inline-flex cursor-pointer items-center rounded bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
					onClick={() => onQueryChange('')}
					title="Reset search"
				>
					<RotateCcw className="h-3 w-3" />
					<span className="ml-1 hidden sm:inline">Reset</span>
				</span>
				<span className="mr-2 text-xs text-gray-400">
					{filteredCount}/{totalCount}
				</span>
				{query && totalCount > 0 && rdKey && showMassReportButtons && (
					<div className="ml-2 flex gap-2">
						<span
							className="cursor-pointer whitespace-nowrap rounded border border-red-500 bg-red-900/30 px-2 py-0.5 text-xs text-red-100 transition-colors hover:bg-red-800/50"
							onClick={() => onMassReport('porn')}
							title="Report all filtered torrents as pornographic content"
						>
							Report as Porn ({totalCount})
						</span>
						<span
							className="cursor-pointer whitespace-nowrap rounded border border-red-500 bg-red-900/30 px-2 py-0.5 text-xs text-red-100 transition-colors hover:bg-red-800/50"
							onClick={() => onMassReport('wrong_imdb')}
							title="Report all filtered torrents as wrong IMDB ID"
						>
							Report Wrong IMDB ({totalCount})
						</span>
						{mediaType === 'tv' && (
							<span
								className="cursor-pointer whitespace-nowrap rounded border border-red-500 bg-red-900/30 px-2 py-0.5 text-xs text-red-100 transition-colors hover:bg-red-800/50"
								onClick={() => onMassReport('wrong_season')}
								title="Report all filtered torrents as wrong season"
							>
								Report Wrong Season ({totalCount})
							</span>
						)}
					</div>
				)}
			</div>

			<div className="mb-2 flex items-center gap-2 overflow-x-auto p-2">
				<SearchTokens
					title={title}
					year={year}
					isShow={isShow}
					onTokenClick={(token) => onQueryChange(query ? `${query} ${token}` : token)}
				/>
				{colorScales &&
					getQueryForScale &&
					colorScales.map((scale, idx) => (
						<span
							key={idx}
							className={`bg-${scale.color} cursor-pointer whitespace-nowrap rounded px-2 py-1 text-xs text-white`}
							onClick={() => {
								const queryText = getQueryForScale(scale.threshold);
								const cleanedPrev = query.replace(/\bvideos:[^\s]+/g, '').trim();
								onQueryChange(
									cleanedPrev ? `${cleanedPrev} ${queryText}` : queryText
								);
							}}
						>
							{scale.label}
						</span>
					))}
				{extraTokens?.map((token) => (
					<span
						key={token.label}
						className="cursor-pointer whitespace-nowrap rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-100"
						onClick={() => {
							const nextQuery = query ? `${query} ${token.query}` : token.query;
							onQueryChange(nextQuery);
						}}
					>
						{token.label}
					</span>
				))}
			</div>
		</>
	);
};

export default SearchControls;
