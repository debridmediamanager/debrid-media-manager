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
	isRdThrottling,
	proxyUnrestrictLink,
	RD_ADDS_PER_MINUTE,
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

	it('counts every add attempt, refusals included', async () => {
		realAxios.post = vi.fn().mockRejectedValue(new Error('refused'));

		expect(hasRecentRdAddBurst()).toBe(false);
		for (let i = 0; i < RD_ADDS_PER_MINUTE - 1; i++) {
			await expect(addHashAsMagnet('token', hash)).rejects.toThrow();
		}
		// One short of the budget is not yet a burst.
		expect(hasRecentRdAddBurst()).toBe(false);

		await expect(addHashAsMagnet('token', hash)).rejects.toThrow();
		expect(hasRecentRdAddBurst()).toBe(true);
	});

	it('forgets adds older than the window', async () => {
		vi.useFakeTimers();
		try {
			realAxios.post = vi.fn().mockResolvedValue({ status: 201, data: { id: 'x' } });
			for (let i = 0; i < RD_ADDS_PER_MINUTE; i++) {
				await addHashAsMagnet('token', hash);
			}
			expect(hasRecentRdAddBurst()).toBe(true);

			vi.advanceTimersByTime(60_001);
			expect(hasRecentRdAddBurst()).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	// The whole point: a single add that RD refuses must not read as throttling.
	it('is not throttling after one quiet add', async () => {
		realAxios.post = vi.fn().mockRejectedValue(new Error('refused'));

		await expect(addHashAsMagnet('token', hash)).rejects.toThrow();

		expect(isRdThrottling()).toBe(false);
	});

	it('is throttling once RD has actually said so', () => {
		recordRdRateLimit();
		expect(isRdThrottling()).toBe(true);
	});
});
