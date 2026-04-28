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
	getToken,
	getUserTorrentsList,
	RdTokenExpiredError,
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
});

describe('getToken caching', () => {
	it('caches access token and returns cached version on second call', async () => {
		genericAxios.post.mockResolvedValue({
			data: { access_token: 'tok1', expires_in: 3600 },
			status: 200,
		});

		const first = await getToken('cid', 'secret', 'refresh');
		const second = await getToken('cid', 'secret', 'refresh');

		expect(first.access_token).toBe('tok1');
		expect(second.access_token).toBe('tok1');
		expect(genericAxios.post).toHaveBeenCalledTimes(1);
	});

	it('marks token as dead on 403 and throws RdTokenExpiredError', async () => {
		const error403 = new Error('Forbidden');
		(error403 as any).response = { status: 403 };
		genericAxios.post.mockRejectedValue(error403);

		await expect(getToken('dead-cid', 'secret', 'refresh')).rejects.toThrow(
			RdTokenExpiredError
		);
		await expect(getToken('dead-cid', 'secret', 'refresh')).rejects.toThrow(
			RdTokenExpiredError
		);
		expect(genericAxios.post).toHaveBeenCalledTimes(1);
	});

	it('clears cache on non-403 errors so next request retries', async () => {
		genericAxios.post.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({
			data: { access_token: 'recovered', expires_in: 3600 },
			status: 200,
		});

		await expect(getToken('retry-cid', 'secret', 'refresh')).rejects.toThrow('Network error');
		const result = await getToken('retry-cid', 'secret', 'refresh');
		expect(result.access_token).toBe('recovered');
		expect(genericAxios.post).toHaveBeenCalledTimes(2);
	});

	it('deduplicates concurrent token requests for the same client', async () => {
		let resolvePromise: (value: any) => void;
		const pendingPromise = new Promise((resolve) => {
			resolvePromise = resolve;
		});
		genericAxios.post.mockReturnValue(pendingPromise);

		const p1 = getToken('dedup-cid', 'secret', 'refresh');
		const p2 = getToken('dedup-cid', 'secret', 'refresh');

		resolvePromise!({
			data: { access_token: 'deduped', expires_in: 3600 },
			status: 200,
		});

		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1.access_token).toBe('deduped');
		expect(r2.access_token).toBe('deduped');
		expect(genericAxios.post).toHaveBeenCalledTimes(1);
	});

	it('uses bare URL when bare flag is true', async () => {
		genericAxios.post.mockResolvedValue({
			data: { access_token: 'bare-tok', expires_in: 3600 },
			status: 200,
		});

		await getToken('bare-cid', 'secret', 'refresh', true);

		const [url] = genericAxios.post.mock.calls[0];
		expect(url).toContain('https://app.real-debrid.com/oauth/v2/token');
		expect(url).not.toContain('proxy.test');
	});
});

describe('getUserTorrentsList edge cases', () => {
	it('normalizes non-array response data to empty array', async () => {
		realAxios.get.mockResolvedValue({
			data: {},
			status: 200,
			headers: { 'x-total-count': '0' },
		});

		const result = await getUserTorrentsList('token', 10, 1);
		expect(result.data).toEqual([]);
		expect(result.totalCount).toBe(0);
	});

	it('handles missing x-total-count header', async () => {
		realAxios.get.mockResolvedValue({
			data: [{ id: '1' }],
			status: 200,
			headers: {},
		});

		const result = await getUserTorrentsList('token');
		expect(result.totalCount).toBeNull();
	});

	it('handles non-numeric x-total-count header', async () => {
		realAxios.get.mockResolvedValue({
			data: [],
			status: 200,
			headers: { 'x-total-count': 'invalid' },
		});

		const result = await getUserTorrentsList('token');
		expect(result.totalCount).toBeNull();
	});

	it('uses bare URL when bare flag is true', async () => {
		realAxios.get.mockResolvedValue({
			data: [],
			status: 200,
			headers: {},
		});

		await getUserTorrentsList('token', 5, 1, true);

		const [url] = realAxios.get.mock.calls[0];
		expect(url).toContain('https://app.real-debrid.com');
		expect(url).not.toContain('authproxy.test');
	});
});

describe('unrestrictLink edge cases', () => {
	it('skips IP for 10.x.x.x private range', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://rd.com/d/ABCDEF1234567', '10.0.0.1');
		const body = realAxios.post.mock.calls[0][1];
		expect(body).not.toContain('ip=');
	});

	it('skips IP for 127.x.x.x loopback range', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://rd.com/d/ABCDEF1234567', '127.0.0.1');
		const body = realAxios.post.mock.calls[0][1];
		expect(body).not.toContain('ip=');
	});

	it('skips IP for 169.254.x.x link-local range', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://rd.com/d/ABCDEF1234567', '169.254.1.1');
		const body = realAxios.post.mock.calls[0][1];
		expect(body).not.toContain('ip=');
	});

	it('skips IP for non-numeric IP addresses', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://rd.com/d/ABCDEF1234567', 'unknown');
		const body = realAxios.post.mock.calls[0][1];
		expect(body).not.toContain('ip=');
	});

	it('normalizes RD link IDs to 13 characters', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://real-debrid.com/d/ABCDEF1234567890EXTRA', '8.8.8.8');
		const body = realAxios.post.mock.calls[0][1] as string;
		expect(body).toContain('ABCDEF1234567');
		expect(body).not.toContain('890EXTRA');
	});

	it('includes password parameter when provided', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://example.com', '8.8.8.8', false, 'secret123');
		const body = realAxios.post.mock.calls[0][1] as string;
		expect(body).toContain('password=secret123');
	});

	it('uses bare URL when bare flag is true', async () => {
		realAxios.post.mockResolvedValue({ data: { link: 'url' } });
		await unrestrictLink('token', 'https://example.com', '8.8.8.8', true);
		const [url] = realAxios.post.mock.calls[0];
		expect(url).toContain('https://app.real-debrid.com');
	});
});

describe('RdTokenExpiredError', () => {
	it('has correct name and message', () => {
		const error = new RdTokenExpiredError('ABCDEF1234');
		expect(error.name).toBe('RdTokenExpiredError');
		expect(error.message).toContain('ABCDEF');
		expect(error).toBeInstanceOf(Error);
	});
});
