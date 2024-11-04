import Poster from '@/components/poster';
import { PlanetScaleCache } from '@/services/planetscale';
import { TraktMediaItem, getMediaData } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { FunctionComponent } from 'react';
import { Toaster } from 'react-hot-toast';

const movieEndpoints = new Map<string, string>([
	['Box Office', 'movies/boxoffice'],
	['Most Played Today', 'movies/played/daily'],
	['Most Played This Month', 'movies/played/monthly'],
	['Most Played All Time', 'movies/played/all'],
	['Most Watched Today', 'movies/watched/daily'],
	['Most Watched This Month', 'movies/watched/monthly'],
	['Most Watched', 'movies/watched/all'],
	['Most Collected Today', 'movies/collected/daily'],
	['Most Collected This Month', 'movies/collected/monthly'],
	['Most Collected All Time', 'movies/collected/all'],
	['Most Favorited Today', 'movies/favorited/daily'],
	['Most Favorited This Month', 'movies/favorited/monthly'],
	['Most Favorited All Time', 'movies/favorited/all'],
	['Popular', 'movies/popular'],
	['Trending', 'movies/trending'],
	['Most Anticipated', 'movies/anticipated'],
]);

const showEndpoints = new Map<string, string>([
	['Most Played Today', 'shows/played/daily'],
	['Most Played This Month', 'shows/played/monthly'],
	['Most Played All Time', 'shows/played/all'],
	['Most Watched Today', 'shows/watched/daily'],
	['Most Watched This Month', 'shows/watched/monthly'],
	['Most Watched All Time', 'shows/watched/all'],
	['Most Collected Today', 'shows/collected/daily'],
	['Most Collected This Month', 'shows/collected/monthly'],
	['Most Collected All Time', 'shows/collected/all'],
	['Most Favorited Today', 'shows/favorited/daily'],
	['Most Favorited This Month', 'shows/favorited/monthly'],
	['Most Favorited All Time', 'shows/favorited/all'],
	['Popular', 'shows/popular'],
	['Trending', 'shows/trending'],
	['Most Anticipated', 'shows/anticipated'],
]);

type TraktBrowseProps = {
	mediaType: string;
	arrayOfResults: Record<string, TraktMediaItem[]>;
};

export const TraktBrowse: FunctionComponent<TraktBrowseProps> = ({ mediaType, arrayOfResults }) => {
	const title = mediaType === 'movie' ? 'Movies 🎥' : 'Shows 📺';
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
				{Object.keys(arrayOfResults)
					.sort()
					.map((listName: string, idx: number) => (
						<div key={listName} className="w-full">
							<h2 className="text-xl font-bold text-white mb-4">
								<span className="text-yellow-500">{idx + 1}</span> {listName}
							</h2>
							<div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
								{arrayOfResults[listName].map((item: TraktMediaItem) => {
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
											href={`/${mediaType}/${imdbid}`}
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

type TraktBrowseResponseCache = {
	lastUpdated: number;
	results: TraktMediaItem[];
};
const responseCache: Record<string, TraktBrowseResponseCache> = {};

const traktClientID = process.env.TRAKT_CLIENT_ID;
const db = new PlanetScaleCache();

export const getServerSideProps: GetServerSideProps = async (context) => {
	const { params } = context;
	let mediaType = 'movie';
	if (params?.browse) {
		mediaType = (params.browse as string).toLowerCase() === 'shows' ? 'show' : 'movie';
	}

	const arrayOfResults: Record<string, TraktMediaItem[]> = {};

	let endpoints = mediaType === 'movie' ? movieEndpoints : showEndpoints;
	const keys = Array.from(endpoints.keys());
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const endpoint = endpoints.get(key)!;
		if (
			responseCache[endpoint] &&
			responseCache[endpoint].results.length &&
			responseCache[endpoint].lastUpdated > new Date().getTime() - 1000 * 60 * 10
		) {
			arrayOfResults[key] = responseCache[endpoint].results;
			continue;
		}

		try {
			let searchResults = await db.getSearchResults<TraktMediaItem[]>(`trakt:${endpoint}`);
			if (!searchResults?.length) {
				searchResults = await getMediaData(traktClientID!, endpoint);
				await db.saveSearchResults(`trakt:${endpoint}`, searchResults);
			}
			responseCache[endpoint] = {
				lastUpdated: new Date().getTime(),
				results: searchResults,
			};
			arrayOfResults[key] = responseCache[endpoint].results;
		} catch (error: any) {
			console.error(error);
			return {
				notFound: true,
			};
		}
	}

	return {
		props: {
			mediaType,
			arrayOfResults,
		},
	};
};

export default withAuth(TraktBrowse);
