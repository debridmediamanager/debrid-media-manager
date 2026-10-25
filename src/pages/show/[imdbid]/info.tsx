import TrailerModal from '@/components/TrailerModal';
import { formatGenreForUrl, mapTmdbGenreToTrakt } from '@/utils/genreMapping';
import { showAirDatesTitle, showMetaParts } from '@/utils/infoMeta';
import axios from 'axios';
import { ArrowLeft, Play, Popcorn } from 'lucide-react';
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
					className="h-24 bg-cover bg-center md:h-64"
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
				<div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
					<h1 className="min-w-0 text-3xl font-bold break-words">
						{showDetails?.title || 'Loading...'}
					</h1>
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
					<Link
						href={`/show/${imdbId}/1`}
						className="rounded border border-indigo-500 bg-indigo-900/30 p-1 text-indigo-100 transition-colors hover:bg-indigo-800/50"
						title="Back to show"
						aria-label="Back to show"
					>
						<ArrowLeft size={18} />
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
					<div className="sibling-space-y-8">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-8">
							{/* Phones put the poster beside the facts instead of a full-width poster above them. */}
							<div className="flex items-start gap-3 md:block">
								{showDetails.posterPath && (
									<img
										src={`https://image.tmdb.org/t/p/w500${showDetails.posterPath}`}
										alt={showDetails.title}
										className="w-[34vw] flex-none rounded-lg shadow-lg md:w-full"
									/>
								)}
								<div className="sibling-space-y-3 min-w-0 flex-1 md:mt-4">
									<div
										className="text-sm text-gray-300"
										title={showAirDatesTitle(showDetails)}
									>
										{showMetaParts(showDetails).join(' · ')}
									</div>
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
									{showDetails.creators.length > 0 && (
										<div className="text-sm">
											<span className="text-gray-400">Created by </span>
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
									)}
								</div>
							</div>

							<div className="md:col-span-2">
								{showDetails.overview && (
									<p className="mb-4 text-gray-300">{showDetails.overview}</p>
								)}

								<div>
									<h2 className="mb-4 text-xl font-semibold">Cast</h2>
									<div className="grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
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
													className={`min-w-0 rounded bg-gray-800/40 p-1 text-center transition-transform sm:p-2 ${
														member.slug
															? 'cursor-pointer hover:scale-105 hover:bg-gray-800/70'
															: 'cursor-default'
													}`}
												>
													<div className="mx-auto flex w-full max-w-[200px] min-w-0 flex-col items-center">
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
																className={`line-clamp-2 text-sm font-semibold break-words ${
																	member.slug
																		? 'text-indigo-400'
																		: 'text-gray-100'
																}`}
															>
																{member.name}
															</div>
															<div
																className="line-clamp-2 text-xs text-gray-400"
																title={member.character}
															>
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
