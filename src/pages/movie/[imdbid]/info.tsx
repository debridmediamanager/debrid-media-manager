import TrailerModal from '@/components/TrailerModal';
import { formatGenreForUrl, mapTmdbGenreToTrakt } from '@/utils/genreMapping';
import { formatReleaseDate } from '@/utils/movieReleaseDates';
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

type MovieDetails = {
	title: string;
	overview: string;
	releaseDate: string;
	digitalReleaseDate: string;
	expectedDigitalReleaseDate: string;
	expectedDigitalReleaseSource: 'tmdb' | 'estimated' | null;
	digitalReleaseAvailable: boolean;
	runtime: number;
	genres: Array<{ id: number; name: string }>;
	voteAverage: number;
	voteCount: number;
	posterPath: string | null;
	backdropPath: string | null;
	cast: CastMember[];
	director: CrewMember | null;
};

export default function MovieInfoPage() {
	const router = useRouter();
	const imdbId = useMemo(() => {
		const raw = router.query.imdbid;
		return typeof raw === 'string' ? raw : '';
	}, [router.query.imdbid]);

	const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [trailerUrl, setTrailerUrl] = useState<string>('');
	const [showTrailer, setShowTrailer] = useState(false);

	const fetchDetails = useCallback(async () => {
		if (!imdbId) return;
		console.info('Fetching movie details', { imdbId });
		setIsLoading(true);
		setStatusMessage(null);
		try {
			const [detailsResponse, infoResponse] = await Promise.all([
				axios.get<MovieDetails>(`/api/info/movie-details`, {
					params: { imdbId },
				}),
				axios.get<{ trailer: string }>(`/api/info/movie`, {
					params: { imdbid: imdbId },
				}),
			]);
			setMovieDetails(detailsResponse.data);
			setTrailerUrl(infoResponse.data.trailer || '');
		} catch (requestError) {
			console.error('Failed to load movie details', { imdbId, requestError });
			setStatusMessage('Failed to load movie details.');
		} finally {
			setIsLoading(false);
		}
	}, [imdbId]);

	useEffect(() => {
		if (!router.isReady) return;
		void fetchDetails();
	}, [fetchDetails, router.isReady]);

	const formatRuntime = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	};

	const digitalReleaseLabel =
		movieDetails?.expectedDigitalReleaseSource === 'estimated'
			? 'Expected Digital Release'
			: 'Digital Release';

	return (
		<div className="min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>{movieDetails?.title || 'Movie Info'}</title>
			</Head>

			{movieDetails?.backdropPath && (
				<div
					className="h-64 bg-cover bg-center"
					style={{
						backgroundImage: `linear-gradient(to bottom, rgba(17, 24, 39, 0.7), rgba(17, 24, 39, 1)), url(https://image.tmdb.org/t/p/original${movieDetails.backdropPath})`,
					}}
				/>
			)}

			{showTrailer && trailerUrl && (
				<TrailerModal
					trailerUrl={trailerUrl}
					onClose={() => setShowTrailer(false)}
					title={movieDetails?.title || ''}
				/>
			)}

			<main className="mx-auto max-w-6xl px-4 py-4">
				<div className="mb-4 flex items-end justify-between gap-3">
					<div className="flex items-center gap-2">
						<h1 className="text-3xl font-bold">
							{movieDetails?.title || 'Loading...'}
						</h1>
						{trailerUrl && (
							<button
								onClick={() => setShowTrailer(true)}
								className="rounded border border-red-500 bg-red-900/30 p-1 text-red-100 transition-colors hover:bg-red-800/50"
								title="Watch trailer"
							>
								<Play size={18} />
							</button>
						)}
						<button
							onClick={() => router.push(`/movie/${imdbId}/related`)}
							className="rounded border border-purple-500 bg-purple-900/30 p-1 text-purple-100 transition-colors hover:bg-purple-800/50"
							title="Show related media"
						>
							<Popcorn size={18} />
						</button>
					</div>
					<Link
						href={`/movie/${imdbId}`}
						className="inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-3 py-1 text-sm text-indigo-100 transition-colors hover:bg-indigo-800/50"
					>
						Back to Movie
					</Link>
				</div>

				{statusMessage && (
					<div className="mb-4 rounded border border-yellow-500 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-100">
						{statusMessage}
					</div>
				)}

				{isLoading ? (
					<div>Loading movie information…</div>
				) : movieDetails ? (
					<div className="space-y-8">
						<div className="grid grid-cols-1 gap-8 md:grid-cols-3">
							<div>
								{movieDetails.posterPath && (
									<img
										src={`https://image.tmdb.org/t/p/w500${movieDetails.posterPath}`}
										alt={movieDetails.title}
										className="w-full rounded-lg shadow-lg"
									/>
								)}
								<div className="mt-4 space-y-2">
									<div className="text-sm">
										<span className="text-gray-400">Release Date:</span>{' '}
										{formatReleaseDate(movieDetails.releaseDate)}
									</div>
									{movieDetails.expectedDigitalReleaseDate && (
										<div className="text-sm">
											<span className="text-gray-400">
												{digitalReleaseLabel}:
											</span>{' '}
											{formatReleaseDate(
												movieDetails.expectedDigitalReleaseDate
											)}
											{movieDetails.expectedDigitalReleaseSource ===
												'estimated' && (
												<span className="text-gray-500"> estimate</span>
											)}
										</div>
									)}
									{movieDetails.digitalReleaseAvailable && (
										<div className="text-sm text-emerald-300">
											Release window reached
										</div>
									)}
									<div className="text-sm">
										<span className="text-gray-400">Runtime:</span>{' '}
										{formatRuntime(movieDetails.runtime)}
									</div>
									<div className="text-sm">
										<span className="text-gray-400">Rating:</span>{' '}
										{movieDetails.voteAverage.toFixed(1)}/10 (
										{movieDetails.voteCount} votes)
									</div>
								</div>
							</div>

							<div className="md:col-span-2">
								<div className="mb-4">
									<h2 className="mb-2 text-xl font-semibold">Overview</h2>
									<p className="text-gray-300">{movieDetails.overview}</p>
								</div>

								<div className="mb-4">
									<h2 className="mb-2 text-xl font-semibold">Genres</h2>
									<div className="flex flex-wrap gap-2">
										{movieDetails.genres
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

								{movieDetails.director && (
									<div className="mb-4">
										<h2 className="mb-2 text-xl font-semibold">Director</h2>
										{movieDetails.director.slug ? (
											<Link
												href={`/person/${movieDetails.director.slug}/movies`}
												className="text-indigo-400 hover:text-indigo-300"
											>
												{movieDetails.director.name}
											</Link>
										) : (
											<span>{movieDetails.director.name}</span>
										)}
									</div>
								)}

								<div>
									<h2 className="mb-4 text-xl font-semibold">Cast</h2>
									<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
										{movieDetails.cast.map((member, index) => {
											const handleClick = (
												event: React.MouseEvent<HTMLButtonElement>
											) => {
												if (!member.slug) return;
												const destination = `/person/${member.slug}/movies`;
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
																<div className="flex h-full items-center justify-center text-gray-600">
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
					<div>No movie details found.</div>
				)}
			</main>
		</div>
	);
}
