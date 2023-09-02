import Poster from '@/components/poster';
import { SearchResult } from '@/services/btdigg';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

function Search() {
	const [query, setQuery] = useState('');
	const [typedQuery, setTypedQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');

	const router = useRouter();

	const fetchData = async (query: string) => {
		setLoading(true);
		try {
			const res = await fetch(`/api/keywordsearch?keyword=${query}`);
			const data = await res.json();
			setSearchResults(data.results);
		} catch (error: any) {
			setErrorMessage(error.message);
		} finally {
			setLoading(false);
		}
	};

	const handleSubmit = useCallback(
		(e?: React.FormEvent<HTMLFormElement>) => {
			if (e) e.preventDefault();
			if (!typedQuery) return;
			router.push({
				query: { query: typedQuery },
			});
		},
		[router, typedQuery]
	);

	useEffect(() => {
		const { query: searchQuery } = router.query;
		if (!searchQuery) return;
		const decodedQuery = decodeURIComponent(searchQuery as string);
		if (decodedQuery === query) return;
		setTypedQuery(decodedQuery);
		setQuery(decodedQuery);
		fetchData(decodedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query]);

	return (
		<div className="mx-4 my-8 max-w-full">
			<Head>
				<title>Debrid Media Manager - Search: {query}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">Search</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			<form onSubmit={handleSubmit}>
				<div className="flex items-center border-b border-b-2 border-gray-500 py-2 mb-4">
					<input
						className="appearance-none bg-transparent border-none w-full text-gray-700 mr-3 py-1 px-2 leading-tight focus:outline-none"
						type="text"
						id="query"
						placeholder="type a movie or show name"
						value={typedQuery}
						onChange={(e) => setTypedQuery(e.target.value)}
					/>
					<button
						className="flex-shrink-0 bg-gray-700 hover:bg-gray-600 border-gray-700 hover:border-gray-600 text-sm border-4 text-white py-1 px-2 rounded"
						type="submit"
					>
						Search
					</button>
				</div>
			</form>
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
			{searchResults.length > 0 && (
				<>
					<h2 className="text-2xl font-bold my-4">
						Search Results for &quot;{query}&quot;
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						{searchResults.map((result) => (
							<div key={result.id} className="bg-white shadow-lg rounded-lg p-6">
								<Poster
									imdbId={result.imdbid}
									className="w-full h-64 object-cover object-center rounded-t-lg"
								/>
								<div className="mt-4">
									<h3 className="text-lg font-bold mb-2">{result.title}</h3>
									<p className="text-gray-600 text-sm">Year: {result.year}</p>
									<p className="text-gray-600 text-sm">Score: {result.score}</p>
									{result.type === 'movie' ? (
										<Link
											href={`/movie/${result.imdbid}`}
											className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-700 rounded"
										>
											<span role="img" aria-label="movie" className="mr-2">
												🎥
											</span>{' '}
											View
										</Link>
									) : (
										<>
											{Array.from(
												{ length: result.season_count || 0 },
												(_, i) => i + 1
											).map((season) => (
												<Link
													key={season}
													href={`/show/${result.imdbid}/${season}`}
													className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-700 rounded mr-2 mb-2"
												>
													<span
														role="img"
														aria-label="tv show"
														className="mr-2"
													>
														📺
													</span>{' '}
													Season {season}
												</Link>
											))}
										</>
									)}
								</div>
							</div>
						))}
					</div>
				</>
			)}
			{Object.keys(router.query).length !== 0 && searchResults.length === 0 && !loading && (
				<>
					<h2 className="text-2xl font-bold my-4">
						No results found for &quot;{query}&quot;
					</h2>
				</>
			)}
		</div>
	);
}

export default withAuth(Search);
