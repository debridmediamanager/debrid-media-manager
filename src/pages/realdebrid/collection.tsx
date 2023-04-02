import { deleteTorrent, getUserTorrentsList } from '@/api/realDebrid';
import useLocalStorage from '@/hooks/localStorage';
import getReleaseTags from '@/utils/score';
import { withAuth } from '@/utils/withAuth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FaTrash } from 'react-icons/fa';

interface UserTorrent {
	id: string;
	filename: string;
	hash: string;
	bytes: number;
	progress: number;
	status: string;
	added: string;
	score: number;
}

interface SortBy {
	column: 'id' | 'filename' | 'bytes' | 'progress' | 'status' | 'added' | 'score';
	direction: 'asc' | 'desc';
}

function TorrentsPage() {
	const [loading, setLoading] = useState(true);
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });
	const [accessToken] = useLocalStorage<string>('accessToken');

	useEffect(() => {
		const fetchTorrents = async () => {
			try {
				const torrents = (await getUserTorrentsList(accessToken!, 0, 1, 2500, '')).map(
					(torrent) => ({
						score: getReleaseTags(torrent.filename, torrent.bytes / 1000000000).score,
						...torrent,
					})
				) as UserTorrent[];
				setUserTorrentsList(torrents);
			} catch (error) {
				setUserTorrentsList([]);
				toast.error('Error fetching user torrents list');
			} finally {
				setLoading(false);
			}
		};
		fetchTorrents();
	}, [accessToken]);

	const handleDeleteTorrent = async (id: string) => {
		try {
			await deleteTorrent(accessToken!, id);
			setUserTorrentsList((prevList) => prevList.filter((t) => t.id !== id));
		} catch (error) {
			toast.error(`Error deleting torrent ${id}`);
		}
	};

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

	if (loading) {
		return <div>Loading...</div>;
	}

	return (
		<div className="mx-4 my-8">
			<Toaster />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">My Collection</h1>
				<Link href="/" className="text-2xl text-gray-600 hover:text-gray-800">
					Home
				</Link>
			</div>
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
							<th
								className="px-4 py-2 cursor-pointer"
								onClick={() => handleSort('score')}
							>
								Score{' '}
								{sortBy.column === 'score' &&
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
								<td className="border px-4 py-2">{torrent.score.toFixed(1)}</td>
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
}

export default withAuth(TorrentsPage);
