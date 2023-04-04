import { addHashAsMagnet } from '@/api/realDebrid';
import useMyAccount from '@/hooks/account';
import { useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { withAuth } from '@/utils/withAuth';
import { filenameParse } from '@ctrl/video-filename-parser';
import axios, { CancelTokenSource } from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { BtDiggApiResult } from './api/btdigg';

type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
	duplicate: boolean;
	alreadyDownloading: boolean;
};

function Search() {
	const [query, setQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const accessToken = useRealDebridAccessToken();
	const [loading, setLoading] = useState(false);
	const [cancelTokenSource, setCancelTokenSource] = useState<CancelTokenSource | null>(null);
	const [myAccount, _1] = useMyAccount();
	const [hashList, _2] = useLocalStorage<string[]>('hashes', []);
	const [dlHashList, _3] = useLocalStorage<string[]>('dlHashes', []);

	const router = useRouter();

	const fetchData = async (searchQuery: string) => {
		setSearchResults([]);
		setErrorMessage('');
		setLoading(true);
		const source = axios.CancelToken.source();
		setCancelTokenSource(source);
		try {
			const params = {
				search: searchQuery,
				...(myAccount?.libraryType ? { ['libraryType']: myAccount.libraryType } : {}),
			};
			const response = await axios.get<BtDiggApiResult>('/api/btdigg', {
				params,
				cancelToken: source.token,
			});
			const responseResults: SearchResult[] = response.data.searchResults!.map((e) => {
				(e as any).duplicate = hashList?.includes(e.hash);
				(e as any).alreadyDownloading = dlHashList?.includes(e.hash);
				return e as unknown as SearchResult;
			});
			setSearchResults(responseResults || []);
		} catch (error) {
			if (axios.isCancel(error)) {
				console.warn('Request canceled:', error);
			} else {
				setErrorMessage('There was an error searching for the query. Please try again.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleSubmit = useCallback(
		(e?: React.FormEvent<HTMLFormElement>) => {
			if (e) e.preventDefault();
			if (!query) return;
			router.push(`/search?query=${encodeURIComponent(query)}`);
		},
		[router, query]
	);

	useEffect(() => {
		const { query: searchQuery } = router.query;
		if (!searchQuery) return;
		const decodedQuery = decodeURIComponent(searchQuery as string);
		setQuery(decodedQuery);
		fetchData(decodedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query]);

	useEffect(() => {
		return () => {
			if (cancelTokenSource) cancelTokenSource.cancel();
		};
	}, [cancelTokenSource]);

	const handleAddAsMagnet = async (hash: string) => {
		try {
			await addHashAsMagnet(accessToken!, hash);
			toast.success('Successfully added as magnet!');
		} catch (error) {
			toast.error('There was an error adding as magnet. Please try again.');
		}
	};

	return (
		<div className="mx-4 my-8">
			<Toaster />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">Search</h1>
				<Link href="/" className="text-2xl text-gray-600 hover:text-gray-800">
					Go Home
				</Link>
			</div>
			<form onSubmit={handleSubmit}>
				<div className="flex items-center border-b border-b-2 border-gray-500 py-2">
					<input
						className="appearance-none bg-transparent border-none w-full text-gray-700 mr-3 py-1 px-2 leading-tight focus:outline-none"
						type="text"
						id="query"
						placeholder="if movie, add year e.g. greatest showman 2017; if tv series, add s01 e.g. game of thrones s01"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<button
						className="flex-shrink-0 bg-gray-700 hover:bg-gray-800 border-gray-700 hover:border-gray-800 text-sm border-4 text-white py-1 px-2 rounded"
						type="submit"
					>
						Search
					</button>
				</div>
				{loading && (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				)}
				{errorMessage && (
					<div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
						<strong className="font-bold">Error:</strong>
						<span className="block sm:inline"> {errorMessage}</span>
					</div>
				)}
			</form>
			{searchResults.length > 0 && (
				<>
					<h2 className="text-2xl font-bold my-4">Search Results</h2>
					<div className="overflow-x-auto">
						<table className="w-full table-auto">
							<thead>
								<tr>
									<th className="px-4 py-2">Title</th>
									<th className="px-4 py-2">Size</th>
									<th className="px-4 py-2"></th>
								</tr>
							</thead>
							<tbody>
								{searchResults.map((result: SearchResult, index: number) => (
									<tr
										key={index}
										className={`
											hover:bg-gray-100
											cursor-pointer
											${result.duplicate && 'bg-green-100'}
											${result.alreadyDownloading && 'bg-red-100'}
										`}
										onClick={() => {
											handleAddAsMagnet(result.hash);
										}}
									>
										<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
											<strong>{filenameParse(result.title).title}</strong>
											<br />
											{result.title}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{result.fileSize} GB
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
											<button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
												Add as Magnet
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
			{searchResults.length === 0 && !loading && (
				<>
					<h2 className="text-2xl font-bold my-4">No results found</h2>
				</>
			)}
		</div>
	);
}

export default withAuth(Search);
