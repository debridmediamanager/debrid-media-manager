import handler from '@/pages/api/rex-direct/register';
import { repository } from '@/services/repository';
import { plexServerOwner } from '@/utils/plexServerOwner';
import { issueRexDirectCert } from '@/utils/rexDirectAcme';
import { upsertRexDirectRecord } from '@/utils/rexDirectDns';
import { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/plexServerOwner');
vi.mock('@/utils/rexDirectAcme');
vi.mock('@/utils/rexDirectDns', () => ({
	rexDirectHostname: (hash: string) => `${hash}.rex-direct.debridmediamanager.com`,
	upsertRexDirectRecord: vi.fn(),
}));

const MACHINE = '45d6b93c3f472650d0a3830d5d3415819ec7bfc1';
const DAY = 24 * 3600_000;
const db = vi.mocked(repository);

async function call(headers: Record<string, string>) {
	const req = {
		method: 'POST',
		headers: { 'cf-connecting-ip': '203.0.113.7', ...headers },
		body: { machineIdentifier: MACHINE },
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
	vi.mocked(plexServerOwner).mockResolvedValue({ accountId: '316687974' });
	db.rexDirectExists.mockResolvedValue(true);
	db.rexDirectCountByPlexAccount.mockResolvedValue(1);
	db.rexDirectGetOrAssignHash.mockResolvedValue({ hash: 'h1', created: false });
	db.rexDirectLastIp.mockResolvedValue('203.0.113.7');
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
