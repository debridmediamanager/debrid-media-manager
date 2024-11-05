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

	if (isLoading) {
		return <div className="mx-2 my-1 text-white">Loading...</div>;
	}

	if (error) {
		return <div className="mx-2 my-1 text-white">Error: {error}</div>;
	}

	if (!data) {
		return <div className="mx-2 my-1 text-white">No data available</div>;
	}

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Recently Updated</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">Browse</h1>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{Object.keys(data.response).length > 0 && (
				<>
					{Object.keys(data.response).map((listName: string, idx: number) => {
						return (
							<div key={listName}>
								<h2 className="mt-4 text-xl font-bold">
									<span className="text-yellow-500">{idx + 1}</span> {listName}
								</h2>
								<div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
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
			)}
		</div>
	);
};

export default withAuth(Browse);
