import Poster from '@/components/poster';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

type BrowseProps = {
	response: Record<string, string[]>;
};

const genres = [
	{
		name: 'Action',
		slug: 'action',
	},
	{
		name: 'Adventure',
		slug: 'adventure',
	},
	{
		name: 'Animation',
		slug: 'animation',
	},
	{
		name: 'Anime',
		slug: 'anime',
	},
	{
		name: 'Comedy',
		slug: 'comedy',
	},
	{
		name: 'Crime',
		slug: 'crime',
	},
	{
		name: 'Documentary',
		slug: 'documentary',
	},
	{
		name: 'Donghua',
		slug: 'donghua',
	},
	{
		name: 'Drama',
		slug: 'drama',
	},
	{
		name: 'Family',
		slug: 'family',
	},
	{
		name: 'Fantasy',
		slug: 'fantasy',
	},
	{
		name: 'History',
		slug: 'history',
	},
	{
		name: 'Holiday',
		slug: 'holiday',
	},
	{
		name: 'Horror',
		slug: 'horror',
	},
	{
		name: 'Music',
		slug: 'music',
	},
	{
		name: 'Musical',
		slug: 'musical',
	},
	{
		name: 'Mystery',
		slug: 'mystery',
	},
	{
		name: 'None',
		slug: 'none',
	},
	{
		name: 'Romance',
		slug: 'romance',
	},
	{
		name: 'Science Fiction',
		slug: 'science-fiction',
	},
	{
		name: 'Short',
		slug: 'short',
	},
	{
		name: 'Sporting Event',
		slug: 'sporting-event',
	},
	{
		name: 'Superhero',
		slug: 'superhero',
	},
	{
		name: 'Suspense',
		slug: 'suspense',
	},
	{
		name: 'Thriller',
		slug: 'thriller',
	},
	{
		name: 'War',
		slug: 'war',
	},
	{
		name: 'Western',
		slug: 'western',
	},
];

export const Browse: FunctionComponent = () => {
	const router = useRouter();
	const { search } = router.query;
	const [data, setData] = useState<BrowseProps | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!search && search !== '') return;

		const fetchData = async () => {
			try {
				const response = await fetch(
					`/api/info/browse${search ? `?search=${search}` : ''}`
				);
				if (!response.ok) {
					throw new Error('Failed to fetch data');
				}
				const result = await response.json();
				setData({ response: result });
			} catch (err) {
				console.error('Error fetching browse data:', err);
				setError('Failed to load data');
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [search]);

	if (isLoading && search) {
		return <div className="mx-2 my-1 text-white">Loading...</div>;
	}

	if (error) {
		return <div className="mx-2 my-1 text-white">Error: {error}</div>;
	}

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Browse</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold">Browse</h1>
				<Link
					href="/"
					className="rounded bg-cyan-800 px-2 py-1 text-sm text-white hover:bg-cyan-700"
				>
					Go Home
				</Link>
			</div>
			{!search ? (
				<div className="flex w-full flex-col items-center">
					<div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
						{genres.map((genre) => (
							<Link
								key={genre.slug}
								href={`/browse/genre/${genre.slug}`}
								className="haptic-sm flex h-12 items-center justify-center rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
							>
								{genre.name}
							</Link>
						))}
					</div>
				</div>
			) : (
				data &&
				Object.keys(data.response).length > 0 && (
					<>
						{Object.keys(data.response).map((listName: string, idx: number) => {
							return (
								<div key={listName}>
									<h2 className="mt-4 text-xl font-bold">
										<span className="text-yellow-500">{idx + 1}</span>{' '}
										{listName}
									</h2>
									<div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
										{data.response[listName].map((key: string) => {
											const matches = key.split(':');
											if (matches.length === 3) {
												const mediaType = key.split(':')[0];
												const imdbid = key.split(':')[1];
												const title = key.split(':')[2];

												return (
													<Link
														key={key}
														href={`/${mediaType}/${imdbid}`}
														className=""
													>
														<Poster imdbId={imdbid} title={title} />
													</Link>
												);
											}
										})}
									</div>
								</div>
							);
						})}
					</>
				)
			)}
		</div>
	);
};

export default withAuth(Browse);
