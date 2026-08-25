import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
	requestMock: vi.fn(),
	recordTorBoxOperation: vi.fn(),
	// Captured from the module-level `torBoxAxios.interceptors.response.use(...)`
	// so the real handlers can be driven directly.
	onResponse: null as ((response: any) => any) | null,
	onResponseError: null as ((error: any) => any) | null,
}));

vi.mock('axios', () => ({
	default: {
		create: vi.fn(() => ({
			get: mocks.getMock,
			post: mocks.postMock,
			request: mocks.requestMock,
			interceptors: {
				request: { use: vi.fn(), eject: vi.fn() },
				response: {
					use: vi.fn((onFulfilled, onRejected) => {
						mocks.onResponse = onFulfilled;
						mocks.onResponseError = onRejected;
					}),
					eject: vi.fn(),
				},
			},
		})),
		isAxiosError: vi.fn(() => true),
	},
}));

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			proxy: 'https://anticors.example/anticors?url=',
			authProxy: 'https://#num#.cors.example/api/anticors?url=',
			torboxHostname: 'https://api.torbox.test',
		},
	}),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		recordTorBoxOperation: mocks.recordTorBoxOperation,
	},
}));

vi.mock('@/utils/delay', () => ({
	delay: vi.fn(() => Promise.resolve()),
}));

import { getTorrentList, getUserData, requestDownloadLink } from './torbox';

const TB = 'https://api.torbox.test';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.recordTorBoxOperation.mockResolvedValue(undefined);
	mocks.getMock.mockResolvedValue({ data: { success: true, data: [] }, status: 200 });
	mocks.postMock.mockResolvedValue({ data: { success: true }, status: 200 });
});

describe('TorBox browser proxy routing', () => {
	// Browser traffic must egress from the Cloudflare Worker's IP pool, never
	// from our own anticors. `*.cors.debridmediamanager.com` resolves to the one
	// dmm-01 host, so routing every user's TorBox calls through it pooled the
	// whole user base into a single per-IP rate-limit bucket. TorBox started
	// 429ing 7 minutes after that shipped on 2026-08-24 and kept throttling ~20%
	// of all calls (27% of `/user/me`), which wedged the home page for 330 of 549
	// users: `index.tsx` renders nothing until every provider profile resolves,
	// and a 429 parks `getUserData` behind a 5-minute pause for 3 retries.
	it('routes an ordinary browser call through the Cloudflare Worker', async () => {
		await getTorrentList('token');

		const url = mocks.getMock.mock.calls[0][0] as string;
		expect(url).toContain(`${TB}/v1/api/torrents/mylist`);
		expect(url).toMatch(/^https:\/\/anticors\.example\/anticors\?url=/);
	});

	// The profile call is the one that gates the home page, so it is the one a
	// shared rate-limit bucket hurts most.
	it('keeps the profile call off our own single-IP anticors', async () => {
		await getUserData('token');

		const url = mocks.getMock.mock.calls[0][0] as string;
		expect(url).toContain(`${TB}/v1/api/user/me`);
		expect(url).not.toMatch(/\d+\.cors\.example/);
	});

	// requestdl puts the raw API key in `?token=`. Our own nginx logs query
	// strings, so these must stay off it regardless of what else changes.
	it('keeps requestdl on the Cloudflare Worker proxy', async () => {
		mocks.getMock.mockResolvedValue({ data: { success: true, data: 'link' }, status: 200 });

		await requestDownloadLink('token', { torrent_id: 1 });

		const url = mocks.getMock.mock.calls[0][0] as string;
		expect(url).toBe(`https://anticors.example/anticors?url=${TB}/v1/api/torrents/requestdl`);
		expect(url).not.toMatch(/\d+\.cors\.example/);
	});

	it('keeps webdl requestdl on the Cloudflare Worker proxy too', async () => {
		mocks.getMock.mockResolvedValue({ data: { success: true, data: 'link' }, status: 200 });

		const { requestWebDownloadLink } = await import('./torbox');
		await requestWebDownloadLink('token', { web_id: 1 });

		const url = mocks.getMock.mock.calls[0][0] as string;
		expect(url).toBe(`https://anticors.example/anticors?url=${TB}/v1/api/webdl/requestdl`);
	});
});

describe('TorBox operation recording', () => {
	function respond(url: string, method: string, status: number) {
		return mocks.onResponse!({
			config: { url, method, __slotAcquired: false },
			status,
		});
	}

	function reject(url: string, method: string, error: any) {
		return mocks.onResponseError!({
			...error,
			config: { url, method, __slotAcquired: false, ...(error.config ?? {}) },
		});
	}

	it('records a successful call', async () => {
		respond(`${TB}/v1/api/torrents/mylist`, 'get', 200);

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /torrents/mylist', 200);
	});

	it('unwraps a proxied url before resolving the operation', async () => {
		respond(
			`https://7.cors.example/api/anticors?url=${TB}/v1/api/torrents/checkcached`,
			'get',
			200
		);

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /torrents/checkcached', 200);
	});

	it('ignores an endpoint that is not monitored', async () => {
		respond(`${TB}/v1/api/stats`, 'get', 200);

		expect(mocks.recordTorBoxOperation).not.toHaveBeenCalled();
	});

	it('records a 4xx, which the aggregator keeps out of the success rate', async () => {
		await expect(
			reject(`${TB}/v1/api/torrents/mylist`, 'get', { response: { status: 401 } })
		).rejects.toBeDefined();

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /torrents/mylist', 401);
	});

	// A connection that never produced a response is a failed call as far as
	// the user is concerned, so it has to land in the 5xx bucket.
	it('records a response-less network error as a 500', async () => {
		await expect(
			reject(`${TB}/v1/api/user/me`, 'get', { message: 'socket hang up' })
		).rejects.toBeDefined();

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /user/me', 500);
	});

	it('records a skipRetry failure at its own status', async () => {
		await expect(
			reject(`${TB}/v1/api/torrents/mylist`, 'get', {
				response: { status: 503 },
				config: { __skipRetry: true },
			})
		).rejects.toBeDefined();

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /torrents/mylist', 503);
	});

	// One logical call must count once. A 5xx that the interceptor is about to
	// retry is not terminal - the retried request records its own outcome.
	it('does not record a retryable 5xx before the retry runs', async () => {
		mocks.requestMock.mockResolvedValue({ data: { success: true }, status: 200 });

		await reject(`${TB}/v1/api/torrents/mylist`, 'get', { response: { status: 500 } });

		expect(mocks.requestMock).toHaveBeenCalled();
		expect(mocks.recordTorBoxOperation).not.toHaveBeenCalled();
	});

	it('records once the retry budget is exhausted', async () => {
		await expect(
			reject(`${TB}/v1/api/torrents/mylist`, 'get', {
				response: { status: 500 },
				config: { __retryCount: 7 },
			})
		).rejects.toBeDefined();

		expect(mocks.recordTorBoxOperation).toHaveBeenCalledTimes(1);
		expect(mocks.recordTorBoxOperation).toHaveBeenCalledWith('GET /torrents/mylist', 500);
	});

	it('survives an error with no config at all', async () => {
		await expect(mocks.onResponseError!({ message: 'boom' })).rejects.toBeDefined();

		expect(mocks.recordTorBoxOperation).not.toHaveBeenCalled();
	});
});
