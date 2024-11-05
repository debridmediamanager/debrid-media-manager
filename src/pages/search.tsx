import Poster from '@/components/poster';
import { withAuth } from '@/utils/withAuth';
import getConfig from 'next/config';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { SearchResult } from './api/search/title';

function Search() {
	const { publicRuntimeConfig: config } = getConfig();
	const [query, setQuery] = useState('');
	const [typedQuery, setTypedQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');
	const [miscResults, setMiscResults] = useState<Record<string, string[]>>({});

	const router = useRouter();

	const handleSubmit = useCallback(
		(e?: React.FormEvent<HTMLFormElement>) => {
			if (e) e.preventDefault();
			if (!typedQuery) return;
			if (/(tt\d{7,})/.test(typedQuery)) {
				setLoading(true);
				const imdbid = typedQuery.match(/(tt\d{7,})/)?.[1];
				router.push(`/x/${imdbid}/`);
				return;
			}
			router.push({
				query: { query: typedQuery },
			});
		},
		[router, typedQuery]
	);

	useEffect(() => {
		if (Object.keys(router.query).length === 0) return;
		const { query: searchQuery } = router.query;
		const decodedQuery = decodeURIComponent(searchQuery as string);
		if (typedQuery !== decodedQuery) setTypedQuery(decodedQuery);
		setQuery(decodedQuery);
		fetchData(decodedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query]);

	const fetchMiscData = async (q: string) => {
		try {
			let path = `api/search/misc?keyword=${q}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const res = await fetch(endpoint);
			const data = await res.json();
			if (Object.keys(data).length > 0) setMiscResults(data);
			else fetchMiscData('');
		} catch (error: any) {
			console.error(error);
		}
	};

	const fetchData = async (q: string) => {
		setMiscResults({});
		setErrorMessage('');
		setLoading(true);
		setSearchResults([]);
		try {
			let path = `api/search/title?keyword=${q}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const res = await fetch(endpoint);
			const data = await res.json();
			if (data.errorMessage) throw new Error(data.errorMessage);
			setSearchResults(data.results);
			// if (data.results.length === 0) fetchMiscData(q);
		} catch (error: any) {
			setSearchResults([]);
			setErrorMessage(error.message);
			// fetchMiscData(q);
		} finally {
			setLoading(false);
		}
	};

	// if (
	// 	!loading &&
	// 	searchResults.length === 0 &&
	// 	Object.keys(router.query).length === 0 &&
	// 	Object.keys(miscResults).length === 0
	// )
	// 	fetchMiscData('');

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900">
			<Head>
				<title>{`Debrid Media Manager - Search: ${query}`}</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Header with Go Home button */}
			<div className="flex justify-between items-center w-full max-w-md mb-4">
				<h1 className="text-xl font-bold text-white">Search</h1>
				<Link
					href="/"
					className="text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100
						hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
				>
					Go Home
				</Link>
			</div>
			{/* Main content */}
			<div className="w-full max-w-md">
				{/* Search form */}
				<form onSubmit={handleSubmit}>
					<div className="flex items-center border-b-2 border-gray-500 py-2 mb-4">
						<input
							className="appearance-none bg-transparent border-none w-full text-white mr-3 py-1 px-2 leading-tight focus:outline-none"
							type="text"
							id="query"
							placeholder="e.g. breaking bad show, tt1234567, etc."
							value={typedQuery}
							onChange={(e) => setTypedQuery(e.target.value)}
						/>
						<button
							className="flex-shrink-0 px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium haptic-sm"
							type="submit"
						>
							Search
						</button>
					</div>
				</form>
				{/* Display loading indicator */}
				{loading && (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				)}
				{/* Display error message */}
				{errorMessage && (
					<div className="mt-4 bg-red-900 border border-red-400 px-4 py-3 rounded relative">
						<strong className="font-bold">Error:</strong>
						<span className="block sm:inline"> {errorMessage}</span>
					</div>
				)}
				{/* Update search results display */}
				{searchResults.length > 0 && (
					<>
						<h2 className="text-xl font-bold my-4">
							Search Results for <span className="text-yellow-500">{query}</span>
						</h2>
						<div className="grid grid-cols-2 gap-3 w-full">
							{searchResults.map((result: SearchResult) => (
								<Link
									key={result.imdbid}
									className="flex flex-col items-center justify-center gap-2 p-3 rounded border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 transition-colors haptic"
									href={
										result.type === 'movie'
											? `/movie/${result.imdbid}`
											: `/show/${result.imdbid}`
									}
								>
									<Poster imdbId={result.imdbid} title={result.title} />
									<h3 className="text-lg text-slate-300 font-bold">
										{result.title}
									</h3>
									<div className="text-gray-600 text-sm">{result.year}</div>
								</Link>
							))}
						</div>
					</>
				)}
				{/* No results found message */}
				{!loading &&
					searchResults.length === 0 &&
					Object.keys(router.query).length !== 0 && (
						<h2 className="text-xl font-bold my-4">
							No results found for &quot;{query}&quot;
						</h2>
					)}
			</div>
		</div>
	);
}

export default withAuth(Search);
