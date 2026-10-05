import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			proxy: 'https://proxy.test/',
			authProxy: 'https://authproxy.test/',
			realDebridHostname: 'https://rd.test',
			realDebridClientId: 'CLIENT_ID',
		},
	}),
}));

vi.mock('@/lib/observability/rdOperationalStats', () => ({
	recordRdOperationEvent: vi.fn(),
}));

import { RD_ADD_PAUSE_MS } from '@/utils/rdAddPause';
import {
	__testing,
	addHashAsMagnet,
	addTorrentFile,
	deleteTorrent,
	getCredentials,
	getCurrentUser,
	getDeviceCode,
	getTimeISO,
	getToken,
	getTorrentInfo,
	getUserTorrentsList,
	hasRecentRdAddBurst,
	hasRecentRdRateLimits,
	isRdThrottling,
	proxyUnrestrictLink,
	RD_ADD_MIN_SPACING_MS,
	RD_ADDS_PER_MINUTE,
	rdAddPauseRemainingMs,
	recordRdAddAttempt,
	recordRdAddPause,
	recordRdRateLimit,
	resetRdThrottleTracking,
	selectFiles,
	unrestrictLink,
} from './realDebrid';

const realAxios = __testing.realDebridAxios as any;
const genericAxios = __testing.genericAxios as any;

beforeEach(() => {
	realAxios.get = vi.fn();
	realAxios.post = vi.fn();
	realAxios.put = vi.fn();
	realAxios.delete = vi.fn();
	genericAxios.get = vi.fn();
	genericAxios.post = vi.fn();
	__testing.clearUserRequestCache();
	__testing.resetTimeISOCache();
	__testing.clearAccessTokenCache();
	resetRdThrottleTracking();
});

describe('RealDebrid auth helpers', () => {
	it('fetches device code, credentials, and tokens through the proxy client', async () => {
		genericAxios.get
			.mockResolvedValueOnce({ data: { device_code: 'dev' } })
			.mockResolvedValueOnce({ data: { client_id: 'id', client_secret: 'secret' } });
		genericAxios.post.mockResolvedValue({ data: { access_token: 'token' }, status: 200 });

		await expect(getDeviceCode()).resolves.toEqual({ device_code: 'dev' });
		await expect(getCredentials('dev')).resolves.toEqual({
			client_id: 'id',
			client_secret: 'secret',
		});
		await expect(getToken('id', 'secret', 'refresh')).resolves.toEqual({
			access_token: 'token',
		});

		expect(genericAxios.post).toHaveBeenCalled();
	});
});

describe('RealDebrid user cache', () => {
	it('deduplicates concurrent user lookups per token', async () => {
		vi.useFakeTimers();
		try {
			realAxios.get.mockResolvedValue({ data: { id: 1 }, status: 200 });

			const [first, second] = await Promise.all([
				getCurrentUser('token'),
				getCurrentUser('token'),
			]);
			expect(first).toEqual({ id: 1 });
			expect(second).toEqual({ id: 1 });
			expect(realAxios.get).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(150);
			await getCurrentUser('token');
			expect(realAxios.get).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('RealDebrid torrent APIs', () => {
	it('fetches paginated torrents and parses total count', async () => {
		realAxios.get.mockResolvedValue({
			data: [{ id: '1' }],
			status: 200,
			headers: { 'x-total-count': '42' },
		});

		const result = await getUserTorrentsList('token', 10, 2);

		expect(result).toEqual({ data: [{ id: '1' }], totalCount: 42 });
		expect(realAxios.get).toHaveBeenCalledTimes(1);
	});

	it('retrieves torrent info with auth header', async () => {
		realAxios.get.mockResolvedValue({ data: { id: 'rd1' }, status: 200 });
		await expect(getTorrentInfo('token', 'abc')).resolves.toEqual({ id: 'rd1' });
		const [, options] = realAxios.get.mock.calls[0];
		expect(options.headers.Authorization).toBe('Bearer token');
	});

	it('adds magnets only when the hash is valid', async () => {
		await expect(addHashAsMagnet('token', 'not-a-hash')).rejects.toThrow('Invalid SHA40 hash');
		expect(realAxios.post).not.toHaveBeenCalled();

		realAxios.post.mockResolvedValue({ status: 201, data: { id: 'new' } });
		const id = await addHashAsMagnet('token', 'a'.repeat(40));
		expect(id).toBe('new');
		const [url, body] = realAxios.post.mock.calls[0];
		expect(url).toContain('/torrents/addMagnet');
		expect(body).toContain('magnet%3A%3Fxt%3Durn%3Abtih%3A');
	});

	it('uploads torrent files and returns the identifier', async () => {
		const buffer = new ArrayBuffer(8);
		const fakeFile = {
			arrayBuffer: vi.fn().mockResolvedValue(buffer),
		} as unknown as File;
		realAxios.put.mockResolvedValue({ status: 201, data: { id: 'file-id' } });

		await expect(addTorrentFile('token', fakeFile)).resolves.toBe('file-id');
		expect(fakeFile.arrayBuffer).toHaveBeenCalled();
		expect(realAxios.put).toHaveBeenCalledWith(
			expect.stringContaining('/torrents/addTorrent'),
			buffer,
			expect.any(Object)
		);
	});

	it('selects files and deletes torrents using the API client', async () => {
		realAxios.post.mockResolvedValue({ status: 204 });
		await selectFiles('token', 'id', ['1', '2']);
		const [, body] = realAxios.post.mock.calls[0];
		expect(body).toContain('files=1%2C2');

		realAxios.delete.mockResolvedValue({ status: 204 });
		await deleteTorrent('token', 'id');
		expect(realAxios.delete).toHaveBeenCalledWith(
			expect.stringContaining('/torrents/delete/id'),
			expect.any(Object)
		);
	});
});

describe('RealDebrid link helpers', () => {
	it('includes public IPs and skips private ones when unrestricting links', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });

		await unrestrictLink('token', 'https://example.com', '8.8.8.8');
		await unrestrictLink('token', 'https://example.com', '192.168.0.1');

		const publicCall = realAxios.post.mock.calls[0];
		expect(publicCall[1]).toContain('ip=8.8.8.8');

		const privateCall = realAxios.post.mock.calls[1];
		expect(privateCall[1]).not.toContain('ip=');
	});

	it('delegates proxy unrestrict to the generic axios client', async () => {
		genericAxios.post.mockResolvedValue({ data: { link: 'proxied' } });
		await expect(proxyUnrestrictLink('token', 'https://example.com')).resolves.toEqual({
			link: 'proxied',
		});
		const [url, body] = genericAxios.post.mock.calls[0];
		expect(url).toBe('https://unrestrict.debridmediamanager.com/');
		expect(body).toBe(JSON.stringify({ link: 'https://example.com' }));
	});
});

describe('RealDebrid time helpers', () => {
	it('caches time responses for 10 seconds', async () => {
		genericAxios.get.mockResolvedValue({ data: '2023-01-01' });
		await expect(getTimeISO()).resolves.toBe('2023-01-01');
		await expect(getTimeISO()).resolves.toBe('2023-01-01');
		expect(genericAxios.get).toHaveBeenCalledTimes(1);
	});

	it('retries fetching time after an error', async () => {
		genericAxios.get
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValueOnce({ data: 'ok' });

		await expect(getTimeISO()).rejects.toThrow('fail');
		await expect(getTimeISO()).resolves.toBe('ok');
		expect(genericAxios.get).toHaveBeenCalledTimes(2);
	});
});

// `addMagnet` has a budget of its own and it belongs to the account, not the
// address. Measured 2026-09-17: bursting one test account from one host earned
// `429 too_many_requests` after 25 to 31 adds and settled at about 30 accepted a
// minute, while an idle token from that same address kept getting 201 (8 of 8)
// and the burned token was refused from a different host (6 of 8). So dmm can
// only stay inside it by adding more slowly, and it can only honestly blame a
// throttle when it has been adding fast.
describe('RealDebrid add budget', () => {
	const hash = 'a'.repeat(40);

	it('spaces bulk adds to the add budget rather than the API budget', () => {
		expect(RD_ADDS_PER_MINUTE).toBe(30);
		expect(RD_ADD_MIN_SPACING_MS).toBe(2000);
	});

	it('counts every add attempt, refusals included', async () => {
		realAxios.post = vi.fn().mockRejectedValue(new Error('refused'));

		expect(hasRecentRdAddBurst('token')).toBe(false);
		for (let i = 0; i < RD_ADDS_PER_MINUTE - 1; i++) {
			await expect(addHashAsMagnet('token', hash)).rejects.toThrow();
		}
		// One short of the budget is not yet a burst.
		expect(hasRecentRdAddBurst('token')).toBe(false);

		await expect(addHashAsMagnet('token', hash)).rejects.toThrow();
		expect(hasRecentRdAddBurst('token')).toBe(true);
	});

	it('forgets adds older than the window', async () => {
		vi.useFakeTimers();
		try {
			realAxios.post = vi.fn().mockResolvedValue({ status: 201, data: { id: 'x' } });
			for (let i = 0; i < RD_ADDS_PER_MINUTE; i++) {
				await addHashAsMagnet('token', hash);
			}
			expect(hasRecentRdAddBurst('token')).toBe(true);

			vi.advanceTimersByTime(60_001);
			expect(hasRecentRdAddBurst('token')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	// A single add that fails for some other reason must not read as throttling.
	it('is not throttling after one quiet add', async () => {
		realAxios.post = vi.fn().mockRejectedValue(new Error('refused'));

		await expect(addHashAsMagnet('token', hash)).rejects.toThrow();

		expect(isRdThrottling('token')).toBe(false);
	});

	it('is throttling once RD has actually said so', () => {
		recordRdRateLimit('token');
		expect(isRdThrottling('token')).toBe(true);
	});

	// On the server this module serves every user at once.
	it("keeps each account's state to that account", async () => {
		recordRdRateLimit('token');
		for (let i = 0; i < RD_ADDS_PER_MINUTE; i++) recordRdAddAttempt('token');
		recordRdAddPause('token');

		expect(isRdThrottling('token')).toBe(true);
		expect(isRdThrottling('other')).toBe(false);
		expect(hasRecentRdAddBurst('other')).toBe(false);
		expect(rdAddPauseRemainingMs('other')).toBe(0);
	});

	it('keys a 429 to the token that drew it', async () => {
		vi.useFakeTimers();
		try {
			const adapter = vi.fn(async (config: any) => {
				const error: any = new Error('Request failed with status code 429');
				error.config = config;
				error.response = { status: 429, data: {}, headers: {}, config };
				error.isAxiosError = true;
				throw error;
			});
			// The response interceptor retries a 429 with backoff; the first one
			// is all this needs, so the rest are left to the fake clock.
			void realAxios
				.request({
					url: 'https://rd.test/rest/1.0/torrents',
					method: 'get',
					headers: { Authorization: 'Bearer limited-token' },
					adapter,
				})
				.catch(() => undefined);
			await vi.advanceTimersByTimeAsync(500);

			expect(adapter).toHaveBeenCalled();
			expect(hasRecentRdRateLimits('limited-token')).toBe(true);
			expect(hasRecentRdRateLimits('token')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

// RD answers an add with `451 infringing_file` while it refuses every add on
// the account for a while (21 s to about five minutes, measured 2026-10-04/05;
// see src/utils/rdAddPause.ts). An add fired into that pause is refused too,
// so the account's adds wait it out instead.
describe('RealDebrid account pause', () => {
	const hash = 'b'.repeat(40);
	const refusal = () => {
		const error: any = new Error('Request failed with status code 451');
		error.isAxiosError = true;
		error.response = { status: 451, data: { error: 'infringing_file', error_code: 35 } };
		return error;
	};

	it('puts the account on pause after a 451 and holds its next add', async () => {
		vi.useFakeTimers();
		try {
			const sentAt: number[] = [];
			realAxios.post = vi.fn(async () => {
				sentAt.push(Date.now());
				if (sentAt.length === 1) throw refusal();
				return { status: 201, data: { id: 'x' } };
			});
			const start = Date.now();

			await expect(addHashAsMagnet('token', hash)).rejects.toMatchObject({
				response: { status: 451 },
			});
			expect(rdAddPauseRemainingMs('token')).toBe(RD_ADD_PAUSE_MS);

			const next = addHashAsMagnet('token', hash);
			await vi.advanceTimersByTimeAsync(RD_ADD_PAUSE_MS - 1);
			expect(sentAt).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1);
			await expect(next).resolves.toBe('x');
			expect(sentAt[1] - start).toBeGreaterThanOrEqual(RD_ADD_PAUSE_MS);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not hold anything for a 451 on a name RD blocks', async () => {
		realAxios.post = vi.fn().mockRejectedValue(refusal());

		await expect(
			addHashAsMagnet('token', hash, false, { nameIsBlocked: true })
		).rejects.toThrow();

		expect(rdAddPauseRemainingMs('token')).toBe(0);
	});

	it('holds .torrent uploads too', async () => {
		realAxios.put = vi.fn().mockRejectedValue(refusal());
		const file = { arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) } as unknown as File;

		await expect(addTorrentFile('token', file)).rejects.toMatchObject({
			response: { status: 451 },
		});

		expect(rdAddPauseRemainingMs('token')).toBeGreaterThan(RD_ADD_PAUSE_MS - 1000);
	});

	it('does not put the account on pause for other failures', async () => {
		realAxios.post = vi.fn().mockRejectedValue(new Error('network'));

		await expect(addHashAsMagnet('token', hash)).rejects.toThrow();

		expect(rdAddPauseRemainingMs('token')).toBe(0);
	});
});
