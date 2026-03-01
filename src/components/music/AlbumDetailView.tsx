import { MusicAlbum } from '@/pages/api/music/library';
import { ChevronLeft, Disc3, Play } from 'lucide-react';
import TrackListItem from './TrackListItem';
import { PlayerState, QueuedTrack } from './types';
import { formatSize } from './utils';

interface AlbumDetailViewProps {
	album: MusicAlbum;
	currentTrack: QueuedTrack | null;
	playerState: PlayerState;
	onPlay: (album: MusicAlbum, startIndex?: number) => void;
	onAddToQueue: (album: MusicAlbum) => void;
	onBack: () => void;
}

export default function AlbumDetailView({
	album,
	currentTrack,
	playerState,
	onPlay,
	onAddToQueue,
	onBack,
}: AlbumDetailViewProps) {
	return (
		<div className="relative min-h-full">
			{/* Ambient background gradient */}
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-green-900/30 via-gray-900/80 to-transparent" />

			<div className="relative z-10 p-8 pb-32">
				{/* Back button */}
				<button
					onClick={onBack}
					className="mb-6 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 active:scale-95"
				>
					<ChevronLeft className="h-4 w-4" />
					Back to Albums
				</button>

				{/* Album header */}
				<div className="flex flex-col gap-8 md:flex-row md:items-end">
					<div className="relative h-64 w-64 flex-shrink-0 overflow-hidden rounded-xl bg-gray-800 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-transform duration-300 hover:scale-[1.02]">
						{/* Fallback icon */}
						<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-700 to-gray-800">
							<Disc3 className="h-24 w-24 text-gray-500" />
						</div>
						{/* Album cover */}
						{album.coverUrl && (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={album.coverUrl}
								alt={album.album}
								className="absolute inset-0 z-10 h-full w-full object-cover"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = 'none';
								}}
							/>
						)}
					</div>

					<div className="flex flex-col justify-end gap-4">
						<div>
							<span className="text-xs font-bold uppercase tracking-wider text-green-500">
								Album
							</span>
							<h2 className="mt-2 text-4xl font-black tracking-tight text-white md:text-6xl md:leading-tight">
								{album.album}
							</h2>
						</div>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-gray-300">
							<span className="text-white">{album.artist}</span>
							{album.year && (
								<>
									<span className="text-gray-600">&middot;</span>
									<span>{album.year}</span>
								</>
							)}
							<span className="text-gray-600">&middot;</span>
							<span>{album.trackCount} songs</span>
							<span className="text-gray-600">&middot;</span>
							<span className="text-gray-400">{formatSize(album.totalBytes)}</span>
						</div>

						<div className="mt-4 flex flex-wrap gap-4">
							<button
								onClick={() => onPlay(album)}
								className="flex items-center gap-2 rounded-full bg-green-500 px-8 py-3.5 font-bold text-black shadow-lg shadow-green-500/25 transition-all duration-200 hover:scale-105 hover:bg-green-400 active:scale-95"
							>
								<Play className="h-5 w-5" fill="currentColor" />
								Play
							</button>
							<button
								onClick={() => onAddToQueue(album)}
								className="flex items-center gap-2 rounded-full border border-gray-600 bg-white/5 px-6 py-3.5 font-bold text-white backdrop-blur-sm transition-all duration-200 hover:border-white/30 hover:bg-white/10 active:scale-95"
							>
								Add to Queue
							</button>
						</div>
					</div>
				</div>

				{/* Track list */}
				<div className="mt-12">
					<div className="mb-4 grid grid-cols-[40px_1fr_auto] gap-4 border-b border-white/10 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-400">
						<span className="text-center">#</span>
						<span>Title</span>
						<span className="text-right">Size</span>
					</div>

					<div className="flex flex-col gap-0.5">
						{album.tracks.map((track, index) => (
							<TrackListItem
								key={track.id}
								track={track}
								index={index}
								album={album}
								isCurrentTrack={currentTrack?.track.id === track.id}
								isPlaying={playerState.isPlaying}
								onPlay={() => onPlay(album, index)}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
