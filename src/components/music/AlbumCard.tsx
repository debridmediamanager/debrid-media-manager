import { MusicAlbum } from '@/pages/api/music/library';
import { Disc3, Pause, Play } from 'lucide-react';

interface AlbumCardProps {
	album: MusicAlbum;
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
	isNowPlaying?: boolean;
	isPlaying?: boolean;
}

export default function AlbumCard({
	album,
	onSelect,
	onPlay,
	isNowPlaying = false,
	isPlaying = false,
}: AlbumCardProps) {
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onSelect(album)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(album);
				}
			}}
			className={`group flex cursor-pointer flex-col rounded-xl p-3 text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-music-lg sm:p-4 ${
				isNowPlaying
					? 'bg-green-500/10 ring-1 ring-green-500/30 hover:bg-green-500/15'
					: 'bg-gray-800/40 hover:bg-gray-800/70'
			}`}
		>
			<div className="relative mb-3 aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg sm:mb-4">
				{/* Fallback icon */}
				<div className="flex h-full w-full items-center justify-center">
					<Disc3 className="h-16 w-16 text-gray-500" />
				</div>
				{/* Album cover */}
				{album.coverUrl && (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={album.coverUrl}
						alt={album.album}
						className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = 'none';
						}}
					/>
				)}

				{/* Now Playing indicator */}
				{isNowPlaying && (
					<div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-green-500 px-2 py-1 text-[10px] font-bold text-black shadow-lg">
						{isPlaying ? (
							<>
								<span className="flex h-3 items-end gap-0.5">
									<span className="h-2 w-0.5 animate-pulse bg-black" />
									<span
										className="h-3 w-0.5 animate-pulse bg-black"
										style={{ animationDelay: '0.15s' }}
									/>
									<span
										className="h-1.5 w-0.5 animate-pulse bg-black"
										style={{ animationDelay: '0.3s' }}
									/>
								</span>
								PLAYING
							</>
						) : (
							<>
								<Pause className="h-2.5 w-2.5" fill="currentColor" />
								PAUSED
							</>
						)}
					</div>
				)}

				{/* Play button overlay */}
				<div className="absolute bottom-2 right-2 z-10 translate-y-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
					<button
						onClick={(e) => {
							e.stopPropagation();
							onPlay(album);
						}}
						className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/25 transition-transform duration-200 hover:scale-110 hover:bg-green-400 active:scale-95"
					>
						<Play className="h-6 w-6 text-black" fill="currentColor" />
					</button>
				</div>
			</div>

			<h3 className="truncate font-semibold text-white">{album.album}</h3>
			<p className="truncate text-sm text-gray-400">
				{album.artist}
				{album.year && ` \u00b7 ${album.year}`}
			</p>
			<p className="mt-1 text-xs text-gray-500">
				{album.trackCount} {album.trackCount === 1 ? 'track' : 'tracks'}
			</p>
		</div>
	);
}
