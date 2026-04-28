import handler from '@/pages/api/music/debug';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		availableMusic: {
			count: vi.fn(),
			groupBy: vi.fn(),
			findFirst: vi.fn(),
		},
		availableMusicFile: {
			count: vi.fn(),
			findMany: vi.fn(),
		},
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

describe('/api/music/debug', () => {
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

	it('returns correct stats structure', async () => {
		mockedPrisma.availableMusic.count.mockResolvedValueOnce(10);
		mockedPrisma.availableMusic.count.mockResolvedValueOnce(5);
		mockedPrisma.availableMusicFile.count.mockResolvedValue(50);
		mockedPrisma.availableMusic.findFirst.mockResolvedValue({
			hash: 'abc123',
			mbid: 'mbid-1',
			filename: 'album.zip',
			status: 'downloaded',
			progress: 100,
			files: [
				{ path: '/music/track1.flac', bytes: BigInt(1000), trackNumber: 1 },
				{ path: '/music/track2.mp3', bytes: BigInt(2000), trackNumber: 2 },
			],
		} as any);
		mockedPrisma.availableMusic.groupBy.mockResolvedValue([
			{ status: 'downloaded', _count: 5 },
			{ status: 'pending', _count: 5 },
		] as any);
		mockedPrisma.availableMusicFile.findMany.mockResolvedValue([
			{ path: '/music/track1.flac' },
			{ path: '/music/track2.mp3' },
			{ path: '/music/cover.jpg' },
		] as any);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.totalAlbums).toBe(10);
		expect(data.downloadedAlbums).toBe(5);
		expect(data.totalFiles).toBe(50);
		expect(data.sampleAlbum).toBeDefined();
		expect(data.sampleAlbum.hash).toBe('abc123');
		expect(data.sampleAlbum.fileCount).toBe(2);
		expect(data.statuses).toEqual([
			{ status: 'downloaded', _count: 5 },
			{ status: 'pending', _count: 5 },
		]);
	});

	it('returns null sampleAlbum when no albums exist', async () => {
		mockedPrisma.availableMusic.count.mockResolvedValue(0);
		mockedPrisma.availableMusicFile.count.mockResolvedValue(0);
		mockedPrisma.availableMusic.findFirst.mockResolvedValue(null);
		mockedPrisma.availableMusic.groupBy.mockResolvedValue([] as any);
		mockedPrisma.availableMusicFile.findMany.mockResolvedValue([]);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.sampleAlbum).toBeNull();
		expect(data.totalAlbums).toBe(0);
	});

	it('computes extension distribution correctly', async () => {
		mockedPrisma.availableMusic.count.mockResolvedValue(0);
		mockedPrisma.availableMusicFile.count.mockResolvedValue(0);
		mockedPrisma.availableMusic.findFirst.mockResolvedValue(null);
		mockedPrisma.availableMusic.groupBy.mockResolvedValue([] as any);
		mockedPrisma.availableMusicFile.findMany.mockResolvedValue([
			{ path: '/music/track1.flac' },
			{ path: '/music/track2.flac' },
			{ path: '/music/track3.mp3' },
			{ path: '/music/cover.jpg' },
			{ path: '/music/noext' },
		] as any);

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		const data = res._getData() as any;
		expect(data.extensionDistribution).toEqual({
			'.flac': 2,
			'.mp3': 1,
			'.jpg': 1,
			'(no extension)': 1,
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedPrisma.availableMusic.count.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
	});
});
