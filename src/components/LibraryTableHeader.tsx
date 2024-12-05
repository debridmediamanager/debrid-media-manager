interface LibraryTableHeaderProps {
	sortBy: {
		column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
		direction: 'asc' | 'desc';
	};
	onSort: (
		column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added'
	) => void;
	filteredListLength: number;
	selectedTorrentsSize: number;
}

export default function LibraryTableHeader({
	sortBy,
	onSort,
	filteredListLength,
	selectedTorrentsSize,
}: LibraryTableHeaderProps) {
	return (
		<tr className="whitespace-nowrap border-b border-gray-700 text-xs">
			<th
				className="w-8 min-w-8 max-w-8 px-0.5 py-1 text-gray-300"
				onClick={() => onSort('id')}
			>
				Select
				{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ''}{' '}
				{sortBy.column === 'id' && (sortBy.direction === 'asc' ? '↑' : '↓')}
			</th>
			<th
				className="w-[500px] min-w-96 max-w-[500px] px-1 py-2 text-gray-300"
				onClick={() => onSort('title')}
			>
				Title ({filteredListLength}){' '}
				{sortBy.column === 'title' && (sortBy.direction === 'asc' ? '↑' : '↓')}
			</th>
			<th
				className="w-20 min-w-20 max-w-20 px-1 py-2 text-gray-300"
				onClick={() => onSort('bytes')}
			>
				Size {sortBy.column === 'bytes' && (sortBy.direction === 'asc' ? '↑' : '↓')}
			</th>
			<th
				className="w-20 min-w-20 max-w-20 px-1 py-2 text-gray-300"
				onClick={() => onSort('progress')}
			>
				Status {sortBy.column === 'progress' && (sortBy.direction === 'asc' ? '↑' : '↓')}
			</th>
			<th
				className="w-24 min-w-24 max-w-28 px-1 py-2 text-gray-300"
				onClick={() => onSort('added')}
			>
				Added {sortBy.column === 'added' && (sortBy.direction === 'asc' ? '↑' : '↓')}
			</th>
			<th className="w-24 min-w-24 max-w-28 px-1 py-2 text-gray-300">Actions</th>
		</tr>
	);
}
