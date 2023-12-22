import Poster from '@/components/poster';
import MdbList from '@/services/mdblist';
import { lcg, shuffle } from '@/utils/seededShuffle';
import { withAuth } from '@/utils/withAuth';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { FunctionComponent } from 'react';
import { Toaster } from 'react-hot-toast';

type BrowseProps = {
	response: Record<string, string[]>;
};

export const Browse: FunctionComponent<BrowseProps> = ({ response }) => {
	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Recently Updated</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-xl font-bold">Browse</h1>
				<p>This page refreshes content every 10 minutes</p>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{Object.keys(response).length > 0 && (
				<>
					{Object.keys(response).map((listName: string, idx: number) => {
						return (
							<>
								<h2 className="mt-4 text-xl font-bold" key={idx}>
									<span className="text-yellow-500">{idx + 1}</span> {listName}
								</h2>
								<div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
									{response[listName].map((key: string) => {
										const match = key.match(/^(movie|show):(.+)/);
										if (match) {
											const mediaType =
												match[1] === 'movie' ? 'movie' : 'show';
											const imdbid = match[2];

											return (
												<Link
													key={key}
													href={`/${mediaType}/${imdbid}`}
													className=""
												>
													<Poster imdbId={imdbid} />
												</Link>
											);
										}
									})}
								</div>
							</>
						);
					})}
				</>
			)}
		</div>
	);
};

type BrowseResponse = Record<string, string[]>;
type BrowseResponseCache = {
	lastUpdated: number;
	response: BrowseResponse;
};
const responses: Record<string, BrowseResponseCache> = {};

export const getServerSideProps: GetServerSideProps = async (context) => {
	const { params } = context;
	let key = 'index';
	if (params?.search) {
		key = decodeURIComponent(params.search as string).toLowerCase();
		key = key.replace(/[^a-z\s]/g, ' ');
	}

	if (responses[key] && responses[key].lastUpdated > new Date().getTime() - 1000 * 60 * 10) {
		return {
			props: {
				response: responses[key].response,
			},
		};
	}

	const mdblist = new MdbList();
	let topLists;
	if (key === 'index') {
		topLists = await mdblist.topLists();
	} else {
		topLists = await mdblist.searchLists(key);
	}

	let rng = lcg(new Date().getTime() / 1000 / 60 / 10);
	topLists = shuffle(topLists, rng).slice(0, 4);

	const response: BrowseResponse = {};
	for (const list of topLists) {
		const itemsResponse = await mdblist.listItems(list.id);
		response[list.name] = itemsResponse
			.filter((item) => item.imdb_id)
			.slice(0, 24)
			.map((item) => `${list.mediatype}:${item.imdb_id}`);
		response[list.name] = shuffle(response[list.name], rng);
	}

	responses[key] = {
		lastUpdated: new Date().getTime(),
		response,
	};

	return {
		props: {
			response,
		},
	};
};

export default withAuth(Browse);
