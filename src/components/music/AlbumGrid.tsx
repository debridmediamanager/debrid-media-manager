import { MusicAlbum } from '@/pages/api/music/library';
import { Music2 } from 'lucide-react';
import AlbumCard from './AlbumCard';

interface AlbumGridProps {
	albums: MusicAlbum[];
	searchQuery: string;
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
}

export default function AlbumGrid({ albums, searchQuery, onSelect, onPlay }: AlbumGridProps) {
	return (
		<div className="p-3 md:p-6">
			<h2 className="mb-4 text-xl font-bold text-white md:mb-6 md:text-2xl">Your Library</h2>

			{albums.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<Music2 className="mb-4 h-16 w-16" />
					<p className="text-lg">
						{searchQuery ? 'No albums match your search' : 'No music in your library'}
					</p>
					<p className="mt-2 text-sm text-gray-500">
						Add music torrents from your debrid service to see them here
					</p>
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-5">
					{albums.map((album) => (
						<AlbumCard
							key={album.hash}
							album={album}
							onSelect={onSelect}
							onPlay={onPlay}
						/>
					))}
				</div>
			)}
		</div>
	);
}
