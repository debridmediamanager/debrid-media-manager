import axiosWithRetry from '@/utils/axiosWithRetry';
import { filenameParse } from '@/utils/filenameParse';
import { languageEmojis } from './languages';
import { MediaInfoResponse } from './types';

export const formatSize = (bytes: number): { size: number; unit: string } => {
	const isGB = bytes >= 1024 ** 3;
	return {
		size: bytes / (isGB ? 1024 ** 3 : 1024 ** 2),
		unit: isGB ? 'GB' : 'MB',
	};
};

export const getEpisodeInfo = (
	path: string,
	mediaType: 'movie' | 'tv' = 'tv'
): { isTvEpisode: boolean } => {
	let epRegex = /S(\d+)\s?E(\d+)/i;
	let isTvEpisode = Boolean(path.match(epRegex));

	if (mediaType === 'tv' && !isTvEpisode) {
		epRegex = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
		isTvEpisode = Boolean(path.match(epRegex));
	}

	return { isTvEpisode };
};

const formatDuration = (seconds: string) => {
	const duration = parseFloat(seconds);
	const hours = Math.floor(duration / 3600);
	const minutes = Math.floor((duration % 3600) / 60);
	return `${hours}h ${minutes}m`;
};

const snapshotEndpoint = '/api/torrents/mediainfo';

const hasMediaInfoPayload = (mediaInfo: MediaInfoResponse | null | undefined) => {
	if (!mediaInfo || !mediaInfo.SelectedFiles) return false;
	for (const file of Object.values(mediaInfo.SelectedFiles)) {
		if (file?.MediaInfo?.streams?.length) {
			return true;
		}
	}
	return false;
};

const loggableError = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const fetchMediaInfo = async (hash: string): Promise<MediaInfoResponse | null> => {
	if (!hash) return null;

	try {
		const response = await axiosWithRetry.get<MediaInfoResponse>(snapshotEndpoint, {
			params: { hash },
		});
		if (hasMediaInfoPayload(response.data)) {
			return response.data;
		}
		console.info('Torrent snapshot media info missing stream details', { hash });
	} catch (error) {
		console.info('Failed to load torrent media info from snapshot', {
			hash,
			error: loggableError(error),
		});
	}

	return null;
};

const getChannelLabel = (channels?: number, channelLayout?: string): string | undefined => {
	if (channels) {
		if (channels === 8) return '7.1';
		if (channels === 6) return '5.1';
		if (channels === 2) return '2.0';
		if (channels === 1) return '1.0';
		return `${channels}.0`;
	}
	const layout = channelLayout?.toLowerCase();
	if (!layout) return undefined;
	if (layout.includes('7.1')) return '7.1';
	if (layout.includes('5.1')) return '5.1';
	if (layout.includes('stereo') || layout.includes('2.0')) return '2.0';
	if (layout.includes('mono')) return '1.0';
	return undefined;
};

export const getStreamInfo = (mediaInfo: MediaInfoResponse | null) => {
	if (!mediaInfo) return [];
	const fileInfo = Object.values(mediaInfo.SelectedFiles)[0];
	if (!fileInfo.MediaInfo) return [];

	const { streams, format, chapters } = fileInfo.MediaInfo;
	const videoStream = streams.find((s) => s.codec_type === 'video');
	const audioStreams = streams.filter((s) => s.codec_type === 'audio');
	const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

	const rows: { label: string; value: string }[] = [];

	if (videoStream) {
		let videoInfo = `${videoStream.codec_name.toUpperCase()} • ${videoStream.width}x${videoStream.height}`;
		// Check for Dolby Vision profile
		if (videoStream.side_data_list) {
			const dvStream = videoStream.side_data_list.find((sd: any) => sd.dv_profile > 0);
			if (dvStream) {
				videoInfo += ` • Dolby Vision profile ${dvStream.dv_profile}`;
			}
		}
		rows.push({
			label: 'Video',
			value: videoInfo,
		});
	}

	if (audioStreams.length > 0) {
		rows.push({
			label: 'Audio',
			value:
				`${audioStreams.length} tracks: ` +
				audioStreams
					.map((stream) => {
						const lang = stream.tags?.language
							? `${languageEmojis[stream.tags.language] || stream.tags.language} ${stream.tags.language}`
							: '🌐';
						const codec = stream.codec_name.toUpperCase();
						const ch = getChannelLabel(stream.channels, stream.channel_layout);
						return ch ? `${lang} (${codec} ${ch})` : `${lang} (${codec})`;
					})
					.join(', '),
		});
	}

	if (subtitleStreams.length > 0) {
		rows.push({
			label: 'Subs',
			value:
				`${subtitleStreams.length} tracks: ` +
				subtitleStreams
					.map(
						(stream) =>
							`${stream.tags?.language ? `${languageEmojis[stream.tags.language] || stream.tags.language} ${stream.tags.language}` : '🌐'}`
					)
					.join(', '),
		});
	}

	if (format.duration) {
		rows.push({
			label: 'Duration',
			value: formatDuration(format.duration),
		});
	}

	if (chapters && chapters.length > 0) {
		rows.push({
			label: 'Chapters',
			value: `${chapters.length} chapters included`,
		});
	}

	return rows;
};

const pad = (value: number) => value.toString().padStart(2, '0');

export const buildSearchQueryFromFilename = (
	filename: string | undefined,
	mediaType: 'movie' | 'tv' | 'other' = 'movie'
) => {
	const trimmed = filename?.trim();
	if (!trimmed) return null;

	try {
		const parsed = mediaType === 'tv' ? filenameParse(trimmed, true) : filenameParse(trimmed);
		const title = parsed?.title?.trim();
		if (!title) return trimmed;

		if (mediaType === 'tv') {
			const season = Array.isArray((parsed as any).seasons)
				? (parsed as any).seasons[0]
				: undefined;
			const episode = Array.isArray((parsed as any).episodeNumbers)
				? (parsed as any).episodeNumbers[0]
				: undefined;
			if (season && episode) {
				return `${title} S${pad(season)}E${pad(episode)}`;
			}
			return title;
		}

		const year = (parsed as any).year ? String((parsed as any).year).trim() : '';
		const assembled = [title, year].filter(Boolean).join(' ').trim();
		return assembled || title;
	} catch (error) {
		return trimmed;
	}
};
