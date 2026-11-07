import handler from '@/pages/api/rex-direct/register';
import { repository } from '@/services/repository';
import { plexServerOwner } from '@/utils/plexServerOwner';
import { issueRexDirectCert } from '@/utils/rexDirectAcme';
import { removeRexDirectRecords, upsertRexDirectRecord } from '@/utils/rexDirectDns';
import { answersAsMachine } from '@/utils/rexDirectReach';
import { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/plexServerOwner');
vi.mock('@/utils/rexDirectAcme', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/rexDirectAcme')>()),
	issueRexDirectCert: vi.fn(),
}));
vi.mock('@/utils/rexDirectDns', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/rexDirectDns')>()),
	upsertRexDirectRecord: vi.fn(),
	removeRexDirectRecords: vi.fn(),
}));
vi.mock('@/utils/rexDirectReach');

const MACHINE = '45d6b93c3f472650d0a3830d5d3415819ec7bfc1';
const DAY = 24 * 3600_000;
const db = vi.mocked(repository);
// SAN-only fullchains (leaf, then CA) for h1's name, as ZeroSSL issues them: one from
// before LAN names, and one that also covers `*.h1.rex-direct…`.
const fixture = (name: string) =>
	readFileSync(path.join(process.cwd(), 'src/test/fixtures/rexDirect', name), 'utf8');
const SINGLE_NAME_CERT = fixture('single-name-fullchain.crt');
const WILDCARD_CERT = fixture('wildcard-fullchain.crt');

async function call(headers: Record<string, string>, body: Record<string, unknown> = {}) {
	const req = {
		method: 'POST',
		headers: { 'cf-connecting-ip': '203.0.113.7', ...headers },
		body: { machineIdentifier: MACHINE, ...body },
	} as unknown as NextApiRequest;
	const res: any = { headers: {} as Record<string, string> };
	res.status = vi.fn((code: number) => ((res.code = code), res));
	res.json = vi.fn((body: unknown) => ((res.body = body), res));
	res.setHeader = vi.fn((name: string, value: string) => (res.headers[name] = value));
	await handler(req, res as NextApiResponse);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('REXDIRECT_CF_TOKEN', 'tok');
	vi.stubEnv('REXDIRECT_CF_ZONE', 'zone1');
	vi.stubEnv('REXDIRECT_BASE', 'rex-direct.debridmediamanager.com');
	vi.mocked(plexServerOwner).mockResolvedValue({ accountId: '316687974' });
	db.rexDirectExists.mockResolvedValue(true);
	db.rexDirectCountByPlexAccount.mockResolvedValue(1);
	db.rexDirectGetOrAssignHash.mockResolvedValue({ hash: 'h1', created: false });
	db.rexDirectLastIp.mockResolvedValue('203.0.113.7');
	db.rexDirectLastLanIp.mockResolvedValue(null);
	db.rexDirectStartIssuing.mockResolvedValue(true);
	db.rexDirectServerCert.mockResolvedValue(null);
	db.rexDirectStoreServerCert.mockResolvedValue(undefined);
	db.rexDirectBackOffIssuing.mockResolvedValue(undefined);
	vi.mocked(issueRexDirectCert).mockResolvedValue({
		certificate: 'CERT',
		privateKey: 'KEY',
		expiresAt: new Date(Date.now() + 90 * DAY),
	});
});

describe('rex-direct register, open to claimed servers', () => {
	it('refuses a caller with neither a Plex token nor a key', async () => {
		const res = await call({});
		expect(res.code).toBe(401);
		expect(upsertRexDirectRecord).not.toHaveBeenCalled();
	});

	it('passes on plex.tv refusing the claim', async () => {
		vi.mocked(plexServerOwner).mockResolvedValue({ status: 403, error: 'not owned' });
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(403);
		expect(db.rexDirectGetOrAssignHash).not.toHaveBeenCalled();
	});

	it('answers 202 and orders a certificate of its own on first sight, never the wildcard', async () => {
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(202);
		expect(res.body).toMatchObject({
			hostname: 'h1.rex-direct.debridmediamanager.com',
			retryAfter: 60,
		});
		expect(res.body.privateKey).toBeUndefined();
		expect(db.rexDirectGetCert).not.toHaveBeenCalled();
		expect(db.rexDirectGetOrAssignHash).toHaveBeenCalledWith(MACHINE, {
			plexAccountId: '316687974',
		});
		expect(issueRexDirectCert).toHaveBeenCalledWith('h1.rex-direct.debridmediamanager.com');
		await vi.waitFor(() =>
			expect(db.rexDirectStoreServerCert).toHaveBeenCalledWith(
				MACHINE,
				'CERT',
				'KEY',
				expect.any(Date)
			)
		);
	});

	it('points the public name at the source IP only when it changed', async () => {
		db.rexDirectLastIp.mockResolvedValue('198.51.100.1');
		await call({ 'x-plex-token': 'tok' });
		expect(upsertRexDirectRecord).toHaveBeenCalledTimes(1);
		expect(upsertRexDirectRecord).toHaveBeenCalledWith(
			'h1.rex-direct.debridmediamanager.com',
			'203.0.113.7'
		);
		expect(db.rexDirectRecordIp).toHaveBeenCalledWith(MACHINE, '203.0.113.7');
	});

	it('starts no second order while one is running', async () => {
		db.rexDirectStartIssuing.mockResolvedValue(false);
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(202);
		expect(issueRexDirectCert).not.toHaveBeenCalled();
	});

	it('answers the server its own stored certificate', async () => {
		db.rexDirectServerCert.mockResolvedValue({
			certificate: 'OWN',
			privateKey: 'OWNKEY',
			expiresAt: new Date(Date.now() + 80 * DAY),
		});
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(200);
		expect(res.body).toMatchObject({
			certificate: 'OWN',
			privateKey: 'OWNKEY',
			ip: '203.0.113.7',
		});
		expect(issueRexDirectCert).not.toHaveBeenCalled();
	});

	it('renews in the background a certificate within 30 days of expiry, still answering it', async () => {
		db.rexDirectServerCert.mockResolvedValue({
			certificate: 'OWN',
			privateKey: 'OWNKEY',
			expiresAt: new Date(Date.now() + 10 * DAY),
		});
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(200);
		expect(issueRexDirectCert).toHaveBeenCalledTimes(1);
	});

	it('backs off after a failed order instead of starting another on the next call', async () => {
		vi.mocked(issueRexDirectCert).mockRejectedValue(new Error('ACME said no'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await call({ 'x-plex-token': 'tok' });
		await vi.waitFor(() => expect(db.rexDirectBackOffIssuing).toHaveBeenCalledWith(MACHINE));
	});

	it('caps the names one Plex account holds', async () => {
		db.rexDirectExists.mockResolvedValue(false);
		db.rexDirectCountByPlexAccount.mockResolvedValue(10);
		const res = await call({ 'x-plex-token': 'tok' });
		expect(res.code).toBe(429);
		expect(db.rexDirectGetOrAssignHash).not.toHaveBeenCalled();
	});

	it('still answers rex builds that send the sponsor key the wildcard', async () => {
		db.getSponsorByDmmApiKey.mockResolvedValue({ isSponsor: true, shortId: 'ZP1M' } as any);
		db.rexDirectGetCert.mockResolvedValue({ fullchain: 'WILD', privkey: 'WILDKEY' });
		const res = await call({ 'x-api-key': 'k' });
		expect(res.code).toBe(200);
		expect(res.body).toMatchObject({ certificate: 'WILD', privateKey: 'WILDKEY' });
		expect(db.rexDirectGetOrAssignHash).toHaveBeenCalledWith(MACHINE, { shortId: 'ZP1M' });
		expect(issueRexDirectCert).not.toHaveBeenCalled();
	});
});

describe('rex-direct register, LAN name', () => {
	const LAN = { lanIp: '192.168.88.244' };
	const stored = (certificate: string) =>
		db.rexDirectServerCert.mockResolvedValue({
			certificate,
			privateKey: 'OWNKEY',
			expiresAt: new Date(Date.now() + 80 * DAY),
		});

	it.each(['203.0.113.8', 'fd00::1', 'lan'])(
		'refuses lanIp %s before touching anything',
		async (lanIp) => {
			const res = await call({ 'x-plex-token': 'tok' }, { lanIp });
			expect(res.code).toBe(400);
			expect(res.body).toEqual({ error: 'Invalid lanIp' });
			expect(db.rexDirectGetOrAssignHash).not.toHaveBeenCalled();
			expect(upsertRexDirectRecord).not.toHaveBeenCalled();
		}
	);

	// Every rex before LAN names: the answer is today's, key for key, and a stored
	// certificate is never read (this one is not even a PEM).
	it.each([{}, { lanIp: '' }, { lanIp: 192168 }, { lanIp: null }])(
		'answers exactly as before with %j',
		async (body) => {
			stored('OWN');
			const res = await call({ 'x-plex-token': 'tok' }, body);
			expect(res.code).toBe(200);
			expect(JSON.stringify(res.body)).toBe(
				JSON.stringify({
					hostname: 'h1.rex-direct.debridmediamanager.com',
					hash: 'h1',
					ip: '203.0.113.7',
					certificate: 'OWN',
					privateKey: 'OWNKEY',
				})
			);
			expect(db.rexDirectLastLanIp).not.toHaveBeenCalled();
			expect(upsertRexDirectRecord).not.toHaveBeenCalled();
			expect(issueRexDirectCert).not.toHaveBeenCalled();
		}
	);

	it('points the LAN name at lanIp and returns it with a certificate that covers it', async () => {
		stored(WILDCARD_CERT);
		const res = await call({ 'x-plex-token': 'tok' }, LAN);
		expect(res.code).toBe(200);
		expect(res.body).toStrictEqual({
			hostname: 'h1.rex-direct.debridmediamanager.com',
			hash: 'h1',
			ip: '203.0.113.7',
			lanHostname: 'lan.h1.rex-direct.debridmediamanager.com',
			lanIp: '192.168.88.244',
			certificate: WILDCARD_CERT,
			privateKey: 'OWNKEY',
		});
		expect(upsertRexDirectRecord).toHaveBeenCalledTimes(1);
		expect(upsertRexDirectRecord).toHaveBeenCalledWith(
			'lan.h1.rex-direct.debridmediamanager.com',
			'192.168.88.244'
		);
		expect(db.rexDirectRecordLanIp).toHaveBeenCalledWith(MACHINE, '192.168.88.244');
		expect(issueRexDirectCert).not.toHaveBeenCalled();
	});

	it('writes no LAN record when lanIp is unchanged', async () => {
		stored(WILDCARD_CERT);
		db.rexDirectLastLanIp.mockResolvedValue('192.168.88.244');
		const res = await call({ 'x-plex-token': 'tok' }, LAN);
		expect(res.body.lanHostname).toBe('lan.h1.rex-direct.debridmediamanager.com');
		expect(upsertRexDirectRecord).not.toHaveBeenCalled();
		expect(db.rexDirectRecordLanIp).not.toHaveBeenCalled();
	});

	it('answers 202 for a certificate from before LAN names, reordering it once with the wildcard', async () => {
		stored(SINGLE_NAME_CERT);
		const res = await call({ 'x-plex-token': 'tok' }, LAN);
		// rex keeps serving what it kept and asks again in a minute; a 200 without the
		// LAN name would have it wait for its next 6-hourly call.
		expect(res.code).toBe(202);
		expect(res.body.retryAfter).toBe(60);
		expect(res.body).not.toHaveProperty('certificate');
		expect(res.body).not.toHaveProperty('lanHostname');
		expect(res.body).not.toHaveProperty('lanIp');
		expect(upsertRexDirectRecord).toHaveBeenCalledWith(
			'lan.h1.rex-direct.debridmediamanager.com',
			'192.168.88.244'
		);
		expect(issueRexDirectCert).toHaveBeenCalledWith('h1.rex-direct.debridmediamanager.com');
		await vi.waitFor(() => expect(db.rexDirectStoreServerCert).toHaveBeenCalled());

		// The order holds the right to issue: the next heartbeat starts none.
		db.rexDirectStartIssuing.mockResolvedValue(false);
		await call({ 'x-plex-token': 'tok' }, LAN);
		expect(issueRexDirectCert).toHaveBeenCalledTimes(1);
	});

	it('still answers 202 while a server has no certificate at all', async () => {
		const res = await call({ 'x-plex-token': 'tok' }, LAN);
		expect(res.code).toBe(202);
		expect(res.body).not.toHaveProperty('lanHostname');
		expect(issueRexDirectCert).toHaveBeenCalledTimes(1);
	});

	it('ignores lanIp on the sponsor-key path', async () => {
		db.getSponsorByDmmApiKey.mockResolvedValue({ isSponsor: true, shortId: 'ZP1M' } as any);
		db.rexDirectGetCert.mockResolvedValue({ fullchain: 'WILD', privkey: 'WILDKEY' });
		const res = await call({ 'x-api-key': 'k' }, { lanIp: 'not an ip' });
		expect(res.code).toBe(200);
		expect(res.body).not.toHaveProperty('lanHostname');
		expect(res.body).not.toHaveProperty('lanIp');
		expect(db.rexDirectLastLanIp).not.toHaveBeenCalled();
		expect(upsertRexDirectRecord).not.toHaveBeenCalled();
	});
});

describe('rex-direct register, IPv6 for connections without a public IPv4', () => {
	const V6 = '2a01:4f8:c012:e7cd::1';
	const NAME = 'h1.rex-direct.debridmediamanager.com';
	beforeEach(() => {
		db.rexDirectServerCert.mockResolvedValue({
			certificate: 'OWN',
			privateKey: 'OWNKEY',
			expiresAt: new Date(Date.now() + 80 * DAY),
		});
	});

	it('writes the AAAA when the server answers as itself at that address and port', async () => {
		vi.mocked(answersAsMachine).mockResolvedValue(true);
		const res = await call({ 'x-plex-token': 'tok' }, { publicIpv6: V6, port: 32400 });
		expect(answersAsMachine).toHaveBeenCalledWith(V6, 32400, MACHINE);
		expect(upsertRexDirectRecord).toHaveBeenCalledWith(NAME, V6, 'AAAA');
		expect(removeRexDirectRecords).not.toHaveBeenCalled();
		expect(res.code).toBe(200);
		expect(res.body.ipv6).toBe(V6);
	});

	it('drops the AAAA when the address does not reach the server', async () => {
		vi.mocked(answersAsMachine).mockResolvedValue(false);
		const res = await call({ 'x-plex-token': 'tok' }, { publicIpv6: V6, port: 32400 });
		expect(upsertRexDirectRecord).not.toHaveBeenCalledWith(NAME, V6, 'AAAA');
		expect(removeRexDirectRecords).toHaveBeenCalledWith(NAME, 'AAAA');
		expect(res.body.ipv6).toBeUndefined();
	});

	it('drops the AAAA when the server no longer has an IPv6', async () => {
		await call({ 'x-plex-token': 'tok' }, { publicIpv6: '', port: 32400 });
		expect(answersAsMachine).not.toHaveBeenCalled();
		expect(removeRexDirectRecords).toHaveBeenCalledWith(NAME, 'AAAA');
	});

	it.each(['::1', 'fd00::1', 'fe80::1', '2001:db8::1', '2002:c000:204::1', '203.0.113.7'])(
		'never connects back to %s, which is not a global IPv6',
		async (address) => {
			await call({ 'x-plex-token': 'tok' }, { publicIpv6: address, port: 32400 });
			expect(answersAsMachine).not.toHaveBeenCalled();
			expect(removeRexDirectRecords).toHaveBeenCalledWith(NAME, 'AAAA');
		}
	);

	it('needs a port to check', async () => {
		await call({ 'x-plex-token': 'tok' }, { publicIpv6: V6 });
		expect(answersAsMachine).not.toHaveBeenCalled();
	});

	it('leaves the AAAA alone for a server that sends no publicIpv6 key', async () => {
		await call({ 'x-plex-token': 'tok' });
		expect(answersAsMachine).not.toHaveBeenCalled();
		expect(removeRexDirectRecords).not.toHaveBeenCalled();
	});

	it('gives the sponsor-key path no AAAA', async () => {
		db.getSponsorByDmmApiKey.mockResolvedValue({ shortId: 'S1', isSponsor: true } as any);
		db.rexDirectGetCert.mockResolvedValue({ fullchain: 'W', privkey: 'WK' } as any);
		await call({ 'x-api-key': 'k' }, { publicIpv6: V6, port: 32400 });
		expect(answersAsMachine).not.toHaveBeenCalled();
		expect(removeRexDirectRecords).not.toHaveBeenCalled();
	});
});
