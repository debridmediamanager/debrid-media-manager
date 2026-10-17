import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rexDirectHostname, upsertRexDirectRecord } from './rexDirectDns';

const OLD = process.env;

describe('rexDirectDns', () => {
	beforeEach(() => {
		process.env = {
			...OLD,
			REXDIRECT_CF_TOKEN: 'tok',
			REXDIRECT_CF_ZONE: 'zone1',
			REXDIRECT_BASE: 'rex-direct.debridmediamanager.com',
		};
	});
	afterEach(() => {
		process.env = OLD;
		vi.restoreAllMocks();
	});

	it('builds the hostname under the configured base', () => {
		expect(rexDirectHostname('abc')).toBe('abc.rex-direct.debridmediamanager.com');
	});

	it('creates the A record when none exists', async () => {
		const calls: Array<{ url: string; method?: string; body?: any }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: any) => {
				calls.push({
					url,
					method: init?.method,
					body: init?.body && JSON.parse(init.body),
				});
				if (init?.method === 'GET') return json({ success: true, result: [] });
				return json({ success: true, result: { id: 'new' } });
			})
		);
		const name = await upsertRexDirectRecord('hh', '9.9.9.9');
		expect(name).toBe('hh.rex-direct.debridmediamanager.com');
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toMatchObject({
			type: 'A',
			content: '9.9.9.9',
			proxied: false,
			ttl: 120,
		});
		expect(post?.url).not.toContain('/dns_records/'); // create, not update
	});

	it('updates the record when the IP changed', async () => {
		const calls: Array<{ url: string; method?: string; body?: any }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: any) => {
				calls.push({
					url,
					method: init?.method,
					body: init?.body && JSON.parse(init.body),
				});
				if (init?.method === 'GET')
					return json({ success: true, result: [{ id: 'rec1', content: '1.1.1.1' }] });
				return json({ success: true, result: { id: 'rec1' } });
			})
		);
		await upsertRexDirectRecord('hh', '2.2.2.2');
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.url).toContain('/dns_records/rec1');
		expect(put?.body).toMatchObject({ content: '2.2.2.2' });
	});

	it('does not write when the record already points at the IP', async () => {
		const methods: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: any) => {
				methods.push(init?.method);
				return json({ success: true, result: [{ id: 'rec1', content: '3.3.3.3' }] });
			})
		);
		await upsertRexDirectRecord('hh', '3.3.3.3');
		expect(methods).toEqual(['GET']); // no PUT/POST
	});

	it('throws when Cloudflare reports failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ success: false, errors: [{ code: 1004 }] }))
		);
		await expect(upsertRexDirectRecord('hh', '4.4.4.4')).rejects.toThrow(/Cloudflare/);
	});

	it('throws when the token is not configured', async () => {
		delete process.env.REXDIRECT_CF_TOKEN;
		await expect(upsertRexDirectRecord('hh', '4.4.4.4')).rejects.toThrow(/REXDIRECT_CF_TOKEN/);
	});
});

function json(body: any) {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
