import useLocalStorage from '@/hooks/localStorage';
import { addHashAsMagnet } from '@/services/realDebrid';
import { runConcurrentFunctions } from '@/utils/batch';
import { getMediaId } from '@/utils/mediaId';
import getReleaseTags from '@/utils/score';
import { withAuth } from '@/utils/withAuth';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
import lzString from 'lz-string';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface TorrentHash {
	filename: string;
	hash: string;
	bytes: number;
}

interface UserTorrent extends TorrentHash {
	title: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	duplicate: boolean;
	alreadyDownloading: boolean;
}

interface SortBy {
	column: 'filename' | 'title' | 'bytes' | 'score';
	direction: 'asc' | 'desc';
}

function TorrentsPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'title', direction: 'asc' });
	const [accessToken] = useLocalStorage<string>('accessToken');
	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieGrouping, _1] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode, _2] = useState<Record<string, number>>({});
	const [tvGroupingByTitle, _3] = useState<Record<string, number>>({});
	const [hasDupes, _4] = useState<Array<string>>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);
	const [hashList, _5] = useLocalStorage<string[]>('hashes', []);
	const [dlHashList, setDlHashList] = useLocalStorage<string[]>('dlHashes', []);

	const getUserTorrentsList = async (): Promise<TorrentHash[]> => {
		const hash = window.location.hash;
		console.log(hash);
		if (!hash) return [];
		const jsonString = lzString.decompressFromEncodedURIComponent(hash.substring(1));
		return JSON.parse(jsonString) as TorrentHash[];
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
						score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE).score,
						info,
						mediaType,
						title: getMediaId(info, mediaType, false),
						duplicate: hashList?.includes(torrent.hash),
						alreadyDownloading: dlHashList?.includes(torrent.hash),
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
	}, [accessToken]);

	// aggregate metadata
	useEffect(() => {
		setGrouping(true);
		setMovieCount(0);
		setTvCount(0);
		setTotalBytes(0);

		let tmpTotalBytes = 0;
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		for (const t of userTorrentsList) {
			tmpTotalBytes += t.bytes;
			const mediaId = getMediaId(t.info, t.mediaType);
			if (mediaId in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[mediaId] === 1) hasDupes.push(mediaId);
				getGroupings(t.mediaType)[mediaId]++;
			} else {
				getGroupings(t.mediaType)[mediaId] = 1;
			}
			if (t.mediaType === 'tv') {
				const title = getMediaId(t.info, t.mediaType, true, true);
				if (title in tvGroupingByTitle) {
					tvGroupingByTitle[title]++;
				} else {
					tvGroupingByTitle[title] = 1;
				}
			}
		}

		setMovieCount(Object.keys(movieGrouping).length);
		setTvCount(Object.keys(tvGroupingByTitle).length);
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
		const { filter: titleFilter, mediaType } = router.query;
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
	}, [router.query, userTorrentsList, movieGrouping, tvGroupingByEpisode]);

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

	const getGroupings = (mediaType: UserTorrent['mediaType']) =>
		mediaType === 'tv' ? tvGroupingByEpisode : movieGrouping;

	function clearGroupings(frequencyMap: { [x: string]: number }) {
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
		}
	};

	function wrapSelectFilesFn(t: UserTorrent) {
		return async () => await handleAddAsMagnet(t.hash);
	}

	async function downloadNonDupeTorrents() {
		const yetToDownload = filteredList
			.filter((t) => !hashList!.includes(t.hash))
			.filter((t) => !dlHashList!.includes(t.hash))
			.map(wrapSelectFilesFn);
		const [results, errors] = await runConcurrentFunctions(yetToDownload, 2, 500);
		if (errors.length) {
			toast.error(`Error downloading files on ${errors.length} torrents`);
		} else if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`);
		} else {
			toast('Everything has been downloaded', { icon: '👏' });
		}
	}

	return (
		<div className="mx-4 my-8">
			<Toaster position="top-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					Share this page ({userTorrentsList.length} files in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			<div className="mb-4">
				<Link
					href="/hashlist?mediaType=movie"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded"
				>
					Show {movieCount} movies
				</Link>
				<Link
					href="/hashlist?mediaType=tv"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded"
				>
					Show {tvCount} TV shows
				</Link>
				<button
					className={`mr-2 mb-2 bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded ${
						filteredList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={downloadNonDupeTorrents}
					disabled={filteredList.length === 0}
				>
					Download all (non-duplicate) torrents
				</button>

				{Object.keys(router.query).length !== 0 && (
					<Link
						href="/hashlist"
						className="mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-2 px-4 rounded"
					>
						Clear filter
					</Link>
				)}
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
							{sortedData().map((t) => {
								const groupCount = getGroupings(t.mediaType)[
									getMediaId(t.info, t.mediaType)
								];
								const filterText =
									groupCount > 1 && !router.query.filter
										? `${groupCount - 1} other file${
												groupCount === 1 ? '' : 's'
										  }`
										: '';
								return (
									<tr
										key={t.hash}
										className={`
									hover:bg-yellow-100
									cursor-pointer
									border-t-2
									${t.duplicate && 'bg-green-100'}
									${t.alreadyDownloading && 'bg-red-100'}
								`}
									>
										<td className="border px-4 py-2">
											<strong>{t.title}</strong>{' '}
											<Link
												className="text-sm text-green-600 hover:text-green-800"
												href={`/hashlist?filter=${getMediaId(
													t.info,
													t.mediaType
												)}`}
											>
												{filterText}
											</Link>{' '}
											<Link
												target="_blank"
												className="text-sm text-blue-600 hover:text-blue-800"
												href={`/search?query=${getMediaId(
													t.info,
													t.mediaType
												)}`}
											>
												Search again
											</Link>
											<br />
											{t.filename}
										</td>
										<td className="border px-4 py-2">
											{(t.bytes / ONE_GIGABYTE).toFixed(1)} GB
										</td>
										<td className="border px-4 py-2">{t.score.toFixed(1)}</td>
										<td className="border px-4 py-2">
											<button
												className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ${
													t.alreadyDownloading || t.duplicate
														? 'opacity-60 cursor-not-allowed'
														: ''
												}`}
												onClick={() => {
													handleAddAsMagnet(t.hash);
												}}
												disabled={t.alreadyDownloading || t.duplicate}
											>
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

export default withAuth(TorrentsPage);
