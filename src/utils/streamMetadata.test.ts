import { languageEmojis } from '@/components/showInfo/languages';
import matrixWholePass from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-matrix-whole-pass.json';
import { describe, expect, it } from 'vitest';
import {
	extractStreamMetadata,
	formatStreamTitle,
	formatStremioStreamTitle,
	generateStreamName,
} from './streamMetadata';
import { TorrentSnapshot, toStoredSnapshot } from './torrentSnapshot';

describe('extractStreamMetadata', () => {
	it('returns null for null payload', () => {
		expect(extractStreamMetadata(null)).toBe(null);
	});

	it('returns null for invalid payload', () => {
		expect(extractStreamMetadata({ invalid: 'data' })).toBe(null);
	});

	it('extracts metadata from MediaInfo at root level', () => {
		const payload = {
			MediaInfo: {
				streams: [
					{
						codec_type: 'video',
						codec_name: 'hevc',
						width: 3840,
						height: 2160,
					},
					{
						codec_type: 'audio',
						codec_name: 'eac3',
						channels: 6,
						tags: { language: 'eng' },
					},
				],
			},
		};

		const result = extractStreamMetadata(payload);
		expect(result).toMatchObject({
			resolution: '4K',
			videoCodec: 'HEVC',
			audioCodec: 'DD+',
			audioChannels: '5.1',
			languages: ['eng'],
		});
	});

	it('extracts metadata from SelectedFiles structure', () => {
		const payload = {
			SelectedFiles: {
				'file1.mkv': {
					MediaInfo: {
						streams: [
							{
								codec_type: 'video',
								codec_name: 'h264',
								width: 1920,
								height: 1080,
							},
							{
								codec_type: 'audio',
								codec_name: 'aac',
								channels: 2,
								tags: { language: 'ja' },
							},
							{
								codec_type: 'audio',
								codec_name: 'aac',
								channels: 2,
								tags: { language: 'en' },
							},
						],
					},
				},
			},
		};

		const result = extractStreamMetadata(payload);
		expect(result).toMatchObject({
			resolution: '1080p',
			videoCodec: 'H264',
			audioCodec: 'AAC',
			audioChannels: '2.0',
			languages: ['ja', 'en'],
		});
	});

	// zurg's post of The Matrix (1999) 2160p Tigole with both files probed, in the
	// order dmmdb returned the live row's files on 2026-10-08: MySQL keeps a JSON
	// object's keys shortest first, so the written introduction comes first.
	it('describes a release by its largest probed file, not the one MySQL lists first', () => {
		const stored = toStoredSnapshot(TorrentSnapshot.parse(matrixWholePass));
		const film = 'The Matrix (1999) (2160p BluRay x265 10bit HDR Tigole).mkv';
		const introduction = 'Written Introduction by The Wachowskis.mkv';
		const asMySqlReturnsIt = {
			...stored,
			SelectedFiles: {
				[introduction]: stored.SelectedFiles[introduction],
				[film]: stored.SelectedFiles[film],
			},
		};

		expect(extractStreamMetadata(asMySqlReturnsIt)).toEqual({
			languages: ['eng'],
			resolution: '1440p',
			videoCodec: 'HEVC',
			audioCodec: 'AAC',
			audioChannels: '7.1',
			hdr: undefined,
		});
	});

	it('detects HDR from side_data_list', () => {
		const payload = {
			MediaInfo: {
				streams: [
					{
						codec_type: 'video',
						codec_name: 'hevc',
						width: 3840,
						height: 2160,
						side_data_list: [{ dv_profile: 5 }],
					},
				],
			},
		};

		const result = extractStreamMetadata(payload);
		expect(result?.hdr).toBe('DV');
	});

	it('detects various resolutions', () => {
		const testCases = [
			{ height: 2160, expected: '4K' },
			{ height: 1440, expected: '1440p' },
			{ height: 1080, expected: '1080p' },
			{ height: 720, expected: '720p' },
			{ height: 480, expected: '480p' },
		];

		for (const { height, expected } of testCases) {
			const payload = {
				MediaInfo: {
					streams: [
						{
							codec_type: 'video',
							codec_name: 'h264',
							height,
						},
					],
				},
			};

			const result = extractStreamMetadata(payload);
			expect(result?.resolution).toBe(expected);
		}
	});

	it('handles audio channel layouts', () => {
		const testCases = [
			{ channels: 8, expected: '7.1' },
			{ channels: 6, expected: '5.1' },
			{ channels: 2, expected: '2.0' },
			{ channel_layout: '5.1', expected: '5.1' },
			{ channel_layout: 'stereo', expected: '2.0' },
		];

		for (const audioConfig of testCases) {
			const payload = {
				MediaInfo: {
					streams: [
						{
							codec_type: 'video',
							codec_name: 'h264',
						},
						{
							codec_type: 'audio',
							codec_name: 'aac',
							...audioConfig,
						},
					],
				},
			};

			const result = extractStreamMetadata(payload);
			expect(result?.audioChannels).toBe(audioConfig.expected);
		}
	});

	it('deduplicates languages', () => {
		const payload = {
			MediaInfo: {
				streams: [
					{
						codec_type: 'video',
						codec_name: 'h264',
					},
					{
						codec_type: 'audio',
						codec_name: 'aac',
						tags: { language: 'eng' },
					},
					{
						codec_type: 'audio',
						codec_name: 'aac',
						tags: { language: 'eng' },
					},
					{
						codec_type: 'audio',
						codec_name: 'aac',
						tags: { language: 'jpn' },
					},
				],
			},
		};

		const result = extractStreamMetadata(payload);
		expect(result?.languages).toEqual(['eng', 'jpn']);
	});
});

describe('formatStreamTitle', () => {
	it('formats title without metadata', () => {
		const result = formatStreamTitle('movie.mkv', 1536, null);
		expect(result).toBe('movie.mkv\n📦 1.50 GB');
	});

	it('formats title with full metadata', () => {
		const metadata = {
			resolution: '4K',
			videoCodec: 'HEVC',
			hdr: 'DV',
			audioCodec: 'DD+',
			audioChannels: '5.1',
			languages: ['eng', 'jpn'],
		};

		const result = formatStreamTitle('movie.mkv', 20480, metadata);
		expect(result).toContain('movie.mkv');
		expect(result).toContain('📦 20.00 GB');
		expect(result).toContain('4K');
		expect(result).toContain('DV');
		expect(result).toContain('HEVC');
		expect(result).toContain('DD+ 5.1');
		expect(result).toContain(languageEmojis.eng);
		expect(result).toContain(languageEmojis.jpn);
	});

	it('formats size in MB when less than 1GB', () => {
		const result = formatStreamTitle('small.mkv', 512, null);
		expect(result).toBe('small.mkv\n📦 512.00 MB');
	});

	it('splits long filenames', () => {
		const longName = 'A'.repeat(70);
		const result = formatStreamTitle(longName, 1024, null);
		expect(result).toContain('-\n');
	});

	it('handles URL-encoded filenames', () => {
		const encoded = 'Movie%20Name%202024.mkv';
		const result = formatStreamTitle(encoded, 1024, null);
		expect(result).toContain('Movie Name 2024.mkv');
	});

	it('creates 3-line format with full metadata', () => {
		const metadata = {
			resolution: '1080p',
			videoCodec: 'H264',
			audioCodec: 'AAC',
			audioChannels: '2.0',
			languages: ['eng'],
		};

		const result = formatStreamTitle('movie.mkv', 2048, metadata);
		const lines = result.split('\n');
		expect(lines.length).toBe(3);
		expect(lines[0]).toBe('movie.mkv');
		expect(lines[1]).toContain('📦 2.00 GB');
		expect(lines[1]).toContain('1080p');
		expect(lines[1]).toContain('H264');
		expect(lines[2]).toContain('AAC 2.0');
		expect(lines[2]).toContain(languageEmojis.eng);
	});

	it('creates 2-line format without audio metadata', () => {
		const metadata = {
			resolution: '720p',
			videoCodec: 'H264',
			languages: [],
		};

		const result = formatStreamTitle('movie.mkv', 1024, metadata);
		const lines = result.split('\n');
		expect(lines.length).toBe(2);
	});

	it('handles metadata with missing optional fields', () => {
		const metadata = {
			resolution: '1080p',
			languages: [],
		};

		const result = formatStreamTitle('movie.mkv', 2048, metadata);
		expect(result).toContain('1080p');
		expect(result).toContain('📦 2.00 GB');
	});

	it('shows multiple language flags', () => {
		const metadata = {
			audioCodec: 'AAC',
			languages: ['eng', 'jpn', 'fre', 'ger'],
		};

		const result = formatStreamTitle('movie.mkv', 1024, metadata);
		expect(result).toContain(languageEmojis.eng);
		expect(result).toContain(languageEmojis.jpn);
		expect(result).toContain(languageEmojis.fre);
		expect(result).toContain(languageEmojis.ger);
	});
});

describe('formatStremioStreamTitle', () => {
	it('formats title for user cast with metadata', () => {
		const metadata = {
			resolution: '4K',
			videoCodec: 'HEVC',
			audioCodec: 'DD+',
			audioChannels: '5.1',
			languages: ['eng', 'jpn'],
		};

		const result = formatStremioStreamTitle('movie.mkv', 20480, metadata, true);
		const lines = result.split('\n');
		expect(lines.length).toBe(3);
		expect(lines[0]).toBe('movie.mkv');
		expect(lines[1]).toContain('DD+ 5.1');
		expect(lines[1]).toContain(languageEmojis.eng);
		expect(lines[1]).toContain(languageEmojis.jpn);
		expect(lines[2]).toBe('🎬 DMM Cast RD (Yours)');
	});

	it('formats title for other user cast with metadata', () => {
		const metadata = {
			resolution: '1080p',
			videoCodec: 'H264',
			audioCodec: 'AAC',
			audioChannels: '2.0',
			languages: ['eng'],
		};

		const result = formatStremioStreamTitle('movie.mkv', 2048, metadata, false);
		const lines = result.split('\n');
		expect(lines.length).toBe(3);
		expect(lines[0]).toBe('movie.mkv');
		expect(lines[1]).toContain('AAC 2.0');
		expect(lines[1]).toContain(languageEmojis.eng);
		expect(lines[2]).toBe('🎬 DMM Cast RD');
	});

	it('formats title without metadata for user cast', () => {
		const result = formatStremioStreamTitle('movie.mkv', 1024, null, true);
		const lines = result.split('\n');
		expect(lines.length).toBe(2);
		expect(lines[0]).toBe('movie.mkv');
		expect(lines[1]).toBe('🎬 DMM Cast RD (Yours)');
	});

	it('formats title without metadata for other user', () => {
		const result = formatStremioStreamTitle('movie.mkv', 1024, null, false);
		const lines = result.split('\n');
		expect(lines.length).toBe(2);
		expect(lines[0]).toBe('movie.mkv');
		expect(lines[1]).toBe('🎬 DMM Cast RD');
	});

	it('splits long filenames', () => {
		const longName = 'A'.repeat(70);
		const result = formatStremioStreamTitle(longName, 1024, null, false);
		expect(result).toContain('-\n');
	});
});

describe('generateStreamName', () => {
	it('generates name with full metadata', () => {
		const metadata = {
			resolution: '4K',
			videoCodec: 'HEVC',
			languages: [],
		};

		const result = generateStreamName(20480, metadata);
		expect(result).toBe('4K • HEVC • 20.00 GB');
	});

	it('generates name with partial metadata', () => {
		const metadata = {
			resolution: '1080p',
			languages: [],
		};

		const result = generateStreamName(2048, metadata);
		expect(result).toBe('1080p • 2.00 GB');
	});

	it('generates name without metadata', () => {
		const result = generateStreamName(1024, null);
		expect(result).toBe('1024.00 MB');
	});

	it('generates name with codec only', () => {
		const metadata = {
			videoCodec: 'H264',
			languages: [],
		};

		const result = generateStreamName(512, metadata);
		expect(result).toBe('H264 • 512.00 MB');
	});
});
