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
	['Most Played', 'movies/played/weekly'],
	['Most Watched', 'movies/watched/weekly'],
	['Most Collected', 'movies/collected/weekly'],
	['Most Favorited', 'movies/favorited/weekly'],
	['Popular', 'movies/popular'],
	['Trending', 'movies/trending'],
	['Most Anticipated', 'movies/anticipated'],
]);

const showEndpoints = new Map<string, string>([
	['Most Played', 'shows/played/weekly'],
	['Most Watched', 'shows/watched/weekly'],
	['Most Collected', 'shows/collected/weekly'],
	['Most Favorited', 'shows/favorited/weekly'],
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
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Trakt - {title}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">Trakt - {title}</h1>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{Object.keys(arrayOfResults).map((listName: string, idx: number) => (
				<>
					<h2 className="mt-4 text-2xl font-bold" key={idx}>
						<span className="text-yellow-500">{idx + 1}</span> {listName}
					</h2>
					<div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
						{arrayOfResults[listName].map((item: TraktMediaItem) => {
							const imdbid =
								item.movie?.ids.imdb ||
								item.show?.ids.imdb ||
								(item as any).ids.imdb;
							if (!imdbid) {
								return null;
							}
							return (
								<Link key={imdbid} href={`/${mediaType}/${imdbid}`} className="">
									<Poster imdbId={imdbid} />
								</Link>
							);
						})}
					</div>
				</>
			))}
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
			console.log(
				responseCache[endpoint].results.map(
					(item) => item.movie?.ids.imdb || item.show?.ids.imdb || (item as any).ids.imdb
				)
			);
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
			console.log(
				responseCache[endpoint].results.map(
					(item) => item.movie?.ids.imdb || item.show?.ids.imdb || (item as any).ids.imdb
				)
			);
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
