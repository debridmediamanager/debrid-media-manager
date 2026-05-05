import Poster from '@/components/poster';
import RelatedMedia from '@/components/RelatedMedia';
import TrailerModal from '@/components/TrailerModal';
import { Info, Play } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React, { useState } from 'react';

interface MediaHeaderProps {
	mediaType: 'movie' | 'tv';
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
}) => {
	const [showTrailer, setShowTrailer] = useState(false);
	const backdropStyle = backdrop
		? {
				backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${backdrop})`,
				backgroundPosition: 'center',
				backgroundSize: 'screen',
			}
		: {};

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
					{(poster && (
						<Image
							fill
							sizes="(max-width: 640px) 50vw, 200px"
							src={poster}
							alt={`${mediaType === 'movie' ? 'Movie' : 'Show'} poster`}
							className="object-cover"
						/>
					)) || <Poster imdbId={imdbId} title={title} />}
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

					<div className="flex items-center gap-2">
						<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
							{displayTitle}
						</h2>
						<Link
							href={`/${mediaType === 'movie' ? 'movie' : 'show'}/${imdbId}/info`}
							className="rounded border border-indigo-500 bg-indigo-900/30 p-1 text-indigo-100 transition-colors hover:bg-indigo-800/50"
							title="View detailed information"
						>
							<Info size={18} />
						</Link>
						{trailer && (
							<button
								onClick={() => setShowTrailer(true)}
								className="rounded border border-red-500 bg-red-900/30 p-1 text-red-100 transition-colors hover:bg-red-800/50"
								title="Watch trailer"
							>
								<Play size={18} />
							</button>
						)}
						<RelatedMedia
							imdbId={imdbId}
							mediaType={mediaType === 'tv' ? 'show' : 'movie'}
						/>
					</div>

					<div className="h-fit w-fit bg-slate-900/75" onClick={onDescToggle}>
						{descLimit > 0 ? description.substring(0, descLimit) + '..' : description}{' '}
						{imdbScore > 0 && (
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
