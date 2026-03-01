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
}

export default function QueuePanel({
	queue,
	currentIndex,
	isPlaying,
	onPlayTrack,
	onClose,
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
		<div className="fixed bottom-24 right-4 z-50 flex w-96 flex-col rounded-xl border border-white/10 bg-black/90 shadow-music-2xl backdrop-blur-xl">
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
					/>
				))}
			</div>
		</div>
	);
}
