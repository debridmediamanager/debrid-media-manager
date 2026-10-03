import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE, getDMMLibrary, getDMMTorrent } from './castCatalogHelper';

const { getCastProfileMock, getTokenMock, getUserTorrentsListMock, getTorrentInfoMock } =
	vi.hoisted(() => ({
		getCastProfileMock: vi.fn(),
		getTokenMock: vi.fn(),
		getUserTorrentsListMock: vi.fn(),
		getTorrentInfoMock: vi.fn(),
	}));

vi.mock('@/services/repository', () => ({
	repository: {
		getCastProfile: getCastProfileMock,
	},
}));

vi.mock('@/services/realDebrid', () => ({
	getToken: getTokenMock,
	getUserTorrentsList: getUserTorrentsListMock,
	getTorrentInfo: getTorrentInfoMock,
}));

describe('castCatalogHelper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a 401 when the Cast profile is missing', async () => {
		getCastProfileMock.mockResolvedValue(null);

		const result = await getDMMLibrary('user-1', 1);
		expect(result).toEqual({
			error: 'Go to DMM and connect your RD account',
			status: 401,
		});
	});

	it('reads a token exchange that yields nothing as a profile to set up again', async () => {
		getCastProfileMock.mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		getTokenMock.mockResolvedValue(null);

		const result = await getDMMLibrary('user-1', 1);
		expect(result.status).toBe(401);
		expect(result.error).toBe('Go to DMM and connect your RD account');
	});

	it('lets a database error propagate instead of calling it a missing profile', async () => {
		getCastProfileMock.mockRejectedValue(new Error('db down'));
		await expect(getDMMLibrary('user-1', 1)).rejects.toThrow('db down');
	});

	it('returns the mapped torrent list with pagination info', async () => {
		getCastProfileMock.mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		getTokenMock.mockResolvedValue({ access_token: 'token' });
		getUserTorrentsListMock.mockResolvedValue({
			totalCount: 30,
			data: [
				{ id: '1', filename: 'First' },
				{ id: '2', filename: 'Second' },
			],
		});

		const result = await getDMMLibrary('user-1', 2);

		expect(getUserTorrentsListMock).toHaveBeenCalledWith('token', PAGE_SIZE, 2, true);
		expect(result.status).toBe(200);
		expect(result.data?.metas).toEqual([
			{ id: 'dmm:1', name: 'First', type: 'other' },
			{ id: 'dmm:2', name: 'Second', type: 'other' },
		]);
		expect(result.data?.hasMore).toBe(true);
	});

	it('returns an error when torrent info cannot be obtained', async () => {
		getTorrentInfoMock.mockResolvedValue(null);

		const result = await getDMMTorrent('user-1', 'torrent', 'token');
		expect(result).toEqual({
			error: 'Failed to get torrent info',
			status: 500,
		});
	});

	// 38 of 62 RD library meta 500s in one evening's dmm-01 logs were this.
	it('explains a torrent without a link per file instead of failing the meta', async () => {
		getTorrentInfoMock.mockResolvedValue({
			original_filename: 'Some.Release',
			status: 'downloading',
			hash: 'abc',
			files: [{ id: 1, selected: true }],
			links: [],
		});

		const result = await getDMMTorrent('user-1', 'torrent', 'token');
		expect(result.status).toBe(200);
		expect(result.data?.meta).toMatchObject({
			id: 'dmm:torrent',
			name: 'DMM RD: Some.Release',
			videos: [],
			description: expect.stringContaining('not finished'),
		});
	});

	it('says an archived torrent has nothing to stream', async () => {
		getTorrentInfoMock.mockResolvedValue({
			original_filename: 'Some.Release',
			status: 'downloaded',
			hash: 'abc',
			files: [
				{ id: 1, selected: true, path: '/a.mkv', bytes: 1 },
				{ id: 2, selected: true, path: '/a.srt', bytes: 1 },
			],
			links: ['https://real-debrid.com/d/ARCHIVE0000000'],
		});

		const result = await getDMMTorrent('user-1', 'torrent', 'token');
		expect(result.status).toBe(200);
		expect((result.data?.meta as { description?: string }).description).toContain('archive');
		expect(result.data?.meta.videos).toEqual([]);
	});

	it('returns the formatted torrent metadata when everything matches', async () => {
		process.env.DMM_ORIGIN = 'https://origin.example';
		getTorrentInfoMock.mockResolvedValue({
			original_filename: 'Movie.mkv',
			original_bytes: 2 * 1024 * 1024 * 1024,
			files: [
				{ id: 2, selected: true, path: '/files/B.mkv', bytes: 1.5 * 1024 * 1024 * 1024 },
				{ id: 1, selected: true, path: '/files/A.mkv', bytes: 1 * 1024 * 1024 * 1024 },
			],
			links: [
				'https://real-debrid.com/d/abcdefghijklmnopqrstuvwxyz',
				'https://real-debrid.com/d/abcdefghijklmnopqrstuvwxyz123',
			],
		});

		const result = await getDMMTorrent('user-1', 'torrent', 'rd-token');
		expect(result.status).toBe(200);
		expect(result.data?.meta.name).toContain('Movie.mkv');
		expect(result.data?.meta.videos).toHaveLength(2);
		expect(result.data?.meta.videos[0].title).toContain('A.mkv');
		expect(result.data?.meta.videos[1].title).toContain('B.mkv');
		expect(result.data?.meta.videos[0].streams[0].url).toMatch(
			/^https:\/\/origin\.example\/api\/stremio\/user-1\/play\//
		);
	});
});
