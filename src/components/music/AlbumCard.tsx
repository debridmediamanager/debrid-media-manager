import { MusicAlbum } from '@/pages/api/music/library';
import { Disc3, Play } from 'lucide-react';

interface AlbumCardProps {
	album: MusicAlbum;
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
}

export default function AlbumCard({ album, onSelect, onPlay }: AlbumCardProps) {
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
			className="group flex cursor-pointer flex-col rounded-xl bg-gray-800/40 p-4 text-left transition-all duration-300 hover:-translate-y-1.5 hover:bg-gray-800/70 hover:shadow-music-lg"
		>
			<div className="relative mb-4 aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg">
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
