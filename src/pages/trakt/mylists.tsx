import Poster from '@/components/poster';
import { TraktMediaItem } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';

function TraktMyLists() {
	const arrayOfResults: Record<string, TraktMediaItem[]> = {
		'List 1': [],
	};
	const title = 'My lists 🧏🏻‍♀️';
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
								<Link key={imdbid} href={`/movies/${imdbid}`} className="">
									<Poster imdbId={imdbid} />
								</Link>
							);
						})}
					</div>
				</>
			))}
		</div>
	);
}

export default withAuth(TraktMyLists);
