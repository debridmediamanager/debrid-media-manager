interface Stream {
	codec_type: string;
	codec_name: string;
	tags?: {
		language?: string;
		title?: string;
	};
	width?: number;
	height?: number;
	channels?: number;
	channel_layout?: string;
	side_data_list?: {
		dv_profile?: number;
	}[];
}

interface MediaInfo {
	streams: Stream[];
	format?: {
		duration?: string;
	};
}

interface SnapshotPayload {
	SelectedFiles?: Record<string, { MediaInfo?: MediaInfo; mediaInfo?: MediaInfo }>;
	selectedFiles?: Record<string, { MediaInfo?: MediaInfo; mediaInfo?: MediaInfo }>;
	MediaInfo?: MediaInfo;
	mediaInfo?: MediaInfo;
}

import { languageEmojis } from '@/components/showInfo/languages';

export interface StreamMetadata {
	resolution?: string;
	videoCodec?: string;
	hdr?: string;
	audioCodec?: string;
	audioChannels?: string;
	languages: string[];
}

const VIDEO_CODEC_SHORT: Record<string, string> = {
	h264: 'H264',
	h265: 'H265',
	hevc: 'HEVC',
	av1: 'AV1',
	vp9: 'VP9',
	mpeg4: 'MPEG4',
	xvid: 'XviD',
};

const AUDIO_CODEC_SHORT: Record<string, string> = {
	aac: 'AAC',
	ac3: 'DD',
	eac3: 'DD+',
	truehd: 'TrueHD',
	dts: 'DTS',
	flac: 'FLAC',
	opus: 'Opus',
	vorbis: 'Vorbis',
	mp3: 'MP3',
};

function getResolution(width?: number, height?: number): string | undefined {
	if (!height) return undefined;

	if (height >= 2160) return '4K';
	if (height >= 1440) return '1440p';
	if (height >= 1080) return '1080p';
	if (height >= 720) return '720p';
	if (height >= 480) return '480p';
	return `${height}p`;
}

function getHDRType(stream: Stream): string | undefined {
	if (!stream.side_data_list) return undefined;

	for (const sideData of stream.side_data_list) {
		if (sideData.dv_profile !== undefined) {
			return 'DV';
		}
	}

	const codecName = stream.codec_name?.toLowerCase();
	if (codecName?.includes('hdr') || codecName?.includes('hdr10')) {
		return 'HDR';
	}

	return undefined;
}

function getAudioChannels(stream: Stream): string | undefined {
	if (stream.channels) {
		if (stream.channels === 8) return '7.1';
		if (stream.channels === 6) return '5.1';
		if (stream.channels === 2) return '2.0';
		if (stream.channels === 1) return '1.0';
		return `${stream.channels}.0`;
	}

	const layout = stream.channel_layout?.toLowerCase();
	if (!layout) return undefined;

	if (layout.includes('7.1')) return '7.1';
	if (layout.includes('5.1')) return '5.1';
	if (layout.includes('stereo') || layout.includes('2.0')) return '2.0';
	if (layout.includes('mono')) return '1.0';

	return undefined;
}

function extractMediaInfo(payload: SnapshotPayload): MediaInfo | null {
	const selectedFiles =
		payload.SelectedFiles ?? payload.selectedFiles ?? payload.MediaInfo ?? payload.mediaInfo;

	if (!selectedFiles) return null;

	if ('streams' in selectedFiles && Array.isArray(selectedFiles.streams)) {
		return selectedFiles as MediaInfo;
	}

	const firstFile = Object.values(selectedFiles)[0];
	if (firstFile && typeof firstFile === 'object') {
		const mediaInfo = (firstFile as any).MediaInfo ?? (firstFile as any).mediaInfo;
		if (mediaInfo && 'streams' in mediaInfo) {
			return mediaInfo;
		}
	}

	return null;
}

export function extractStreamMetadata(payload: unknown): StreamMetadata | null {
	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const mediaInfo = extractMediaInfo(payload as SnapshotPayload);
	if (!mediaInfo?.streams) {
		return null;
	}

	const videoStream = mediaInfo.streams.find((s) => s.codec_type === 'video');
	const audioStreams = mediaInfo.streams.filter((s) => s.codec_type === 'audio');

	const metadata: StreamMetadata = {
		languages: [],
	};

	if (videoStream) {
		metadata.resolution = getResolution(videoStream.width, videoStream.height);
		const codecName = videoStream.codec_name?.toLowerCase();
		if (codecName) {
			metadata.videoCodec = VIDEO_CODEC_SHORT[codecName] ?? codecName.toUpperCase();
		}
		metadata.hdr = getHDRType(videoStream);
	}

	if (audioStreams.length > 0) {
		const primaryAudio = audioStreams[0];
		const codecName = primaryAudio.codec_name?.toLowerCase();
		if (codecName) {
			metadata.audioCodec = AUDIO_CODEC_SHORT[codecName] ?? codecName.toUpperCase();
		}
		metadata.audioChannels = getAudioChannels(primaryAudio);

		const uniqueLanguages = new Set<string>();
		for (const audio of audioStreams) {
			const lang = audio.tags?.language?.toLowerCase();
			if (lang) {
				uniqueLanguages.add(lang);
			}
		}
		metadata.languages = Array.from(uniqueLanguages);
	}

	return metadata;
}

export function formatStreamTitle(
	filename: string,
	size: number,
	metadata?: StreamMetadata | null
): string {
	let sizeStr = '';
	if (size > 1024) {
		sizeStr = `${(size / 1024).toFixed(2)} GB`;
	} else {
		sizeStr = `${size.toFixed(2)} MB`;
	}

	let displayFilename = decodeURIComponent(filename);
	if (displayFilename.length > 60) {
		const mid = displayFilename.length / 2;
		displayFilename =
			displayFilename.substring(0, mid) + '-\n' + displayFilename.substring(mid);
	}

	if (!metadata) {
		return displayFilename + '\n' + `📦 ${sizeStr}`;
	}

	const videoParts: string[] = [`📦 ${sizeStr}`];
	if (metadata.resolution) videoParts.push(metadata.resolution);
	if (metadata.hdr) videoParts.push(metadata.hdr);
	if (metadata.videoCodec) videoParts.push(metadata.videoCodec);

	const audioParts: string[] = [];
	if (metadata.audioCodec) {
		if (metadata.audioChannels) {
			audioParts.push(`${metadata.audioCodec} ${metadata.audioChannels}`);
		} else {
			audioParts.push(metadata.audioCodec);
		}
	}

	const languageFlags = metadata.languages
		.map((lang) => languageEmojis[lang])
		.filter(Boolean)
		.join(' ');

	if (languageFlags) {
		audioParts.push(languageFlags);
	}

	const line2 = videoParts.join(' • ');
	const line3 = audioParts.join(' • ');

	if (line3) {
		return `${displayFilename}\n${line2}\n${line3}`;
	}

	return `${displayFilename}\n${line2}`;
}

export function formatStremioStreamTitle(
	filename: string,
	size: number,
	metadata: StreamMetadata | null,
	isUserCast: boolean,
	provider: 'RD' | 'TB' | 'AD' | 'PM' = 'RD'
): string {
	let displayFilename = decodeURIComponent(filename);
	if (displayFilename.length > 60) {
		const mid = displayFilename.length / 2;
		displayFilename =
			displayFilename.substring(0, mid) + '-\n' + displayFilename.substring(mid);
	}

	const audioParts: string[] = [];
	if (metadata?.audioCodec) {
		if (metadata.audioChannels) {
			audioParts.push(`${metadata.audioCodec} ${metadata.audioChannels}`);
		} else {
			audioParts.push(metadata.audioCodec);
		}
	}

	const languageFlags = (metadata?.languages || [])
		.map((lang) => languageEmojis[lang])
		.filter(Boolean)
		.join(' ');

	if (languageFlags) {
		audioParts.push(languageFlags);
	}

	const creditLine = isUserCast ? `🎬 DMM Cast ${provider} (Yours)` : `🎬 DMM Cast ${provider}`;

	const line2 = audioParts.length > 0 ? audioParts.join(' • ') : '';

	if (line2) {
		return `${displayFilename}\n${line2}\n${creditLine}`;
	}

	return `${displayFilename}\n${creditLine}`;
}

export function generateStreamName(size: number, metadata: StreamMetadata | null): string {
	let sizeStr = '';
	if (size > 1024) {
		sizeStr = `${(size / 1024).toFixed(2)} GB`;
	} else {
		sizeStr = `${size.toFixed(2)} MB`;
	}

	const parts: string[] = [];

	if (metadata?.resolution) {
		parts.push(metadata.resolution);
	}

	if (metadata?.videoCodec) {
		parts.push(metadata.videoCodec);
	}

	parts.push(sizeStr);

	return parts.join(' • ');
}
