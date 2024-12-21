import axios from 'axios';
import { useState } from 'react';
import toast from 'react-hot-toast';

type MediaInfoButtonProps = {
	hash: string;
};

interface Stream {
	codec_type: string;
	codec_name: string;
	tags?: {
		language?: string;
		title?: string;
	};
	width?: number;
	height?: number;
	channel_layout?: string;
}

interface MediaInfoResponse {
	SelectedFiles: {
		[key: string]: {
			MediaInfo?: {
				streams: Stream[];
				format: {
					duration: string;
				};
				chapters?: {
					tags: {
						title: string;
					};
				}[];
			};
		};
	};
}

const languageEmojis: { [key: string]: string } = {
	eng: '🇬🇧',
	ita: '🇮🇹',
	spa: '🇪🇸',
	fre: '🇫🇷',
	ger: '🇩🇪',
	jpn: '🇯🇵',
	kor: '🇰🇷',
	chi: '🇨🇳',
	rus: '🇷🇺',
	por: '🇵🇹',
	cze: '🇨🇿',
	pol: '🇵🇱',
	dan: '🇩🇰',
	dut: '🇳🇱',
	fin: '🇫🇮',
	nor: '🇳🇴',
	swe: '🇸🇪',
	ukr: '🇺🇦',
	// Add more as needed
};

const generatePasswordHash = async (hash: string): Promise<string> => {
	const salt = 'debridmediamanager.com';
	const msgBuffer = new TextEncoder().encode(hash + salt);
	const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

export default function MediaInfoButton({ hash }: MediaInfoButtonProps) {
	const [showDialog, setShowDialog] = useState(false);
	const [mediaInfo, setMediaInfo] = useState<MediaInfoResponse | null>(null);
	const [loading, setLoading] = useState(false);

	const fetchMediaInfo = async () => {
		try {
			setLoading(true);
			const password = await generatePasswordHash(hash);
			const response = await axios.get<MediaInfoResponse>(
				`https://debridmediamanager.com/mediainfo?hash=${hash}&password=${password}`
			);
			setMediaInfo(response.data);
		} catch (error) {
			console.error('MediaInfo error:', error);
			if (axios.isAxiosError(error) && error.response?.status !== 200) {
				return;
			}
			// Show toast for other errors
			if (error instanceof Error) {
				toast.error(`Failed to fetch media info: ${error.message}`);
			} else {
				toast.error('Failed to fetch media info');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleShowDialog = async () => {
		setShowDialog(true);
		if (!mediaInfo) {
			await fetchMediaInfo();
		}
	};

	const formatDuration = (seconds: string) => {
		const duration = parseFloat(seconds);
		const hours = Math.floor(duration / 3600);
		const minutes = Math.floor((duration % 3600) / 60);
		return `${hours}h ${minutes}m`;
	};

	const getStreamInfo = () => {
		if (!mediaInfo) return null;
		const fileInfo = Object.values(mediaInfo.SelectedFiles)[0];
		if (!fileInfo.MediaInfo) return null;

		const { streams, format, chapters } = fileInfo.MediaInfo;
		const videoStream = streams.find((s) => s.codec_type === 'video');
		const audioStreams = streams.filter((s) => s.codec_type === 'audio');
		const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

		return (
			<div className="space-y-4">
				{/* Video Info */}
				{videoStream && (
					<div>
						<h4 className="font-bold">🎥 Video</h4>
						<p>
							{videoStream.codec_name.toUpperCase()} • {videoStream.width}x
							{videoStream.height}
						</p>
					</div>
				)}

				{/* Audio Tracks */}
				{audioStreams.length > 0 && (
					<div>
						<h4 className="font-bold">🔊 Audio Tracks</h4>
						{audioStreams.map((stream, index) => (
							<p key={index}>
								{stream.tags?.language
									? languageEmojis[stream.tags.language] || stream.tags.language
									: '🌐'}{' '}
								{stream.codec_name.toUpperCase()} • {stream.channel_layout}
								{stream.tags?.title && ` • ${stream.tags.title}`}
							</p>
						))}
					</div>
				)}

				{/* Subtitles */}
				{subtitleStreams.length > 0 && (
					<div>
						<h4 className="font-bold">💬 Subtitles</h4>
						{subtitleStreams.map((stream, index) => (
							<p key={index}>
								{stream.tags?.language
									? languageEmojis[stream.tags.language] || stream.tags.language
									: '🌐'}{' '}
								{stream.tags?.title && ` • ${stream.tags.title}`}
							</p>
						))}
					</div>
				)}

				{/* Duration */}
				{format.duration && (
					<div>
						<h4 className="font-bold">⏱️ Duration</h4>
						<p>{formatDuration(format.duration)}</p>
					</div>
				)}

				{/* Chapters */}
				{chapters && chapters.length > 0 && (
					<div>
						<h4 className="font-bold">📑 Chapters</h4>
						<p>{chapters.length} chapters included</p>
					</div>
				)}
			</div>
		);
	};

	return (
		<>
			<button
				onClick={handleShowDialog}
				className="haptic-sm inline rounded border-2 border-blue-500 bg-blue-900/30 px-1 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				ℹ️ Info
			</button>

			{showDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="fixed inset-0 bg-black opacity-50"
						onClick={() => setShowDialog(false)}
					></div>
					<div className="relative z-50 max-h-[80vh] w-96 overflow-y-auto rounded-lg bg-gray-800 p-4 shadow-xl">
						<h3 className="mb-4 text-lg font-bold text-gray-100">Media Information</h3>
						{loading ? (
							<div className="text-center">
								<span className="inline-block animate-spin">⌛</span> Loading...
							</div>
						) : (
							<div className="space-y-4 text-sm text-gray-100">
								{getStreamInfo() || 'No media information available'}
							</div>
						)}
						<button
							onClick={() => setShowDialog(false)}
							className="haptic-sm mt-4 block w-full rounded border-2 border-gray-500 bg-gray-900/30 px-4 py-2 text-sm text-gray-100 transition-colors hover:bg-gray-800/50"
						>
							Close
						</button>
					</div>
				</div>
			)}
		</>
	);
}
