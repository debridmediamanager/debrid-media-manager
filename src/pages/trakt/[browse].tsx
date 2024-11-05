import Poster from '@/components/poster';
import { TraktMediaItem } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

type TraktBrowseProps = {
	mediaType: string;
	arrayOfResults: Record<string, TraktMediaItem[]>;
};

export const TraktBrowse: FunctionComponent = () => {
	const router = useRouter();
	const { browse } = router.query;
	const [data, setData] = useState<TraktBrowseProps | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!browse) return;

		const fetchData = async () => {
			try {
				const response = await fetch(`/api/info/trakt?browse=${browse}`);
				if (!response.ok) {
					throw new Error('Failed to fetch data');
				}
				const result = await response.json();
				setData(result);
			} catch (err) {
				console.error('Error fetching trakt data:', err);
				setError('Failed to load data');
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [browse]);

	if (isLoading) {
		return <div className="mx-2 my-1 bg-gray-900 min-h-screen text-white">Loading...</div>;
	}

	if (error) {
		return <div className="mx-2 my-1 bg-gray-900 min-h-screen text-white">Error: {error}</div>;
	}

	if (!data) {
		return (
			<div className="mx-2 my-1 bg-gray-900 min-h-screen text-white">No data available</div>
		);
	}

	const title = data.mediaType === 'movie' ? 'Movies 🎥' : 'Shows 📺';

	return (
		<div className="mx-2 my-1 bg-gray-900 min-h-screen">
			<Head>
				<title>Debrid Media Manager - Trakt - {title}</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold text-white">Trakt - {title}</h1>
				<Link
					href="/"
					className="text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
				>
					Go Home
				</Link>
			</div>

			<div className="flex flex-col items-center w-full max-w-7xl gap-6">
				{Object.keys(data.arrayOfResults)
					.sort()
					.map((listName: string, idx: number) => (
						<div key={listName} className="w-full">
							<h2 className="text-xl font-bold text-white mb-4">
								<span className="text-yellow-500">{idx + 1}</span> {listName}
							</h2>
							<div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
								{data.arrayOfResults[listName].map((item: TraktMediaItem) => {
									const imdbid =
										item.movie?.ids?.imdb ||
										item.show?.ids?.imdb ||
										(item as any).ids?.imdb;
									if (!imdbid) {
										return null;
									}
									const title =
										item.movie?.title ||
										item.show?.title ||
										(item as any).title;
									return (
										<Link
											key={imdbid}
											href={`/${data.mediaType}/${imdbid}`}
											className=""
										>
											<Poster imdbId={imdbid} title={title} />
										</Link>
									);
								})}
							</div>
						</div>
					))}
			</div>
		</div>
	);
};

export default withAuth(TraktBrowse);
