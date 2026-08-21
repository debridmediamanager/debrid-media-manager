import { MusicAlbum } from '@/pages/api/music/library';
import { Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { formatSize } from './utils';

interface DownloadAlbumModalProps {
	album: MusicAlbum;
	onConfirm: () => void;
	onClose: () => void;
}

export default function DownloadAlbumModal({ album, onConfirm, onClose }: DownloadAlbumModalProps) {
	const trackCount = album.tracks.length;

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="music-download-album-title"
		>
			<div
				className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close download dialog"
					className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-white"
				>
					<X className="h-5 w-5" />
				</button>

				<h2
					id="music-download-album-title"
					className="mb-1 pr-8 text-lg font-bold text-white"
				>
					Download this album?
				</h2>
				<p className="mb-5 text-sm text-gray-400">
					{album.album} &middot; {trackCount} {trackCount === 1 ? 'file' : 'files'}{' '}
					&middot; {formatSize(album.totalBytes)}
				</p>

				<ul className="mb-6 flex flex-col gap-3 text-sm text-gray-300">
					<li className="flex gap-2">
						<span aria-hidden="true" className="text-green-500">
							&bull;
						</span>
						<span>
							Each track is saved as its own file, so your browser will ask whether
							this site may{' '}
							<strong className="text-white">download multiple files</strong>. Choose{' '}
							<strong className="text-white">Allow</strong> &mdash; otherwise only the
							first track is saved.
						</span>
					</li>
					<li className="flex gap-2">
						<span aria-hidden="true" className="text-green-500">
							&bull;
						</span>
						<span>
							Tracks are fetched one at a time, so a large album takes a while. Keep
							this tab open until the downloads finish.
						</span>
					</li>
					<li className="flex gap-2">
						<span aria-hidden="true" className="text-green-500">
							&bull;
						</span>
						<span>
							Everything lands in your normal downloads folder, not in a per-album
							subfolder.
						</span>
					</li>
				</ul>

				<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onClose}
						className="rounded-full border border-gray-600 bg-white/5 px-6 py-3 font-bold text-white transition-all duration-200 hover:border-white/30 hover:bg-white/10 active:scale-95"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="flex items-center justify-center gap-2 rounded-full bg-green-500 px-6 py-3 font-bold text-black shadow-lg shadow-green-500/25 transition-all duration-200 hover:scale-105 hover:bg-green-400 active:scale-95"
					>
						<Download className="h-5 w-5" />
						Download {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
					</button>
				</div>
			</div>
		</div>
	);
}
