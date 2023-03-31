import { getUserTorrentsList, deleteTorrent } from '@/api/realDebrid';
import Cookies from 'js-cookie';
import { useEffect, useState } from 'react';
import { FaTrash } from 'react-icons/fa';

interface UserTorrent {
	id: string;
	filename: string;
	hash: string;
	bytes: number;
	progress: number;
	status: string;
	added: string;
}

interface SortBy {
	column: 'id' | 'filename' | 'bytes' | 'progress' | 'status' | 'added';
	direction: 'asc' | 'desc';
}

const TorrentsPage = () => {
	const [loading, setLoading] = useState(true);
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);

	useEffect(() => {
		const fetchTorrents = async () => {
			try {
				const accessToken = Cookies.get('accessToken');
				const response = (await getUserTorrentsList(
					accessToken!,
					0,
					1,
					2500,
					''
				)) as UserTorrent[];
				setUserTorrentsList(response);
				setLoading(false);
			} catch (error) {
				console.error('Error fetching user torrents list:', error);
			}
		};
		fetchTorrents();
	}, []);

	const handleDeleteTorrent = async (id: string) => {
		try {
			const accessToken = Cookies.get('accessToken');
			await deleteTorrent(accessToken!, id);
			setUserTorrentsList((prevList) => prevList.filter((t) => t.id !== id));
		} catch (error) {
			console.error(`Error deleting torrent ${id}:`, error);
		}
	};

	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });

	if (loading) {
		return <div>Loading...</div>;
	}

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	function sortedData() {
		if (!sortBy.column) {
			return userTorrentsList;
		}
		return userTorrentsList.sort((a, b) => {
			const isAsc = sortBy.direction === 'asc';
			let comparison = 0;
			if (a[sortBy.column] > b[sortBy.column]) {
				comparison = 1;
			} else if (a[sortBy.column] < b[sortBy.column]) {
				comparison = -1;
			}
			return isAsc ? comparison : comparison * -1;
		});
	}

	return (
		<div className="mx-4 my-8">
			<h1 className="text-3xl font-bold mb-4">My Movies</h1>
			<div className="overflow-x-auto">
				<table className="w-full">
					<thead>
						<tr>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('id')}
							>
								ID{' '}
								{sortBy.column === 'id' && (sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('filename')}
							>
								Filename{' '}
								{sortBy.column === 'filename' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('bytes')}
							>
								Size{' '}
								{sortBy.column === 'bytes' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('progress')}
							>
								Progress{' '}
								{sortBy.column === 'progress' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('status')}
							>
								Status{' '}
								{sortBy.column === 'status' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('added')}
							>
								Added{' '}
								{sortBy.column === 'added' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th className="px-4 py-2">Actions</th>
						</tr>
					</thead>
					<tbody>
						{sortedData().map((torrent) => (
							<tr key={torrent.id} className="border-t-2">
								<td className="border px-4 py-2">{torrent.id.substring(0, 3)}</td>
								<td className="border px-4 py-2">{torrent.filename}</td>
								<td className="border px-4 py-2">
									{(torrent.bytes / 1000000000).toFixed(1)} GB
								</td>
								<td className="border px-4 py-2">{torrent.progress}%</td>
								<td className="border px-4 py-2">{torrent.status}</td>
								<td className="border px-4 py-2">
									{new Date(torrent.added).toLocaleString()}
								</td>
								<td className="border px-4 py-2">
									<button
										className="text-red-500"
										onClick={() => handleDeleteTorrent(torrent.id)}
									>
										<FaTrash />
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default TorrentsPage;
