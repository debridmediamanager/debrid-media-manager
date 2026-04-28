import handler from '@/pages/api/music/library';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		availableMusic: {
			findMany: vi.fn(),
		},
		musicMetadata: {
			findMany: vi.fn(),
		},
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

function makeFile(
	overrides: Partial<{
		file_id: number;
		path: string;
		bytes: bigint;
		trackNumber: number | null;
		link: string;
	}> = {}
) {
	return {
		file_id: 1,
		path: '/music/01 - Track.flac',
		bytes: BigInt(5000000),
		trackNumber: null,
		link: 'https://example.com/file',
		...overrides,
	};
}

function makeAlbum(
	overrides: Partial<{
		hash: string;
		mbid: string;
		filename: string;
		bytes: bigint;
		ended: Date;
		files: any[];
	}> = {}
) {
	return {
		hash: 'hash1',
		mbid: 'mbid-1',
		filename: 'Test Album',
		bytes: BigInt(50000000),
		ended: new Date('2024-01-01'),
		files: [],
		...overrides,
	};
}

describe('/api/music/library', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects non-GET methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(405);
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('returns empty library when no music', async () => {
		mockedPrisma.availableMusic.findMany.mockResolvedValue([]);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.albums).toEqual([]);
		expect(data.totalAlbums).toBe(0);
		expect(data.totalTracks).toBe(0);
	});

	it('returns albums with tracks, filtering non-audio files', async () => {
		const album = makeAlbum({
			files: [
				makeFile({ file_id: 1, path: '/music/01 - Song.flac' }),
				makeFile({ file_id: 2, path: '/music/cover.jpg' }),
				makeFile({ file_id: 3, path: '/music/info.nfo' }),
				makeFile({ file_id: 4, path: '/music/02 - Song.mp3' }),
				makeFile({ file_id: 5, path: '/music/playlist.m3u' }),
			],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([
			{
				mbid: 'mbid-1',
				artist: 'Test Artist',
				album: 'Test Album',
				year: 2024,
				coverUrl: null,
			},
		] as any);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.totalAlbums).toBe(1);
		expect(data.albums[0].trackCount).toBe(2);
		const filenames = data.albums[0].tracks.map((t: any) => t.filename);
		expect(filenames).not.toContain('cover.jpg');
		expect(filenames).not.toContain('info.nfo');
		expect(filenames).not.toContain('playlist.m3u');
	});

	it('extracts track numbers from filenames with "01 - Track.flac" pattern', async () => {
		const album = makeAlbum({
			files: [
				makeFile({ file_id: 1, path: '/music/02 - Second.flac' }),
				makeFile({ file_id: 2, path: '/music/01 - First.flac' }),
			],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		const tracks = data.albums[0].tracks;
		expect(tracks[0].trackNumber).toBe(1);
		expect(tracks[0].filename).toBe('01 - First.flac');
		expect(tracks[1].trackNumber).toBe(2);
		expect(tracks[1].filename).toBe('02 - Second.flac');
	});

	it('extracts track numbers from "track01.mp3" pattern', async () => {
		const album = makeAlbum({
			files: [makeFile({ file_id: 1, path: '/music/track03.mp3' })],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.albums[0].tracks[0].trackNumber).toBe(3);
	});

	it('extracts track numbers from "[01] Track" pattern', async () => {
		const album = makeAlbum({
			files: [makeFile({ file_id: 1, path: '/music/[05] Track Five.flac' })],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.albums[0].tracks[0].trackNumber).toBe(5);
	});

	it('extracts track numbers from "01) Track" pattern', async () => {
		const album = makeAlbum({
			files: [makeFile({ file_id: 1, path: '/music/07) Track Seven.flac' })],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.albums[0].tracks[0].trackNumber).toBe(7);
	});

	it('sorts tracks by track number', async () => {
		const album = makeAlbum({
			files: [
				makeFile({ file_id: 1, path: '/music/03 - Third.flac' }),
				makeFile({ file_id: 2, path: '/music/01 - First.flac' }),
				makeFile({ file_id: 3, path: '/music/02 - Second.flac' }),
			],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([album] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		const trackNumbers = data.albums[0].tracks.map((t: any) => t.trackNumber);
		expect(trackNumbers).toEqual([1, 2, 3]);
	});

	it('deduplicates albums by mbid keeping most tracks', async () => {
		const albumFewer = makeAlbum({
			hash: 'hash1',
			mbid: 'mbid-dup',
			files: [makeFile({ file_id: 1, path: '/music/01 - Track.flac' })],
		});
		const albumMore = makeAlbum({
			hash: 'hash2',
			mbid: 'mbid-dup',
			files: [
				makeFile({ file_id: 1, path: '/music/01 - Track.flac' }),
				makeFile({ file_id: 2, path: '/music/02 - Track.flac' }),
				makeFile({ file_id: 3, path: '/music/03 - Track.flac' }),
			],
		});
		mockedPrisma.availableMusic.findMany.mockResolvedValue([albumFewer, albumMore] as any);
		mockedPrisma.musicMetadata.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.totalAlbums).toBe(1);
		expect(data.albums[0].trackCount).toBe(3);
		expect(data.albums[0].hash).toBe('hash2');
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedPrisma.availableMusic.findMany.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'Failed to fetch music library' });
	});
});
