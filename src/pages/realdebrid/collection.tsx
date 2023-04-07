import { deleteTorrent, getUserTorrentsList } from '@/api/realDebrid';
import useLocalStorage from '@/hooks/localStorage';
import getReleaseTags from '@/utils/score';
import { withAuth } from '@/utils/withAuth';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';
import { FaTrash } from 'react-icons/fa';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface UserTorrent {
	id: string;
	filename: string;
	title: string;
	hash: string;
	bytes: number;
	progress: number;
	status: string;
	added: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
}

interface SortBy {
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added' | 'score';
	direction: 'asc' | 'desc';
}

function TorrentsPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });
	const [accessToken] = useLocalStorage<string>('accessToken');
	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieFrequency, _1] = useState<Record<string, number>>({});
	const [tvFrequency, _2] = useState<Record<string, number>>({});
	const [totalBytes, setTotalBytes] = useState<number>(0);
	const frequencyMap = (torrent: UserTorrent) =>
		torrent.mediaType === 'tv' ? tvFrequency : movieFrequency;
	const titleAndYear = (torrent: UserTorrent) => `${torrent.info.title} ${torrent.info.year}`;
	const [_3, setHashList] = useLocalStorage<string[]>('hashes', []);
	const [_4, setDlHashList] = useLocalStorage<string[]>('dlHashes', []);

	// fetch list from api
	useEffect(() => {
		(async () => {
			try {
				const torrents = (await getUserTorrentsList(accessToken!, 0, 1, 2500, '')).map(
					(torrent) => {
						let info = filenameParse(torrent.filename);
						const mediaType = /\bs\d\d/.test(info.title.trim().toLowerCase())
							? 'tv'
							: 'movie';
						if (mediaType === 'tv') {
							info = filenameParse(torrent.filename, true);
						}
						return {
							score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE)
								.score,
							info,
							mediaType,
							title: info.title,
							...torrent,
						};
					}
				) as UserTorrent[];

				setUserTorrentsList(torrents);
				console.log(torrents.map((t) => ({ f: t.filename, b: t.bytes, h: t.hash })));
				setHashList(torrents.filter((t) => t.status === 'downloaded').map((t) => t.hash));
				setDlHashList(torrents.filter((t) => t.status !== 'downloaded').map((t) => t.hash));
			} catch (error) {
				setUserTorrentsList([]);
				setFilteredList([]);
				toast.error('Error fetching user torrents list');
			} finally {
				setLoading(false);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accessToken]);

	// aggregate metadata
	useEffect(() => {
		function groupByParsedTitle(torrents: UserTorrent[]) {
			setMovieCount(0);
			setTvCount(0);
			setTotalBytes(0);

			let tmpTotalBytes = 0;
			clearFrequencyMap(movieFrequency);
			clearFrequencyMap(tvFrequency);
			for (const torrent of torrents) {
				tmpTotalBytes += torrent.bytes;
				if (titleAndYear(torrent) in frequencyMap(torrent)) {
					frequencyMap(torrent)[titleAndYear(torrent)]++;
				} else {
					frequencyMap(torrent)[titleAndYear(torrent)] = 1;
				}
			}

			setMovieCount(Object.keys(movieFrequency).length);
			setTvCount(Object.keys(tvFrequency).length);
			setTotalBytes(tmpTotalBytes);
		}
		groupByParsedTitle(userTorrentsList);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userTorrentsList]);

	// autoselect files
	// useEffect()

	// set the list you see
	useEffect(() => {
		const { filter: titleFilter, mediaType } = router.query;
		if (!titleFilter && !mediaType) {
			setFilteredList(userTorrentsList);
			return;
		}
		let tmpList = userTorrentsList;
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === titleAndYear(t));
			setFilteredList(tmpList);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(tmpList);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList]);

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
			return filteredList;
		}
		filteredList.sort((a, b) => {
			const isAsc = sortBy.direction === 'asc';
			let comparison = 0;
			if (a[sortBy.column] > b[sortBy.column]) {
				comparison = 1;
			} else if (a[sortBy.column] < b[sortBy.column]) {
				comparison = -1;
			}
			return isAsc ? comparison : comparison * -1;
		});
		return filteredList;
	}

	function clearFrequencyMap(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
		}
	}

	return (
		<div className="mx-4 my-8">
			<Toaster />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					My Collection (
					<Link
						href="/realdebrid/collection?mediaType=movie"
						className="text-red-600 hover:text-red-800"
					>
						{movieCount}
					</Link>{' '}
					movies,{' '}
					<Link
						href="/realdebrid/collection?mediaType=tv"
						className="text-red-600 hover:text-red-800"
					>
						{tvCount}
					</Link>{' '}
					tv shows, {movieCount + tvCount} in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				{Object.keys(router.query).length === 0 ? (
					<Link href="/" className="text-2xl text-gray-600 hover:text-gray-800">
						Go Home
					</Link>
				) : (
					<Link
						href="/realdebrid/collection"
						className="text-2xl text-gray-600 hover:text-gray-800"
					>
						Clear filter
					</Link>
				)}
			</div>
			<div className="mb-4">
				<button
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
					onClick={() => {}}
				>
					Delete failed torrents
				</button>
				<button
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
					onClick={() => {}}
				>
					Delete slow torrents
				</button>
				<button
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
					onClick={() => {}}
				>
					Auto select files
				</button>
				<button
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
					onClick={() => {}}
				>
					Show dupes
				</button>
				<button
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
					onClick={() => {}}
				>
					Show unplayable
				</button>
			</div>
			<div className="overflow-x-auto">
				{loading ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full">
						<thead>
							<tr>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('id')}
								>
									ID{' '}
									{sortBy.column === 'id' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('title')}
								>
									Title{' '}
									{sortBy.column === 'title' &&
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
							{sortedData().map((torrent) => {
								const frequency = frequencyMap(torrent)[titleAndYear(torrent)];
								const filterText =
									frequency > 1 && !router.query.filter
										? `${frequency - 1} other file${frequency === 1 ? '' : 's'}`
										: '';
								return (
									<tr key={torrent.id} className="border-t-2">
										<td className="border px-4 py-2">
											{torrent.id.substring(0, 3)}
										</td>
										<td className="border px-4 py-2">
											<strong>{torrent.title}</strong>{' '}
											<Link
												className="text-sm text-green-600 hover:text-green-800"
												href={`/realdebrid/collection?filter=${titleAndYear(
													torrent
												)}`}
											>
												{filterText}
											</Link>{' '}
											<Link
												target="_blank"
												className="text-sm text-blue-600 hover:text-blue-800"
												href={`/search?query=${titleAndYear(torrent)}`}
											>
												Search again
											</Link>
											<br />
											{torrent.filename}
										</td>
										<td className="border px-4 py-2">
											{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
										</td>
										<td className="border px-4 py-2">
											{torrent.status === 'downloading'
												? `${torrent.progress}%`
												: torrent.status}
										</td>
										<td className="border px-4 py-2">
											{new Date(torrent.added).toLocaleString()}
										</td>
										<td className="border px-4 py-2">
											{torrent.score.toFixed(1)}
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
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

export default withAuth(TorrentsPage);
