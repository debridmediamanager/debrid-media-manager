/**
 * The save half of the sponsor-only "other streams" limit: every cast save path
 * that stores a limit above 5 has to record which sponsorship allowed it, or the
 * stream routes cannot tell an active sponsor's 10 from a lapsed one's. A save
 * at 5 or below drops the grant, and a save that leaves the limit alone keeps it.
 */
import adSave from '@/pages/api/stremio-ad/cast/saveProfile';
import adUpdate from '@/pages/api/stremio-ad/cast/updateSizeLimits';
import dlSave from '@/pages/api/stremio-dl/cast/saveProfile';
import dlUpdate from '@/pages/api/stremio-dl/cast/updateSizeLimits';
import ocSave from '@/pages/api/stremio-oc/cast/saveProfile';
import ocUpdate from '@/pages/api/stremio-oc/cast/updateSizeLimits';
import pmSave from '@/pages/api/stremio-pm/cast/saveProfile';
import pmUpdate from '@/pages/api/stremio-pm/cast/updateSizeLimits';
import tbSave from '@/pages/api/stremio-tb/cast/saveProfile';
import tbUpdate from '@/pages/api/stremio-tb/cast/updateSizeLimits';
import rdSave from '@/pages/api/stremio/cast/saveProfile';
import rdUpdate from '@/pages/api/stremio/cast/updateSizeLimits';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeSponsor, TEST_SPONSOR_SHORT_ID } from '@/test/utils/sponsor';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const USER = 'cast-user-1';
const resolved = { valid: true, userId: USER };

vi.mock('@/services/repository');
vi.mock('@/utils/castRdToken', () => ({ castAccessToken: vi.fn(async () => 'rd-token') }));
vi.mock('@/utils/castApiHelpers', () => ({ generateUserId: vi.fn(async () => USER) }));
vi.mock('@/utils/torboxCastApiHelpers', () => ({ resolveTorBoxUser: vi.fn(async () => resolved) }));
vi.mock('@/utils/allDebridCastApiHelpers', () => ({
	resolveAllDebridUser: vi.fn(async () => resolved),
}));
vi.mock('@/utils/premiumizeCastApiHelpers', () => ({
	resolvePremiumizeUser: vi.fn(async () => resolved),
}));
vi.mock('@/utils/offcloudCastApiHelpers', () => ({
	resolveOffcloudUser: vi.fn(async () => resolved),
}));
vi.mock('@/utils/debridLinkCastApiHelpers', () => ({
	resolveDebridLinkUser: vi.fn(async () => resolved),
}));

const rdBody = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };
const paths: { name: string; service: string; handler: NextApiHandler; body: object }[] = [
	{ name: 'stremio/cast/saveProfile', service: 'rd', handler: rdSave, body: rdBody },
	{ name: 'stremio/cast/updateSizeLimits', service: 'rd', handler: rdUpdate, body: rdBody },
	{ name: 'stremio-tb/cast/saveProfile', service: 'tb', handler: tbSave, body: { apiKey: 'k' } },
	{
		name: 'stremio-tb/cast/updateSizeLimits',
		service: 'tb',
		handler: tbUpdate,
		body: { apiKey: 'k' },
	},
	{ name: 'stremio-ad/cast/saveProfile', service: 'ad', handler: adSave, body: { apiKey: 'k' } },
	{
		name: 'stremio-ad/cast/updateSizeLimits by key',
		service: 'ad',
		handler: adUpdate,
		body: { apiKey: 'k' },
	},
	{
		name: 'stremio-ad/cast/updateSizeLimits by cast token',
		service: 'ad',
		handler: adUpdate,
		body: { castToken: USER },
	},
	{ name: 'stremio-pm/cast/saveProfile', service: 'pm', handler: pmSave, body: { apiKey: 'k' } },
	{
		name: 'stremio-pm/cast/updateSizeLimits',
		service: 'pm',
		handler: pmUpdate,
		body: { userId: USER },
	},
	{ name: 'stremio-oc/cast/saveProfile', service: 'oc', handler: ocSave, body: { apiKey: 'k' } },
	{
		name: 'stremio-oc/cast/updateSizeLimits',
		service: 'oc',
		handler: ocUpdate,
		body: { userId: USER },
	},
	{ name: 'stremio-dl/cast/saveProfile', service: 'dl', handler: dlSave, body: { apiKey: 'k' } },
	{
		name: 'stremio-dl/cast/updateSizeLimits',
		service: 'dl',
		handler: dlUpdate,
		body: { userId: USER },
	},
];

const db = vi.mocked(repository) as unknown as Record<string, Mock>;

describe.each(paths)('$name', ({ service, handler, body }) => {
	async function save(settings: object, headers: Record<string, string> = {}) {
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'POST', headers, body: { ...body, ...settings } }),
			res
		);
		return res._getStatusCode();
	}

	beforeEach(() => {
		const profile = {
			userId: USER,
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		};
		for (const name of ['', 'TorBox', 'AllDebrid', 'Premiumize', 'Offcloud', 'DebridLink']) {
			db[`save${name}CastProfile`] = vi.fn().mockResolvedValue(profile);
			db[`update${name}CastSettings`] = vi.fn().mockResolvedValue(true);
		}
		db.setCastSponsorGrant = vi.fn().mockResolvedValue(undefined);
	});

	it('records the sponsorship that saved 10', async () => {
		expect(await save({ otherStreamsLimit: 10 }, { 'x-dmm-sponsor': activeSponsor() })).toBe(
			200
		);
		expect(db.setCastSponsorGrant).toHaveBeenCalledWith(service, USER, TEST_SPONSOR_SHORT_ID);
	});

	it('drops the grant when a sponsor saves 5 or below', async () => {
		expect(await save({ otherStreamsLimit: 3 }, { 'x-dmm-sponsor': activeSponsor() })).toBe(
			200
		);
		expect(db.setCastSponsorGrant).toHaveBeenCalledWith(service, USER, null);
	});

	it('drops the grant when anyone saves 5', async () => {
		expect(await save({ otherStreamsLimit: 5 })).toBe(200);
		expect(db.setCastSponsorGrant).toHaveBeenCalledWith(service, USER, null);
	});

	it('still saves when dropping the grant fails', async () => {
		db.setCastSponsorGrant.mockRejectedValue(new Error('table missing'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await save({ otherStreamsLimit: 5 })).toBe(200);
	});

	it('fails the save when recording a sponsor’s grant fails', async () => {
		db.setCastSponsorGrant.mockRejectedValue(new Error('table missing'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const status = await save({ otherStreamsLimit: 10 }, { 'x-dmm-sponsor': activeSponsor() });
		expect(status).toBe(500);
	});

	it('leaves the grant alone when the save does not touch the limit', async () => {
		expect(await save({ movieMaxSize: 2 })).toBe(200);
		expect(db.setCastSponsorGrant).not.toHaveBeenCalled();
	});
});

const originalSecret = process.env.DMM_SPONSOR_SECRET;
beforeAll(() => {
	process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
});
afterAll(() => {
	if (originalSecret === undefined) delete process.env.DMM_SPONSOR_SECRET;
	else process.env.DMM_SPONSOR_SECRET = originalSecret;
});
