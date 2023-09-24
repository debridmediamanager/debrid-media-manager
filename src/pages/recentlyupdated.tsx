import Poster from '@/components/poster';
import { PlanetScaleCache } from '@/services/planetscale';
import { withAuth } from '@/utils/withAuth';
import { GetServerSideProps, NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';

interface RecentlyUpdatedProps {
	searchResults: string[];
}

const db = new PlanetScaleCache();

const RecentlyUpdated: NextPage<RecentlyUpdatedProps> = ({ searchResults }) => {
	return (
		<div className="mx-4 my-8 max-w-full">
			<Head>
				<title>Debrid Media Manager - Recently Updated</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">Recently Updated</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{searchResults.length > 0 && (
				<>
					<div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
						{searchResults.map((key: string) => {
							const match = key.match(/^(movie|tv):(.+)/);
							if (match) {
								const mediaType = match[1] === 'movie' ? 'movie' : 'show';
								const imdbid = match[2];

								return (
									<Link key={key} href={`/${mediaType}/${imdbid}`} className="">
										<Poster
											imdbId={imdbid}
											className="w-full h-64 object-cover object-center rounded-t-lg"
										/>
									</Link>
								);
							}
							return null;
						})}
					</div>
				</>
			)}
		</div>
	);
};
export const getServerSideProps: GetServerSideProps<RecentlyUpdatedProps> = async ({
	req,
	res,
}) => {
	res.setHeader('Cache-Control', 'public, s-maxage=600 , stale-while-revalidate=300');
	try {
		const data = Array.from(new Set(await db.getRecentlyUpdatedContent()));

		return {
			props: {
				searchResults: data,
			},
		};
	} catch (error: any) {
		return {
			props: {
				searchResults: [],
			},
		};
	}
};

export default withAuth(RecentlyUpdated);
