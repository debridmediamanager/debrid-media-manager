import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
	getCastProfile: vi.fn(),
	getTorBoxCastProfile: vi.fn(),
	getAllDebridCastProfile: vi.fn(),
	getPremiumizeCastProfile: vi.fn(),
	getOffcloudCastProfile: vi.fn(),
	getDebridLinkCastProfile: vi.fn(),
	getSponsorByDmmApiKey: vi.fn(),
}));
vi.mock('@/services/repository', () => ({ repository: db }));

import approve from '@/pages/api/kodi/approve';
import pair from '@/pages/api/kodi/pair';
import poll from '@/pages/api/kodi/poll';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

async function call(handler: typeof pair, body?: unknown, method = 'POST', ip = '203.0.113.7') {
	const res = createMockResponse();
	await handler(createMockRequest({ method, body, headers: { 'cf-connecting-ip': ip } }), res);
	const status = vi.mocked(res.status).mock.calls.at(-1)?.[0];
	const json = vi.mocked(res.json).mock.calls.at(-1)?.[0];
	return { status, json };
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.DMM_ORIGIN = 'https://dmm.test';
	Object.values(db).forEach((fn) => fn.mockResolvedValue(null));
});

describe('/api/kodi pairing', () => {
	it('links a Kodi end to end: pair, approve, poll', async () => {
		db.getCastProfile.mockResolvedValue({ userId: 'rdUser123' });
		db.getPremiumizeCastProfile.mockResolvedValue({ userId: 'pmUser123' });
		db.getSponsorByDmmApiKey.mockResolvedValue({ isSponsor: true, githubUsername: 'octo' });

		const started = await call(pair);
		expect(started.status).toBe(200);
		expect(started.json.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(started.json.verifyUrl).toBe(
			`https://dmm.test/kodi?code=${started.json.userCode.replace('-', '')}`
		);
		const { deviceCode } = started.json;

		expect((await call(poll, { deviceCode })).status).toBe(202);

		const approved = await call(approve, {
			userCode: started.json.userCode.toLowerCase(),
			casts: { rd: 'rdUser123', pm: 'pmUser123', tb: 'stale12345' },
			apiKey: 'k'.repeat(64),
		});
		expect(approved.status).toBe(200);
		expect(approved.json).toEqual({
			accounts: [
				{ service: 'rd', name: 'Real-Debrid' },
				{ service: 'pm', name: 'Premiumize' },
			],
			sponsor: true,
		});

		const collected = await call(poll, { deviceCode });
		expect(collected.status).toBe(200);
		expect(collected.json).toEqual({
			status: 'linked',
			accounts: [
				{
					service: 'rd',
					name: 'Real-Debrid',
					addon: 'https://dmm.test/api/stremio/rdUser123',
				},
				{
					service: 'pm',
					name: 'Premiumize',
					addon: 'https://dmm.test/api/stremio-pm/pmUser123',
				},
			],
			sponsor: { apiKey: 'k'.repeat(64), githubUsername: 'octo' },
		});
		expect((await call(poll, { deviceCode })).status).toBe(410);
	});

	it('leaves a lapsed sponsor key out but still links the casts', async () => {
		db.getTorBoxCastProfile.mockResolvedValue({ userId: 'tbUser123' });
		db.getSponsorByDmmApiKey.mockResolvedValue({ isSponsor: false, githubUsername: 'octo' });
		const { json } = await call(pair);
		const approved = await call(approve, {
			userCode: json.userCode,
			casts: { tb: 'tbUser123' },
			apiKey: 'k'.repeat(64),
		});
		expect(approved.json.sponsor).toBe(false);
		expect((await call(poll, { deviceCode: json.deviceCode })).json.sponsor).toBeNull();
	});

	it('refuses to link nothing, a bad code, an unknown code and a reused code', async () => {
		const { json } = await call(pair);
		expect(
			(await call(approve, { userCode: json.userCode, casts: { rd: 'goneUser1' } })).status
		).toBe(400);
		expect((await call(approve, { userCode: 'nope', casts: {} })).status).toBe(400);

		db.getCastProfile.mockResolvedValue({ userId: 'rdUser123' });
		expect(
			(await call(approve, { userCode: 'ABCD-EFGH', casts: { rd: 'rdUser123' } })).status
		).toBe(404);
		expect(
			(await call(approve, { userCode: json.userCode, casts: { rd: 'rdUser123' } })).status
		).toBe(200);
		expect(
			(await call(approve, { userCode: json.userCode, casts: { rd: 'rdUser123' } })).status
		).toBe(409);
	});

	it('asks the browser to confirm a Kodi on another connection before handing anything over', async () => {
		db.getCastProfile.mockResolvedValue({ userId: 'rdUser123' });
		const { json } = await call(pair);
		const body = { userCode: json.userCode, casts: { rd: 'rdUser123' } };
		const refused = await call(approve, body, 'POST', '198.51.100.9');
		expect(refused.status).toBe(428);
		expect(refused.json.otherNetwork).toBe(true);
		expect((await call(poll, { deviceCode: json.deviceCode })).status).toBe(202);
		const confirmed = await call(
			approve,
			{ ...body, confirmOtherNetwork: true },
			'POST',
			'198.51.100.9'
		);
		expect(confirmed.status).toBe(200);
		expect((await call(poll, { deviceCode: json.deviceCode })).status).toBe(200);
	});

	it('only takes POST, and a well-formed device code', async () => {
		expect((await call(pair, undefined, 'GET')).status).toBe(405);
		expect((await call(poll, { deviceCode: 'short' })).status).toBe(400);
		expect((await call(approve, {}, 'GET')).status).toBe(405);
	});
});
