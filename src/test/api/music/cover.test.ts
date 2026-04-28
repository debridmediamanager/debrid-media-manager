import handler from '@/pages/api/music/cover';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		musicMetadata: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

describe('/api/music/cover', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		global.fetch = vi.fn();
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(405);
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('returns 400 when mbid is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ error: 'Missing required fields: mbid, artist, album' });
	});

	it('returns 400 when artist is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when album is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
	});

	it('returns cached cover when exists in DB', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
			coverUrl: 'https://example.com/cover.jpg',
		} as any);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://example.com/cover.jpg',
			source: 'cached',
		});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('searches iTunes and returns cover when not cached', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const itunesResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://itunes.com/art100x100.jpg' }],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(itunesResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://itunes.com/art600x600.jpg',
			source: 'itunes',
		});
	});

	it('updates DB when cover found from iTunes', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const itunesResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://itunes.com/art100x100.jpg' }],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(itunesResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(mockedPrisma.musicMetadata.update).toHaveBeenCalledWith({
			where: { mbid: 'abc-123' },
			data: { coverUrl: 'https://itunes.com/art600x600.jpg' },
		});
	});

	it('returns null coverUrl when iTunes has no results', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);

		const emptyResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({ resultCount: 0, results: [] }),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(emptyResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ coverUrl: null });
	});

	it('falls back to album-only search when combined search has no results', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const emptyResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({ resultCount: 0, results: [] }),
		};
		const fallbackResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [
					{
						artworkUrl100: 'https://itunes.com/fallback100x100.jpg',
						artistName: 'Artist Name',
					},
				],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(emptyResponse)
			.mockResolvedValueOnce(fallbackResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist Name', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(global.fetch).toHaveBeenCalledTimes(2);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://itunes.com/fallback600x600.jpg',
			source: 'itunes',
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedPrisma.musicMetadata.findUnique.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'Failed to fetch cover' });
	});
});
