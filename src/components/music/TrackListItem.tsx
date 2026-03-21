import { MusicAlbum, MusicTrack } from '@/pages/api/music/library';
import { Download, ListEnd, Loader2, Play, X } from 'lucide-react';
import { useState } from 'react';
import { formatSize, removeExtension } from './utils';

interface TrackListItemProps {
	track: MusicTrack;
	index: number;
	album: MusicAlbum;
	isCurrentTrack: boolean;
	isPlaying: boolean;
	onPlay: () => void;
	onDownload: (track: MusicTrack) => Promise<void>;
	onRemove?: () => void;
	showRemove?: boolean;
	onPlayNext?: (track: MusicTrack, album: MusicAlbum) => void;
}

export default function TrackListItem({
	track,
	index,
	album,
	isCurrentTrack,
	isPlaying,
	onPlay,
	onDownload,
	onRemove,
	showRemove = false,
	onPlayNext,
}: TrackListItemProps) {
	const [isDownloading, setIsDownloading] = useState(false);

	const handleDownload = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isDownloading) return;
		setIsDownloading(true);
		try {
			await onDownload(track);
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<button
			onClick={onPlay}
			className={`group grid w-full grid-cols-[32px_1fr_auto_auto] items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all duration-200 sm:grid-cols-[40px_1fr_auto_auto] sm:gap-4 sm:px-4 sm:py-3 ${
				isCurrentTrack
					? 'border-l-[3px] border-l-green-500 bg-green-500/10 pl-[calc(1rem-3px)] text-green-500'
					: 'border-l-[3px] border-l-transparent text-gray-300 hover:bg-white/5 hover:text-white'
			}`}
		>
			<span className="flex items-center justify-center text-sm">
				{isCurrentTrack && isPlaying ? (
					<span className="flex h-4 items-end gap-0.5">
						<span className="h-3 w-0.5 animate-pulse bg-green-500" />
						<span
							className="h-4 w-0.5 animate-pulse bg-green-500"
							style={{ animationDelay: '0.15s' }}
						/>
						<span
							className="h-2 w-0.5 animate-pulse bg-green-500"
							style={{ animationDelay: '0.3s' }}
						/>
					</span>
				) : (
					<>
						<span
							className={`block font-mono text-gray-500 group-hover:hidden ${isCurrentTrack ? 'text-green-500' : ''}`}
						>
							{track.trackNumber ?? index + 1}
						</span>
						<Play className="hidden h-4 w-4 group-hover:block" fill="currentColor" />
					</>
				)}
			</span>

			<div className="flex flex-col overflow-hidden">
				<span
					className={`truncate font-medium ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}
				>
					{removeExtension(track.filename)}
				</span>
				<span className="truncate text-xs text-gray-500 group-hover:text-gray-400">
					{album.artist}
				</span>
			</div>

			<span className="font-mono text-sm text-gray-500 group-hover:text-gray-400">
				{formatSize(track.bytes)}
			</span>

			<div className="flex items-center gap-0.5">
				{onPlayNext && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							onPlayNext(track, album);
						}}
						className="flex items-center justify-center rounded-full p-1.5 text-gray-500 opacity-0 transition-all duration-200 hover:bg-white/10 hover:text-white group-hover:opacity-100"
						title="Play next"
					>
						<ListEnd className="h-4 w-4" />
					</span>
				)}
				<span
					onClick={handleDownload}
					className={`flex items-center justify-center rounded-full p-1.5 transition-all duration-200 ${
						isDownloading
							? 'text-green-500'
							: 'text-gray-500 hover:bg-white/10 hover:text-white'
					}`}
					title="Download"
				>
					{isDownloading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Download className="h-4 w-4" />
					)}
				</span>
				{showRemove && onRemove && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="flex items-center justify-center rounded-full p-1.5 text-gray-500 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
						title="Remove from queue"
					>
						<X className="h-4 w-4" />
					</span>
				)}
			</div>
		</button>
	);
}
