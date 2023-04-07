import { addHashAsMagnet } from '@/api/realDebrid';
import { useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { runConcurrentFunctions } from '@/utils/batch';
import { getMediaId } from '@/utils/mediaId';
import { withAuth } from '@/utils/withAuth';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface UserTorrent {
	filename: string;
	title: string;
	hash: string;
	bytes: number;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
}

interface SortBy {
	column: 'filename' | 'title' | 'bytes' | 'score';
	direction: 'asc' | 'desc';
}

function HashListPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'title', direction: 'asc' });
	const accessToken = useRealDebridAccessToken();

	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieFrequency, _1] = useState<Record<string, number>>({});
	const [tvFrequency, _2] = useState<Record<string, number>>({});
	const [hasDupes, _3] = useState<Array<string>>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);
	const frequencyMap = (torrent: UserTorrent) =>
		torrent.mediaType === 'tv' ? tvFrequency : movieFrequency;
	const [hashList, _4] = useLocalStorage<string[]>('hashes', []);
	const [dlHashList, setDlHashList] = useLocalStorage<string[]>('dlHashes', []);

	const getUserTorrentsList = async (): Promise<UserTorrent[]> => {
		return [];
	};

	// fetch list from api
	useEffect(() => {
		(async () => {
			try {
				const torrents = (await getUserTorrentsList()).map((torrent) => {
					let info = filenameParse(torrent.filename);
					const mediaType = /\bs\d\d/.test(info.title.trim().toLowerCase())
						? 'tv'
						: 'movie';
					if (mediaType === 'tv') {
						info = filenameParse(torrent.filename, true);
					}
					return {
						...torrent,
					};
				}) as UserTorrent[];

				setUserTorrentsList(torrents);
			} catch (error) {
				setUserTorrentsList([]);
				toast.error('Error fetching user torrents list');
			} finally {
				setLoading(false);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// aggregate metadata
	useEffect(() => {
		setGrouping(true);
		setMovieCount(0);
		setTvCount(0);
		setTotalBytes(0);

		let tmpTotalBytes = 0;
		clearFrequencyMap(movieFrequency);
		clearFrequencyMap(tvFrequency);
		for (const torrent of userTorrentsList) {
			tmpTotalBytes += torrent.bytes;
			const mediaId = getMediaId(torrent.info, torrent.mediaType);
			if (mediaId in frequencyMap(torrent)) {
				if (frequencyMap(torrent)[mediaId] === 1) hasDupes.push(mediaId);
				frequencyMap(torrent)[mediaId]++;
			} else {
				frequencyMap(torrent)[mediaId] = 1;
			}
		}

		setMovieCount(Object.keys(movieFrequency).length);
		setTvCount(Object.keys(tvFrequency).length);
		setTotalBytes(tmpTotalBytes);
		setGrouping(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userTorrentsList]);

	// set the list you see
	useEffect(() => {
		setFiltering(true);
		if (Object.keys(router.query).length === 0) {
			setFilteredList(userTorrentsList);
			setFiltering(false);
			return;
		}
		const { filter: titleFilter, mediaType, status } = router.query;
		let tmpList = userTorrentsList;
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === getMediaId(t.info, t.mediaType));
			setFilteredList(tmpList);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(tmpList);
		}
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList, movieFrequency, tvFrequency]);

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

	const handleAddAsMagnet = async (hash: string) => {
		try {
			await addHashAsMagnet(accessToken!, hash);
			setDlHashList([...dlHashList!, hash]);
			toast.success('Successfully added as magnet!');
		} catch (error) {
			toast.error('There was an error adding as magnet. Please try again.');
			throw error;
		}
	};

	function wrapDownloadFn(t: UserTorrent) {
		return async () => await handleAddAsMagnet(t.hash);
	}

	async function addFilteredTorrents() {
		if (!confirm('This will add all torrents listed. Are you sure?')) return;
		const torrentsToAdd = filteredList.map(wrapDownloadFn);
		const [results, errors] = await runConcurrentFunctions(torrentsToAdd, 5, 500);
		if (errors.length) {
			toast.error(`Error adding ${errors.length} torrents`);
		} else if (results.length) {
			toast.success(`Deleted ${results.length} torrents`);
		} else {
			toast('No torrents to add', { icon: '👏' });
		}
	}

	return (
		<div className="mx-4 my-8">
			<Toaster position="top-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					My Collection ({userTorrentsList.length} files in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				{Object.keys(router.query).length === 0 ? (
					<Link
						href="/"
						className="text-2xl bg-blue-300 hover:bg-blue-400 text-white py-1 px-2 rounded"
					>
						Go Home
					</Link>
				) : (
					<Link
						href="/hashlist"
						className="text-2xl bg-red-200 hover:bg-red-300 text-white py-1 px-2 rounded"
					>
						Clear filter
					</Link>
				)}
			</div>
			<div className="mb-4">
				<Link
					href="/hashlist?mediaType=movie"
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
				>
					Show {movieCount} movies
				</Link>
				<Link
					href="/hashlist?mediaType=tv"
					className="mr-2 bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
				>
					Show {tvCount} TV shows
				</Link>
				<button
					className="mr-2 bg-green-400 hover:bg-green-500 text-white font-bold py-2 px-4 rounded"
					onClick={addFilteredTorrents}
				>
					Download all torrents
				</button>
			</div>
			<div className="overflow-x-auto">
				{loading || grouping || filtering ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full">
						<thead>
							<tr>
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
								const frequency =
									frequencyMap(torrent)[
										getMediaId(torrent.info, torrent.mediaType)
									];
								const filterText =
									frequency > 1 && !router.query.filter
										? `${frequency - 1} other file${frequency === 1 ? '' : 's'}`
										: '';
								return (
									<tr key={torrent.hash} className="border-t-2">
										<td className="border px-4 py-2">
											<strong>{torrent.title}</strong>{' '}
											<Link
												className="text-sm text-green-600 hover:text-green-800"
												href={`/hashlist?filter=${getMediaId(
													torrent.info,
													torrent.mediaType
												)}`}
											>
												{filterText}
											</Link>{' '}
											<Link
												target="_blank"
												className="text-sm text-blue-600 hover:text-blue-800"
												href={`/search?query=${getMediaId(
													torrent.info,
													torrent.mediaType
												)}`}
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
											{torrent.score.toFixed(1)}
										</td>
										<td className="border px-4 py-2">
											<button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
												Download
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

export default withAuth(HashListPage);
