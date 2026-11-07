import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isGlobalIpv6,
	isRfc1918Ipv4,
	rexDirectHostname,
	rexDirectLanHostname,
	upsertRexDirectRecord,
} from './rexDirectDns';

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

	it("builds the LAN name one label under the server's own, inside its wildcard", () => {
		expect(rexDirectLanHostname('abc')).toBe('lan.abc.rex-direct.debridmediamanager.com');
	});

	// A caller picks the LAN record's address: only a private, unroutable one, so the
	// name can never be aimed at someone else's public host.
	it.each([
		'10.0.0.0',
		'10.255.255.255',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.0.0',
		'192.168.88.244',
	])('accepts the RFC 1918 address %s as a LAN IP', (ip) => {
		expect(isRfc1918Ipv4(ip)).toBe(true);
	});

	it.each([
		'9.255.255.255',
		'11.0.0.0',
		'172.15.255.255',
		'172.32.0.0',
		'192.167.255.255',
		'192.169.0.0',
		'203.0.113.7',
		'100.64.0.1',
		'127.0.0.1',
		'169.254.1.1',
		'0.0.0.0',
		'fd00::1',
		'fe80::1',
		'::ffff:192.168.1.1',
		'192.168.1',
		'192.168.1.1.1',
		'192.168.001.1',
		'192.168.1.256',
		' 192.168.1.1',
		'192.168.1.1\n',
		'10.0.0.1/8',
		'0x0a.0.0.1',
		'lan',
		'',
	])('refuses %j as a LAN IP', (ip) => {
		expect(isRfc1918Ipv4(ip)).toBe(false);
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
		await upsertRexDirectRecord('lan.hh.rex-direct.debridmediamanager.com', '9.9.9.9');
		expect(calls[0].url).toContain('name=lan.hh.rex-direct.debridmediamanager.com');
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toMatchObject({
			type: 'A',
			name: 'lan.hh.rex-direct.debridmediamanager.com',
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
		await upsertRexDirectRecord('hh.rex-direct.debridmediamanager.com', '2.2.2.2');
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
		await upsertRexDirectRecord('hh.rex-direct.debridmediamanager.com', '3.3.3.3');
		expect(methods).toEqual(['GET']); // no PUT/POST
	});

	it('throws when Cloudflare reports failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ success: false, errors: [{ code: 1004 }] }))
		);
		await expect(
			upsertRexDirectRecord('hh.rex-direct.debridmediamanager.com', '4.4.4.4')
		).rejects.toThrow(/Cloudflare/);
	});

	it('throws when the token is not configured', async () => {
		delete process.env.REXDIRECT_CF_TOKEN;
		await expect(
			upsertRexDirectRecord('hh.rex-direct.debridmediamanager.com', '4.4.4.4')
		).rejects.toThrow(/REXDIRECT_CF_TOKEN/);
	});
});

function json(body: any) {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('rexDirectDns IPv6', () => {
	beforeEach(() => {
		process.env = { ...OLD, REXDIRECT_CF_TOKEN: 'tok', REXDIRECT_CF_ZONE: 'zone1' };
	});
	afterEach(() => {
		process.env = OLD;
		vi.restoreAllMocks();
	});

	it.each(['2a01:4f8:c012:e7cd::1', '2003:e5:1f00::1', '2600:1f18::5', '3fff::1'])(
		'takes %s as a global IPv6',
		(ip) => expect(isGlobalIpv6(ip)).toBe(true)
	);

	it.each([
		'::1',
		'::',
		'fd00::1',
		'fe80::1',
		'ff02::1',
		'2001:db8::1',
		'2001::1',
		'2001:0:4136:e378::1',
		'2002:c000:204::1',
		'::ffff:203.0.113.7',
		'203.0.113.7',
		'not an ip',
	])('refuses %s as a public IPv6', (ip) => expect(isGlobalIpv6(ip)).toBe(false));

	it('writes an AAAA record when asked for one', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(json({ success: true, result: [] }))
			.mockResolvedValueOnce(json({ success: true, result: {} }));
		await upsertRexDirectRecord('h.rex-direct.debridmediamanager.com', '2a01:4f8::1', 'AAAA');
		const [lookup, write] = fetchMock.mock.calls.slice(-2);
		expect(String(lookup[0])).toContain('type=AAAA');
		expect(JSON.parse(String(write[1]?.body))).toMatchObject({
			type: 'AAAA',
			content: '2a01:4f8::1',
			proxied: false,
		});
	});
});
