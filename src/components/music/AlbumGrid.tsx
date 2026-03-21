import { MusicAlbum } from '@/pages/api/music/library';
import { ArrowDownAZ, Calendar, Clock, Music2, User } from 'lucide-react';
import AlbumCard from './AlbumCard';

type SortOption = 'recent' | 'name' | 'artist' | 'year';

interface AlbumGridProps {
	albums: MusicAlbum[];
	searchQuery: string;
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
	sortBy: SortOption;
	onSortChange: (sort: SortOption) => void;
	nowPlayingAlbumHash: string | null;
	isPlaying: boolean;
}

const sortOptions: { value: SortOption; label: string; icon: typeof Clock }[] = [
	{ value: 'recent', label: 'Recent', icon: Clock },
	{ value: 'name', label: 'Name', icon: ArrowDownAZ },
	{ value: 'artist', label: 'Artist', icon: User },
	{ value: 'year', label: 'Year', icon: Calendar },
];

export default function AlbumGrid({
	albums,
	searchQuery,
	onSelect,
	onPlay,
	sortBy,
	onSortChange,
	nowPlayingAlbumHash,
	isPlaying,
}: AlbumGridProps) {
	return (
		<div className="p-3 md:p-6">
			<div className="mb-4 flex items-center justify-between md:mb-6">
				<h2 className="text-xl font-bold text-white md:text-2xl">Your Library</h2>
				<div className="flex items-center gap-1">
					{sortOptions.map(({ value, label, icon: Icon }) => (
						<button
							key={value}
							onClick={() => onSortChange(value)}
							className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
								sortBy === value
									? 'bg-green-500/20 text-green-500'
									: 'text-gray-400 hover:bg-white/5 hover:text-white'
							}`}
							title={`Sort by ${label}`}
						>
							<Icon className="h-3.5 w-3.5" />
							<span className="hidden sm:inline">{label}</span>
						</button>
					))}
				</div>
			</div>

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
							isNowPlaying={album.hash === nowPlayingAlbumHash}
							isPlaying={isPlaying}
						/>
					))}
				</div>
			)}
		</div>
	);
}
