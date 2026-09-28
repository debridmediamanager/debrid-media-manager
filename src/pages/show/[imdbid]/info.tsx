import TrailerModal from '@/components/TrailerModal';
import { formatGenreForUrl, mapTmdbGenreToTrakt } from '@/utils/genreMapping';
import axios from 'axios';
import { Play, Popcorn } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';

type CastMember = {
	name: string;
	character: string;
	profilePath: string | null;
	slug: string | null;
};

type CrewMember = {
	name: string;
	job: string;
	department: string;
	slug: string | null;
};

type ShowDetails = {
	title: string;
	overview: string;
	firstAirDate: string;
	lastAirDate: string;
	numberOfSeasons: number;
	numberOfEpisodes: number;
	genres: Array<{ id: number; name: string }>;
	voteAverage: number;
	voteCount: number;
	posterPath: string | null;
	backdropPath: string | null;
	status: string;
	type: string;
	cast: CastMember[];
	creators: CrewMember[];
};

export default function ShowInfoPage() {
	const router = useRouter();
	const imdbId = useMemo(() => {
		const raw = router.query.imdbid;
		return typeof raw === 'string' ? raw : '';
	}, [router.query.imdbid]);

	const [showDetails, setShowDetails] = useState<ShowDetails | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [trailerUrl, setTrailerUrl] = useState<string>('');
	const [showTrailerModal, setShowTrailerModal] = useState(false);

	const fetchDetails = useCallback(async () => {
		if (!imdbId) return;
		console.info('Fetching show details', { imdbId });
		setIsLoading(true);
		setStatusMessage(null);
		try {
			const [detailsResponse, infoResponse] = await Promise.all([
				axios.get<ShowDetails>(`/api/info/show-details`, {
					params: { imdbId },
				}),
				axios.get<{ trailer: string }>(`/api/info/show`, {
					params: { imdbid: imdbId },
				}),
			]);
			setShowDetails(detailsResponse.data);
			setTrailerUrl(infoResponse.data.trailer || '');
		} catch (requestError) {
			console.error('Failed to load show details', { imdbId, requestError });
			setStatusMessage('Failed to load show details.');
		} finally {
			setIsLoading(false);
		}
	}, [imdbId]);

	useEffect(() => {
		if (!router.isReady) return;
		void fetchDetails();
	}, [fetchDetails, router.isReady]);

	return (
		<div className="min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>{showDetails?.title || 'Show Info'}</title>
			</Head>

			{showDetails?.backdropPath && (
				<div
					className="h-64 bg-cover bg-center"
					style={{
						backgroundImage: `linear-gradient(to bottom, rgba(17, 24, 39, 0.7), rgba(17, 24, 39, 1)), url(https://image.tmdb.org/t/p/original${showDetails.backdropPath})`,
					}}
				/>
			)}

			{showTrailerModal && trailerUrl && (
				<TrailerModal
					trailerUrl={trailerUrl}
					onClose={() => setShowTrailerModal(false)}
					title={showDetails?.title || ''}
				/>
			)}

			<main className="mx-auto max-w-6xl px-4 py-4">
				<div className="mb-4 flex items-end justify-between gap-3">
					<div className="flex items-center gap-2">
						<h1 className="text-3xl font-bold">{showDetails?.title || 'Loading...'}</h1>
						{trailerUrl && (
							<button
								onClick={() => setShowTrailerModal(true)}
								className="rounded border border-red-500 bg-red-900/30 p-1 text-red-100 transition-colors hover:bg-red-800/50"
								title="Watch trailer"
							>
								<Play size={18} />
							</button>
						)}
						<button
							onClick={() => router.push(`/show/${imdbId}/related`)}
							className="rounded border border-purple-500 bg-purple-900/30 p-1 text-purple-100 transition-colors hover:bg-purple-800/50"
							title="Show related media"
						>
							<Popcorn size={18} />
						</button>
					</div>
					<Link
						href={`/show/${imdbId}/1`}
						className="inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-3 py-1 text-sm text-indigo-100 transition-colors hover:bg-indigo-800/50"
					>
						Back to Show
					</Link>
				</div>

				{statusMessage && (
					<div className="mb-4 rounded border border-yellow-500 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-100">
						{statusMessage}
					</div>
				)}

				{isLoading ? (
					<div>Loading show information…</div>
				) : showDetails ? (
					<div className="space-y-8">
						<div className="grid grid-cols-1 gap-8 md:grid-cols-3">
							<div>
								{showDetails.posterPath && (
									<img
										src={`https://image.tmdb.org/t/p/w500${showDetails.posterPath}`}
										alt={showDetails.title}
										className="w-full rounded-lg shadow-lg"
									/>
								)}
								<div className="mt-4 space-y-2">
									<div className="text-sm">
										<span className="text-gray-400">First Air Date:</span>{' '}
										{showDetails.firstAirDate}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Last Air Date:</span>{' '}
										{showDetails.lastAirDate}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Seasons:</span>{' '}
										{showDetails.numberOfSeasons}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Episodes:</span>{' '}
										{showDetails.numberOfEpisodes}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Status:</span>{' '}
										{showDetails.status}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Rating:</span>{' '}
										{showDetails.voteAverage.toFixed(1)}/10 (
										{showDetails.voteCount} votes)
									</div>
								</div>
							</div>

							<div className="md:col-span-2">
								<div className="mb-4">
									<h2 className="mb-2 text-xl font-semibold">Overview</h2>
									<p className="text-gray-300">{showDetails.overview}</p>
								</div>

								<div className="mb-4">
									<h2 className="mb-2 text-xl font-semibold">Genres</h2>
									<div className="flex flex-wrap gap-2">
										{showDetails.genres
											.filter(
												(genre) => mapTmdbGenreToTrakt(genre.name) !== null
											)
											.map((genre) => (
												<Link
													key={genre.id}
													href={`/browse/genre/${formatGenreForUrl(genre.name)}`}
													className="rounded bg-gray-800 px-3 py-1 text-sm transition-colors hover:bg-gray-700"
												>
													{genre.name}
												</Link>
											))}
									</div>
								</div>

								{showDetails.creators.length > 0 && (
									<div className="mb-4">
										<h2 className="mb-2 text-xl font-semibold">Creators</h2>
										<div className="flex flex-wrap gap-2">
											{showDetails.creators.map((creator, index) => (
												<span key={index}>
													{creator.slug ? (
														<Link
															href={`/person/${creator.slug}/shows`}
															className="text-indigo-400 hover:text-indigo-300"
														>
															{creator.name}
														</Link>
													) : (
														creator.name
													)}
													{index < showDetails.creators.length - 1 &&
														', '}
												</span>
											))}
										</div>
									</div>
								)}

								<div>
									<h2 className="mb-4 text-xl font-semibold">Cast</h2>
									<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
										{showDetails.cast.map((member, index) => {
											const handleClick = (
												event: React.MouseEvent<HTMLButtonElement>
											) => {
												if (!member.slug) return;
												const destination = `/person/${member.slug}/shows`;
												if (event.metaKey || event.ctrlKey) {
													window.open(destination, '_blank');
													return;
												}
												router.push(destination);
											};

											return (
												<button
													key={index}
													onClick={handleClick}
													type="button"
													disabled={!member.slug}
													className={`rounded bg-gray-800/40 p-2 text-center transition-transform ${
														member.slug
															? 'cursor-pointer hover:scale-105 hover:bg-gray-800/70'
															: 'cursor-default'
													}`}
												>
													<div className="mx-auto flex w-full max-w-[200px] flex-col items-center">
														<div className="relative mb-2 aspect-[2/3] w-full overflow-hidden rounded bg-gray-800">
															{member.profilePath ? (
																<img
																	src={`https://image.tmdb.org/t/p/w342${member.profilePath}`}
																	alt={member.name}
																	className="h-full w-full object-cover"
																	loading="lazy"
																/>
															) : (
																<div className="flex h-full items-center justify-center text-gray-400">
																	<div className="p-2 text-center text-sm">
																		No Photo
																	</div>
																</div>
															)}
														</div>
														<div className="w-full">
															<div
																className={`text-sm font-semibold ${
																	member.slug
																		? 'text-indigo-400'
																		: 'text-gray-100'
																}`}
															>
																{member.name}
															</div>
															<div className="text-xs text-gray-400">
																{member.character}
															</div>
														</div>
													</div>
												</button>
											);
										})}
									</div>
								</div>
							</div>
						</div>
					</div>
				) : (
					<div>No show details found.</div>
				)}
			</main>
		</div>
	);
}
