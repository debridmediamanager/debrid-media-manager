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
		} catch (error: any) {
			setSearchResults([]);
			setErrorMessage(error.message);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>{`Debrid Media Manager - Search: ${query}`}</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Header with Go Home button */}
			<div className="mb-4 flex w-full max-w-3xl items-center justify-between">
				<h1 className="text-xl font-bold text-white">Search</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
			{/* Main content */}
			<div className="w-full">
				{/* Search form - keep reasonable width for usability */}
				<div className="mx-auto max-w-3xl">
					<form onSubmit={handleSubmit}>
						<div className="mb-4 flex items-center border-b-2 border-gray-500 py-2">
							<input
								className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 leading-tight text-white focus:outline-none"
								type="text"
								id="query"
								placeholder="e.g. breaking bad show, tt1234567, etc."
								value={typedQuery}
								onChange={(e) => setTypedQuery(e.target.value)}
							/>
							<button
								className="haptic-sm flex-shrink-0 rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
								type="submit"
							>
								Search
							</button>
						</div>
					</form>
				</div>
				{/* Display loading indicator */}
				{loading && (
					<div className="mt-4 flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
					</div>
				)}
				{/* Display error message */}
				{errorMessage && (
					<div className="relative mx-auto mt-4 max-w-3xl rounded border border-red-400 bg-red-900 px-4 py-3">
						<strong className="font-bold">Error:</strong>
						<span className="block sm:inline"> {errorMessage}</span>
					</div>
				)}
				{/* Update search results display */}
				{searchResults.length > 0 && (
					<>
						<h2 className="mx-auto my-4 max-w-3xl text-xl font-bold">
							Search Results for <span className="text-yellow-500">{query}</span>
						</h2>
						<div className="grid w-full grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
							{searchResults.map((result: SearchResult) => (
								<Link
									key={result.imdbid}
									className="haptic flex flex-col items-center justify-center gap-2 rounded border-2 border-cyan-500 bg-cyan-900/30 p-3 text-cyan-100 transition-colors hover:bg-cyan-800/50"
									href={
										result.type === 'movie'
											? `/movie/${result.imdbid}`
											: `/show/${result.imdbid}`
									}
								>
									<Poster imdbId={result.imdbid} title={result.title} />
									<h3 className="text-center text-lg font-bold text-slate-300">
										{result.title}
									</h3>
									<div className="text-sm text-gray-600">{result.year}</div>
								</Link>
							))}
						</div>
					</>
				)}
				{/* No results found message */}
				{!loading &&
					searchResults.length === 0 &&
					Object.keys(router.query).length !== 0 && (
						<h2 className="mx-auto my-4 max-w-3xl text-xl font-bold">
							No results found for &quot;{query}&quot;
						</h2>
					)}
			</div>
		</div>
	);
}

export default withAuth(Search);
