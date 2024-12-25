import LibraryTableHeader from '@/components/LibraryTableHeader';
import LibraryTorrentRow from '@/components/LibraryTorrentRow';
import { UserTorrent } from '@/torrent/userTorrent';
import { GroupingState } from '../hooks/useLibraryFilter';
import { SortBy } from '../hooks/useLibrarySortAndPaginate';

interface LibraryTableProps {
	data: UserTorrent[];
	sortBy: SortBy;
	onSort: (column: SortBy['column']) => void;
	selectedTorrents: Set<string>;
	onSelectTorrent: (id: string) => void;
	rdKey: string | null;
	adKey: string | null;
	groupingState: GroupingState;
	setUserTorrentsList: (
		torrents: UserTorrent[] | ((prev: UserTorrent[]) => UserTorrent[])
	) => void;
	setSelectedTorrents: (selected: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
	torrentDB: any;
}

export default function LibraryTable({
	data,
	sortBy,
	onSort,
	selectedTorrents,
	onSelectTorrent,
	rdKey,
	adKey,
	groupingState,
	setUserTorrentsList,
	setSelectedTorrents,
	torrentDB,
}: LibraryTableProps) {
	const getTitleGroupings = (mediaType: UserTorrent['mediaType']) => {
		switch (mediaType) {
			case 'movie':
				return groupingState.movieTitleGrouping;
			case 'tv':
				return groupingState.tvGroupingByEpisode;
			default:
				return groupingState.defaultTitleGrouping;
		}
	};

	return (
		<table className="w-full">
			<thead>
				<LibraryTableHeader
					sortBy={sortBy}
					onSort={onSort}
					filteredListLength={data.length}
					selectedTorrentsSize={selectedTorrents.size}
				/>
			</thead>
			<tbody>
				{data.map((torrent) => (
					<LibraryTorrentRow
						key={torrent.id}
						torrent={torrent}
						rdKey={rdKey}
						adKey={adKey}
						shouldDownloadMagnets={false}
						hashGrouping={groupingState.hashGrouping}
						titleGrouping={getTitleGroupings(torrent.mediaType)}
						tvGroupingByTitle={groupingState.tvGroupingByTitle}
						hashFilter={undefined}
						titleFilter={undefined}
						tvTitleFilter={undefined}
						isSelected={selectedTorrents.has(torrent.id)}
						onSelect={onSelectTorrent}
						onDelete={async (id: string) => {
							setUserTorrentsList((prevList: UserTorrent[]) =>
								prevList.filter((prevTor: UserTorrent) => prevTor.id !== id)
							);
							await torrentDB.deleteById(id);
							setSelectedTorrents((prev: Set<string>) => {
								const newSet = new Set(prev);
								newSet.delete(id);
								return newSet;
							});
						}}
						onShowInfo={() => {}} // Implement if needed
						onTypeChange={() => {}} // Implement if needed
					/>
				))}
			</tbody>
		</table>
	);
}
