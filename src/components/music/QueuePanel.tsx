import { MusicTrack } from '@/pages/api/music/library';
import { ListMusic, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import TrackListItem from './TrackListItem';
import { QueuedTrack } from './types';

interface QueuePanelProps {
	queue: QueuedTrack[];
	currentIndex: number;
	isPlaying: boolean;
	onPlayTrack: (index: number) => void;
	onClose: () => void;
	onDownload: (track: MusicTrack) => Promise<void>;
}

export default function QueuePanel({
	queue,
	currentIndex,
	isPlaying,
	onPlayTrack,
	onClose,
	onDownload,
}: QueuePanelProps) {
	const listRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to current track on open
	useEffect(() => {
		if (listRef.current && currentIndex >= 0) {
			const item = listRef.current.children[currentIndex] as HTMLElement | undefined;
			item?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}, [currentIndex]);

	return (
		<div className="fixed bottom-[4.5rem] left-0 right-0 z-50 flex flex-col border-t border-white/10 bg-black/95 backdrop-blur-xl md:bottom-24 md:left-auto md:right-4 md:w-96 md:rounded-xl md:border md:bg-black/90 md:shadow-music-2xl">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
				<div className="flex items-center gap-2">
					<ListMusic className="h-5 w-5 text-green-500" />
					<h3 className="font-bold text-white">Queue</h3>
					<span className="text-sm text-gray-400">
						{queue.length} {queue.length === 1 ? 'track' : 'tracks'}
					</span>
				</div>
				<button
					onClick={onClose}
					className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{/* Track list */}
			<div ref={listRef} className="max-h-96 overflow-y-auto">
				{queue.map((item, index) => (
					<TrackListItem
						key={`${item.track.id}-${index}`}
						track={item.track}
						index={index}
						album={item.album}
						isCurrentTrack={index === currentIndex}
						isPlaying={isPlaying}
						onPlay={() => onPlayTrack(index)}
						onDownload={onDownload}
					/>
				))}
			</div>
		</div>
	);
}
