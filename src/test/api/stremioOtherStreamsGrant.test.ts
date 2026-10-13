/**
 * An "other streams" limit above 5 is a sponsor perk, and it ends with the
 * sponsorship.
 *
 * Stremio calls the stream routes with nothing but the userid, so they used to
 * trust whatever the profile stored and only clamp it to 10: a sponsor who saved
 * 10 kept 10 after their pledge ended (47 profiles stored more than 5 when this
 * was found). A save above 5 now records which sponsorship allowed it, and each
 * of the six routes re-reads that sponsorship before serving more than 5.
 */
import adHandler from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import dlHandler from '@/pages/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]';
import ocHandler from '@/pages/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]';
import pmHandler from '@/pages/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]';
import tbHandler from '@/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]';
import rdHandler from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTroveCandidates } from '@/utils/cachedTroveStreams';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/services/premiumize');
vi.mock('@/services/offcloud');
vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: vi.fn() }));

const providers: { service: string; name: string; handler: NextApiHandler }[] = [
	{ service: 'rd', name: '', handler: rdHandler },
	{ service: 'tb', name: 'TorBox', handler: tbHandler },
	{ service: 'ad', name: 'AllDebrid', handler: adHandler },
	{ service: 'pm', name: 'Premiumize', handler: pmHandler },
	{ service: 'oc', name: 'Offcloud', handler: ocHandler },
	{ service: 'dl', name: 'DebridLink', handler: dlHandler },
];

const USER = 'viewer-cast-user-id';
const SHORT_ID = 'ZP1M';

const db = vi.mocked(repository) as unknown as Record<string, Mock>;

const sponsorRow = (isSponsor: boolean, keyVersion = 1) => ({
	isSponsor,
	sources: isSponsor ? ['github'] : [],
	shortId: SHORT_ID,
	githubUsername: 'someone',
	keyVersion,
});

describe.each(providers)('$service stream route: other streams limit', (provider) => {
	const otherStreams = () => db[`get${provider.name}OtherStreams`];

	/** Serves one stream list and returns its status and the limit the pool was asked for. */
	async function serve(stored: number) {
		db[`get${provider.name}CastProfile`] = vi.fn().mockResolvedValue({
			userId: USER,
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: stored,
			hideCastOption: false,
		});
		const res = createMockResponse();
		await provider.handler(
			createMockRequest({
				query: { userid: USER, mediaType: 'movie', imdbid: 'tt0111161.json' },
			}),
			res
		);
		return { status: res._getStatusCode(), limit: otherStreams().mock.calls[0]?.[2] };
	}

	beforeEach(() => {
		db[`get${provider.name}UserCastStreams`] = vi.fn().mockResolvedValue([]);
		db[`get${provider.name}OtherStreams`] = vi.fn().mockResolvedValue([]);
		db.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		db.getCastSponsorGrant = vi.fn().mockResolvedValue(SHORT_ID);
		db.getSponsorByShortId = vi.fn().mockResolvedValue(sponsorRow(true));
		vi.mocked(getTroveCandidates).mockResolvedValue([]);
	});

	it('drops a lapsed sponsor’s stored 10 to 5', async () => {
		db.getSponsorByShortId.mockResolvedValue(sponsorRow(false));
		expect(await serve(10)).toEqual({ status: 200, limit: 5 });
	});

	it('keeps 10 while the sponsorship that granted it is active', async () => {
		expect(await serve(10)).toEqual({ status: 200, limit: 10 });
		expect(db.getCastSponsorGrant).toHaveBeenCalledWith(provider.service, USER);
		expect(db.getSponsorByShortId).toHaveBeenCalledWith(SHORT_ID);
	});

	// A key reset revokes tokens, not the sponsorship behind them.
	it('ignores the key version', async () => {
		db.getSponsorByShortId.mockResolvedValue(sponsorRow(true, 7));
		expect(await serve(10)).toEqual({ status: 200, limit: 10 });
	});

	it('still clamps an active sponsor to 10', async () => {
		expect(await serve(99)).toEqual({ status: 200, limit: 10 });
	});

	// Every profile saved before grants existed: the accepted outcome is 5
	// until a sponsor saves the limit again.
	it('drops a stored 10 with no grant to 5', async () => {
		db.getCastSponsorGrant.mockResolvedValue(null);
		expect(await serve(10)).toEqual({ status: 200, limit: 5 });
		expect(db.getSponsorByShortId).not.toHaveBeenCalled();
	});

	it.each([0, 3, 5])('looks nothing up for a stored %i', async (stored) => {
		expect(await serve(stored)).toEqual({ status: 200, limit: stored });
		expect(db.getCastSponsorGrant).not.toHaveBeenCalled();
		expect(db.getSponsorByShortId).not.toHaveBeenCalled();
	});

	it('answers 5 rather than failing the list when the sponsor lookup throws', async () => {
		db.getSponsorByShortId.mockRejectedValue(new Error('db down'));
		expect(await serve(10)).toEqual({ status: 200, limit: 5 });
	});

	it('answers 5 rather than failing the list when the grant lookup throws', async () => {
		db.getCastSponsorGrant.mockRejectedValue(new Error('db down'));
		expect(await serve(10)).toEqual({ status: 200, limit: 5 });
	});
});

const originalOrigin = process.env.DMM_ORIGIN;
beforeAll(() => {
	process.env.DMM_ORIGIN = 'https://dmm.test';
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
	if (originalOrigin === undefined) delete process.env.DMM_ORIGIN;
	else process.env.DMM_ORIGIN = originalOrigin;
	vi.restoreAllMocks();
});
