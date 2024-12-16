import Poster from '@/components/poster';
import { TraktMediaItem } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

type Category = {
	name: string;
	results: Record<string, TraktMediaItem[]>;
};

type TraktBrowseProps = {
	mediaType: string;
	categories: Category[];
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
		return <div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">Loading...</div>;
	}

	if (error) {
		return <div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">Error: {error}</div>;
	}

	if (!data) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">No data available</div>
		);
	}

	const title = data.mediaType === 'movie' ? 'Movies 🎥' : 'Shows 📺';

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Trakt - {title}</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">Trakt - {title}</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>

			<div className="flex w-full max-w-7xl flex-col items-center gap-6">
				{data.categories.map((category, categoryIndex) => (
					<div key={category.name} className="w-full">
						<h2 className="mb-4 text-xl font-bold text-white">
							<span className="text-yellow-500">{categoryIndex + 1}</span>{' '}
							{category.name}
						</h2>
						{Object.entries(category.results).map(([listName, items]) => (
							<div key={listName} className="mb-6 last:mb-0">
								<h3 className="mb-4 text-lg font-semibold text-gray-300">
									{listName}
								</h3>
								<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
									{items.map((item: TraktMediaItem) => {
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
				))}
			</div>
		</div>
	);
};

export default withAuth(TraktBrowse);
