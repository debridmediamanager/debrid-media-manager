import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository', () => ({
	repository: {
		recordTorrentioCheckResult: vi.fn(),
		recordTorrentioHealthSnapshot: vi.fn(),
		getRecentTorrentioChecks: vi.fn(),
	},
}));

vi.mock('axios', () => {
	const actual = { isAxiosError: (e: any) => e?.isAxiosError === true };
	return {
		default: {
			...actual,
			get: vi.fn(),
			head: vi.fn(),
			isAxiosError: actual.isAxiosError,
		},
		isAxiosError: actual.isAxiosError,
	};
});

vi.mock('socks-proxy-agent', () => ({
	SocksProxyAgent: vi.fn(),
}));

import axios from 'axios';
import {
	__testing,
	isTorrentioHealthCheckInProgress,
	runTorrentioHealthCheckNow,
} from './torrentioHealth';

const { reset, FALLBACK_MOVIES, buildResolveUrl, getTestMovies, testTorrentioUrl } = __testing;
const mockAxiosHead = vi.mocked(axios.head);

beforeEach(() => {
	vi.clearAllMocks();
	reset();
});

describe('buildResolveUrl', () => {
	it('constructs correct URL with encoded filename', () => {
		const stream = {
			infoHash: 'abc123',
			fileIdx: 0,
			behaviorHints: { filename: 'Movie (2024).mkv' },
		};

		const url = buildResolveUrl('myRdKey', stream);

		expect(url).toBe(
			`https://torrentio.strem.fun/resolve/realdebrid/myRdKey/abc123/null/0/${encodeURIComponent('Movie (2024).mkv')}`
		);
	});

	it('uses title as fallback when no behaviorHints.filename', () => {
		const stream = {
			infoHash: 'def456',
			fileIdx: 2,
			title: 'Some Title',
		};

		const url = buildResolveUrl('key123', stream);

		expect(url).toContain(encodeURIComponent('Some Title'));
		expect(url).toContain('/def456/null/2/');
	});

	it('uses file_N fallback when no filename or title', () => {
		const stream = {
			infoHash: 'ghi789',
			fileIdx: 5,
		};

		const url = buildResolveUrl('key', stream);

		expect(url).toContain(encodeURIComponent('file_5'));
	});
});

describe('isTorrentioHealthCheckInProgress', () => {
	it('returns false initially', () => {
		expect(isTorrentioHealthCheckInProgress()).toBe(false);
	});
});

describe('reset', () => {
	it('clears in-progress state', () => {
		reset();
		expect(isTorrentioHealthCheckInProgress()).toBe(false);
	});
});

describe('FALLBACK_MOVIES', () => {
	it('contains expected movie IDs', () => {
		const ids = FALLBACK_MOVIES.map((m) => m.imdbId);
		expect(ids).toContain('tt0816692');
		expect(ids).toContain('tt0241527');
		expect(ids).toContain('tt0120737');
	});
});

describe('getTestMovies', () => {
	it('returns fallback when fetch fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

		const movies = await getTestMovies();

		expect(movies).toEqual(FALLBACK_MOVIES);

		vi.unstubAllGlobals();
	});

	it('returns movies from MDBList on success', async () => {
		const mdbMovies = [
			{
				id: 1,
				rank: 1,
				title: 'Test Movie',
				imdb_id: 'tt9999999',
				mediatype: 'movie',
				release_year: 2024,
			},
			{
				id: 2,
				rank: 2,
				title: 'Another Movie',
				imdb_id: 'tt8888888',
				mediatype: 'movie',
				release_year: 2023,
			},
			{
				id: 3,
				rank: 3,
				title: 'Third Movie',
				imdb_id: 'tt7777777',
				mediatype: 'movie',
				release_year: 2022,
			},
		];

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mdbMovies),
			})
		);

		const movies = await getTestMovies();

		expect(movies.length).toBe(3);
		const ids = movies.map((m) => m.imdbId);
		expect(ids).toContain('tt9999999');
		expect(ids).toContain('tt8888888');
		expect(ids).toContain('tt7777777');

		vi.unstubAllGlobals();
	});

	it('returns fallback when MDBList returns non-OK status', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

		const movies = await getTestMovies();
		expect(movies).toEqual(FALLBACK_MOVIES);

		vi.unstubAllGlobals();
	});
});

describe('testTorrentioUrl', () => {
	const agent = {} as any;

	it('returns ok for 200 status', async () => {
		mockAxiosHead.mockResolvedValue({
			status: 200,
			headers: {},
		});

		const result = await testTorrentioUrl(
			{ url: 'https://example.com/stream', expectedStatus: 200 },
			agent
		);

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
	});

	it('returns ok for 302 with valid location', async () => {
		mockAxiosHead.mockResolvedValue({
			status: 302,
			headers: { location: 'https://real-debrid.com/download/abc' },
		});

		const result = await testTorrentioUrl(
			{ url: 'https://example.com/resolve', expectedStatus: 302 },
			agent
		);

		expect(result.ok).toBe(true);
		expect(result.hasLocation).toBe(true);
		expect(result.locationValid).toBe(true);
	});

	it('returns ok for 4xx responses', async () => {
		mockAxiosHead.mockResolvedValue({
			status: 403,
			headers: {},
		});

		const result = await testTorrentioUrl(
			{ url: 'https://example.com/resolve', expectedStatus: 302 },
			agent
		);

		expect(result.ok).toBe(true);
		expect(result.status).toBe(403);
	});

	it('returns not ok for 5xx responses', async () => {
		mockAxiosHead.mockResolvedValue({
			status: 500,
			headers: {},
		});

		const result = await testTorrentioUrl(
			{ url: 'https://example.com/resolve', expectedStatus: 302 },
			agent
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain('Server error');
	});

	it('returns not ok on network error', async () => {
		const axiosError = new Error('ECONNREFUSED');
		(axiosError as any).isAxiosError = true;
		(axiosError as any).code = 'ECONNABORTED';
		mockAxiosHead.mockRejectedValue(axiosError);

		const result = await testTorrentioUrl(
			{ url: 'https://example.com/resolve', expectedStatus: 302 },
			agent
		);

		expect(result.ok).toBe(false);
		expect(result.error).toBe('Timeout');
	});
});

// Torrentio resolves with the key from its own servers, so the key it is given
// must be an account nothing else uses: never DMM's REALDEBRID_KEY, which the
// stream-server check uses from dmm-01 (one IP per Real-Debrid account).
describe('runTorrentioHealthCheckNow key', () => {
	const env = { ...process.env };
	beforeEach(() => {
		process.env = { ...env };
		vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
		mockAxiosHead.mockResolvedValue({
			status: 302,
			headers: { location: 'https://x.real-debrid.com/d/a' },
		} as any);
	});

	it('does not hand DMM REALDEBRID_KEY to Torrentio', async () => {
		process.env.REALDEBRID_KEY = 'dmm-01-key';
		delete process.env.TORRENTIO_HEALTH_RD_KEY;

		await runTorrentioHealthCheckNow();

		expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
		expect(mockAxiosHead).not.toHaveBeenCalled();
	});

	it('resolves with TORRENTIO_HEALTH_RD_KEY alone', async () => {
		process.env.REALDEBRID_KEY = 'dmm-01-key';
		process.env.TORRENTIO_HEALTH_RD_KEY = 'torrentio-only-key';
		vi.mocked(axios.get).mockImplementation(async (url: string) =>
			url.includes('ipify')
				? ({ data: { ip: '185.220.100.243' } } as any)
				: ({
						status: 200,
						data: {
							streams: [{ infoHash: 'a'.repeat(40), fileIdx: 0, title: 'Film' }],
						},
					} as any)
		);

		await runTorrentioHealthCheckNow();

		const resolved = mockAxiosHead.mock.calls.map(([url]) => String(url));
		expect(resolved.some((url) => url.includes('/realdebrid/torrentio-only-key/'))).toBe(true);
		expect(resolved.some((url) => url.includes('dmm-01-key'))).toBe(false);
	});
});
