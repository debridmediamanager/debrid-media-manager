import Poster from '@/components/poster';
import RelatedMedia from '@/components/RelatedMedia';
import TrailerModal from '@/components/TrailerModal';
import { Info, Play } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React, { useState } from 'react';

interface MediaHeaderProps {
	/**
	 * `anime` is an AniDB entry: its rating is not IMDb's, and the details and
	 * related-titles links are keyed by an IMDb id it may not have.
	 */
	mediaType: 'movie' | 'tv' | 'anime';
	imdbId: string;
	title: string;
	year?: string;
	seasonNum?: string;
	description: string;
	poster: string;
	backdrop?: string;
	imdbScore: number;
	descLimit: number;
	onDescToggle: () => void;
	actionButtons: React.ReactNode;
	additionalInfo?: React.ReactNode;
	trailer?: string;
	/** Where an anime entry's rating links to; its own page on AniDB. */
	ratingHref?: string;
}

const HEADER_SHADE =
	'linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%)';

/**
 * The header's own backdrop, drawn here so it cannot fail to load. It is the
 * bottom layer under every backdrop: a title with no art shows it, and so does
 * one whose art URL is dead, since an image layer that fails to load is
 * transparent. Cinemeta hands out a metahub URL for every title whether or not
 * an image exists: of the 83 that production served across 400 shows and 400
 * movies on 2026-10-03, 69 answered 404, all for titles TMDB has no art for.
 */
export const FALLBACK_BACKDROP =
	'radial-gradient(120% 160% at 0% 0%, rgba(8, 145, 178, 0.35) 0%, rgba(8, 145, 178, 0) 60%), ' +
	'radial-gradient(120% 160% at 100% 100%, rgba(79, 70, 229, 0.3) 0%, rgba(79, 70, 229, 0) 60%), ' +
	'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';

function headerBackgroundStyle(backdrop?: string): React.CSSProperties {
	const url = backdrop?.trim();
	return {
		// Quoted, so a URL with a space or parenthesis cannot void the whole list.
		backgroundImage: [HEADER_SHADE, url ? `url(${JSON.stringify(url)})` : '', FALLBACK_BACKDROP]
			.filter(Boolean)
			.join(', '),
		backgroundPosition: 'center',
	};
}

const MediaHeader: React.FC<MediaHeaderProps> = ({
	mediaType,
	imdbId,
	title,
	year,
	seasonNum,
	description,
	poster,
	backdrop,
	imdbScore,
	descLimit,
	onDescToggle,
	actionButtons,
	additionalInfo,
	trailer,
	ratingHref,
}) => {
	const isAnime = mediaType === 'anime';
	const [showTrailer, setShowTrailer] = useState(false);
	// A poster URL is no promise of an image: Cinemeta's metahub URLs and OMDb's
	// m.media-amazon.com ones can answer 404, which drew a broken-image icon. The
	// URL that failed hands over to the Poster component's own chain, which ends
	// on a placeholder; a different URL, as on moving to another title, is tried.
	const [failedPoster, setFailedPoster] = useState<string | null>(null);
	const posterUrl = poster && poster !== failedPoster ? poster : '';
	const backdropStyle = headerBackgroundStyle(backdrop);

	const displayTitle =
		mediaType === 'movie'
			? `${title} (${year})`
			: seasonNum
				? `${title} - Season ${seasonNum}`
				: title;

	return (
		<>
			{showTrailer && trailer && (
				<TrailerModal
					trailerUrl={trailer}
					onClose={() => setShowTrailer(false)}
					title={title}
				/>
			)}
			<div
				className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-2"
				style={backdropStyle}
			>
				<div className="relative col-start-1 row-start-1 aspect-[2/3] w-[200px] max-w-[50vw] shrink-0 self-start shadow-lg sm:row-span-3">
					{posterUrl ? (
						<Image
							fill
							sizes="(max-width: 640px) 50vw, 200px"
							src={posterUrl}
							alt={`${mediaType === 'movie' ? 'Movie' : isAnime ? 'Anime' : 'Show'} poster`}
							className="object-cover"
							onError={() => setFailedPoster(posterUrl)}
						/>
					) : (
						<Poster imdbId={imdbId} title={title} />
					)}
				</div>

				<div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-2">
					<div className="flex justify-end p-2">
						<Link
							href="/"
							className="h-fit w-fit rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
						>
							Go Home
						</Link>
					</div>

					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h2 className="min-w-0 text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
							{displayTitle}
						</h2>
						{!isAnime && (
							<Link
								href={`/${mediaType === 'movie' ? 'movie' : 'show'}/${imdbId}/info`}
								className="rounded border border-indigo-500 bg-indigo-900/30 p-1 text-indigo-100 transition-colors hover:bg-indigo-800/50"
								title="View detailed information"
							>
								<Info size={18} />
							</Link>
						)}
						{trailer && (
							<button
								onClick={() => setShowTrailer(true)}
								className="rounded border border-red-500 bg-red-900/30 p-1 text-red-100 transition-colors hover:bg-red-800/50"
								title="Watch trailer"
							>
								<Play size={18} />
							</button>
						)}
						{!isAnime && (
							<RelatedMedia
								imdbId={imdbId}
								mediaType={mediaType === 'tv' ? 'show' : 'movie'}
							/>
						)}
					</div>

					<div
						className="h-fit w-fit bg-slate-900/75"
						onClick={onDescToggle}
						data-testid="media-description"
					>
						{/* Only a description the limit cuts is marked as cut. An anime entry
						    with no metadata has none, and its header read a lone '..'. */}
						{descLimit > 0 && description.length > descLimit
							? description.substring(0, descLimit) + '..'
							: description}{' '}
						{imdbScore > 0 && isAnime && (
							<div className="inline text-yellow-100">
								{ratingHref ? (
									<Link href={ratingHref} target="_blank">
										Rating: {imdbScore}
									</Link>
								) : (
									<>Rating: {imdbScore}</>
								)}
							</div>
						)}
						{imdbScore > 0 && !isAnime && (
							<div className="inline text-yellow-100">
								<Link
									href={`https://www.imdb.com/title/${imdbId}/`}
									target="_blank"
								>
									IMDB Score: {imdbScore < 10 ? imdbScore : imdbScore / 10}
								</Link>
							</div>
						)}
					</div>
				</div>

				{additionalInfo && (
					<div className="col-span-2 flex flex-col gap-2 sm:col-span-1 sm:col-start-2">
						{additionalInfo}
					</div>
				)}
				<div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2">
					{actionButtons}
				</div>
			</div>
		</>
	);
};

export default MediaHeader;
