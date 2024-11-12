import Poster from '@/components/poster';
import { TraktMediaItem, getPopularByGenre, getTrendingByGenre } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import getConfig from 'next/config';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

const { publicRuntimeConfig: config } = getConfig();

type GenrePageProps = {
	trendingMovies: TraktMediaItem[];
	trendingShows: TraktMediaItem[];
	popularMovies: TraktMediaItem[];
	popularShows: TraktMediaItem[];
};

export const Genre: FunctionComponent = () => {
	const router = useRouter();
	const { genre } = router.query;
	const [data, setData] = useState<GenrePageProps | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!genre) return;

		const fetchData = async () => {
			try {
				const genreSlug = typeof genre === 'string' ? genre.replace('genre:', '') : '';
				const [trendingMovies, trendingShows, popularMovies, popularShows] =
					await Promise.all([
						getTrendingByGenre(config.traktClientId, genreSlug, 'movies'),
						getTrendingByGenre(config.traktClientId, genreSlug, 'shows'),
						getPopularByGenre(config.traktClientId, genreSlug, 'movies'),
						getPopularByGenre(config.traktClientId, genreSlug, 'shows'),
					]);

				setData({
					trendingMovies,
					trendingShows,
					popularMovies,
					popularShows,
				});
			} catch (err) {
				console.error('Error fetching genre data:', err);
				setError('Failed to load data');
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [genre]);

	if (isLoading) {
		return <div className="mx-2 my-1 text-white">Loading...</div>;
	}

	if (error) {
		return <div className="mx-2 my-1 text-white">Error: {error}</div>;
	}

	if (!data) {
		return <div className="mx-2 my-1 text-white">No data available</div>;
	}

	const formatMediaKey = (item: TraktMediaItem): string => {
		if (item.movie) {
			return `movie:${item.movie.ids?.imdb}:${item.movie.title}`;
		}
		if (item.show) {
			return `show:${item.show.ids?.imdb}:${item.show.title}`;
		}
		return '';
	};

	const sections = [
		{ title: 'Trending Movies', data: data.trendingMovies },
		{ title: 'Trending Shows', data: data.trendingShows },
		{ title: 'Popular Movies', data: data.popularMovies },
		{ title: 'Popular Shows', data: data.popularShows },
	];

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Browse {genre}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold">Browse {genre}</h1>
				<Link
					href="/browse"
					className="rounded bg-cyan-800 px-2 py-1 text-sm text-white hover:bg-cyan-700"
				>
					Back to Browse
				</Link>
			</div>
			{sections.map(
				(section, sectionIdx) =>
					section.data.length > 0 && (
						<div key={section.title}>
							<h2 className="mt-4 text-xl font-bold">
								<span className="text-yellow-500">{sectionIdx + 1}</span>{' '}
								{section.title}
							</h2>
							<div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
								{section.data.map((item) => {
									const key = formatMediaKey(item);
									if (!key) return null;

									const [mediaType, imdbid, title] = key.split(':');
									if (!imdbid) return null;

									return (
										<Link
											key={key}
											href={`/${mediaType}/${imdbid}`}
											className=""
										>
											<Poster imdbId={imdbid} title={title} />
										</Link>
									);
								})}
							</div>
						</div>
					)
			)}
		</div>
	);
};

export default withAuth(Genre);
