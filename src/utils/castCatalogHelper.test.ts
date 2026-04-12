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

	it('returns a 500 when the token exchange fails', async () => {
		getCastProfileMock.mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		getTokenMock.mockResolvedValue(null);

		const result = await getDMMLibrary('user-1', 1);
		expect(result.status).toBe(500);
		expect(result.error).toBe('Go to DMM and connect your RD account');
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

	it('errors out when selected files and links do not match', async () => {
		getTorrentInfoMock.mockResolvedValue({
			files: [{ id: 1, selected: true }],
			links: [],
		});

		const result = await getDMMTorrent('user-1', 'torrent', 'token');
		expect(result.status).toBe(500);
		expect(result.error).toContain('missing');
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
