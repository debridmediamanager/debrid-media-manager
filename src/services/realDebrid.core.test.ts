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
	proxyUnrestrictLink,
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
