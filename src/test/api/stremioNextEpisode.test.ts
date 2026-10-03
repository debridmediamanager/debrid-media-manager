/**
 * Stremio's "Auto play next episode", driven against every DMM Cast stream route.
 *
 * When an episode starts, stremio-core asks the *same addon* for the next
 * episode's streams and keeps the first one whose `behaviorHints.bingeGroup`
 * equals the playing stream's (`next_stream_update` in `src/models/player.rs`,
 * `Stream::is_binge_match` in `src/types/resource/stream.rs`: both present and
 * byte-equal). With no match, stremio-web's `onEnded` falls back to the next
 * episode's `metaDetailsStreams` deep link, the stream list, which is the
 * "takes me back to choose another link" in debrid-media-manager#177.
 *
 * Each fixture is what DMM really offered for two consecutive episodes whose
 * lists share a release, recorded from dmmdb on 2026-10-03.
 */
import adHandler from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import dlHandler from '@/pages/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]';
import ocHandler from '@/pages/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]';
import pmHandler from '@/pages/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]';
import tbHandler from '@/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]';
import rdHandler from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { checkOffcloudCache } from '@/services/offcloud';
import { checkPremiumizeCache } from '@/services/premiumize';
import { repository } from '@/services/repository';
import adFixture from '@/test/fixtures/stremioNextEpisode/ad.json';
import dlFixture from '@/test/fixtures/stremioNextEpisode/dl.json';
import ocFixture from '@/test/fixtures/stremioNextEpisode/oc.json';
import pmFixture from '@/test/fixtures/stremioNextEpisode/pm.json';
import rdFixture from '@/test/fixtures/stremioNextEpisode/rd.json';
import tbFixture from '@/test/fixtures/stremioNextEpisode/tb.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTroveCandidates } from '@/utils/cachedTroveStreams';
import type { NextApiHandler } from 'next';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/services/premiumize');
vi.mock('@/services/offcloud');
vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (h: unknown) => h,
}));

const mockRepository = vi.mocked(repository) as unknown as Record<string, unknown>;

type Row = {
	hash: string;
	filename: string;
	link?: string;
	path?: string | null;
	torrentId?: number | null;
	fileId?: number | null;
	magnetId?: number | null;
	fileIndex?: number | null;
};
type Fixture = { provider: string; episodes: { id: string; otherStreams: Row[] }[] };
type Stream = { url?: string; externalUrl?: string; behaviorHints?: { bingeGroup?: string } };

const VIEWER = 'viewer000001';

interface Provider {
	name: string;
	handler: NextApiHandler;
	fixture: Fixture;
	profile: string;
	userCasts: string;
	others: string;
	/** Whether a stream's play URL points at this row. */
	plays: (url: string, row: Row) => boolean;
}

const providers: Provider[] = [
	{
		name: 'Real-Debrid',
		handler: rdHandler,
		fixture: rdFixture as Fixture,
		profile: 'getCastProfile',
		userCasts: 'getUserCastStreams',
		others: 'getOtherStreams',
		plays: (url, row) => url.endsWith(`/play/${row.link!.substring(26)}`),
	},
	{
		name: 'TorBox',
		handler: tbHandler,
		fixture: tbFixture as Fixture,
		profile: 'getTorBoxCastProfile',
		userCasts: 'getTorBoxUserCastStreams',
		others: 'getTorBoxOtherStreams',
		plays: (url, row) => url.includes(`/play/${row.torrentId}:${row.fileId}?h=${row.hash}&`),
	},
	{
		name: 'AllDebrid',
		handler: adHandler,
		fixture: adFixture as Fixture,
		profile: 'getAllDebridCastProfile',
		userCasts: 'getAllDebridUserCastStreams',
		others: 'getAllDebridOtherStreams',
		plays: (url, row) => url.endsWith(`/play/${row.magnetId}:${row.fileIndex}`),
	},
	{
		name: 'Premiumize',
		handler: pmHandler,
		fixture: pmFixture as Fixture,
		profile: 'getPremiumizeCastProfile',
		userCasts: 'getPremiumizeUserCastStreams',
		others: 'getPremiumizeOtherStreams',
		plays: (url, row) =>
			url.endsWith(`/play/${row.hash}?file=${encodeURIComponent(row.path ?? row.filename)}`),
	},
	{
		name: 'Offcloud',
		handler: ocHandler,
		fixture: ocFixture as Fixture,
		profile: 'getOffcloudCastProfile',
		userCasts: 'getOffcloudUserCastStreams',
		others: 'getOffcloudOtherStreams',
		plays: (url, row) =>
			url.endsWith(`/play/${row.hash}?file=${encodeURIComponent(row.path ?? row.filename)}`),
	},
	{
		name: 'Debrid-Link',
		handler: dlHandler,
		fixture: dlFixture as Fixture,
		profile: 'getDebridLinkCastProfile',
		userCasts: 'getDebridLinkUserCastStreams',
		others: 'getDebridLinkOtherStreams',
		plays: (url, row) =>
			url.endsWith(`/play/${row.hash}?file=${encodeURIComponent(row.path ?? row.filename)}`),
	},
];

/** stremio-core's `next_stream_update`: the first next-episode stream that is a binge match. */
const nextStreamFor = (playing: Stream, nextEpisode: Stream[]) => {
	const group = playing.behaviorHints?.bingeGroup;
	if (group === undefined) return undefined;
	return nextEpisode.find((stream) => stream.behaviorHints?.bingeGroup === group);
};

async function streamsFor(provider: Provider, videoId: string): Promise<Stream[]> {
	const res = createMockResponse();
	await provider.handler(
		createMockRequest({
			query: { userid: VIEWER, mediaType: 'series', imdbid: `${videoId}.json` },
		}),
		res
	);
	expect(res._getStatusCode()).toBe(200);
	return (res._getData() as { streams: Stream[] }).streams;
}

const rowOf = (provider: Provider, stream: Stream, rows: Row[]) =>
	rows.find((row) => stream.url !== undefined && provider.plays(stream.url, row));

/**
 * Plays every stream of the first episode to its end and checks what Stremio
 * picks for the second: the same release when the second episode offers it,
 * and nothing (the stream list) when it does not - never some other release.
 */
async function expectBingeContinuesTheRelease(
	provider: Provider,
	rowsByEpisode: Map<string, { own: Row[]; other: Row[] }>
) {
	const [first, second] = provider.fixture.episodes.map((e) => e.id);
	mockRepository[provider.userCasts] = vi.fn(async (id: string) => rowsByEpisode.get(id)!.own);
	mockRepository[provider.others] = vi.fn(async (id: string) => rowsByEpisode.get(id)!.other);

	const now = await streamsFor(provider, first);
	const next = await streamsFor(provider, second);
	const nowRows = [...rowsByEpisode.get(first)!.own, ...rowsByEpisode.get(first)!.other];
	const nextRows = [...rowsByEpisode.get(second)!.own, ...rowsByEpisode.get(second)!.other];
	const offeredNext = new Set(
		next.flatMap((s) => rowOf(provider, s, nextRows)?.hash.toLowerCase() ?? [])
	);

	const played = now.filter((s) => s.url);
	expect(played.length).toBeGreaterThan(0);
	let continued = 0;
	for (const stream of played) {
		const row = rowOf(provider, stream, nowRows);
		expect(row, `no fixture row behind ${stream.url}`).toBeDefined();
		const picked = nextStreamFor(stream, next);
		const label = `${provider.name} ${first} ${row!.filename}`;
		if (offeredNext.has(row!.hash.toLowerCase())) {
			expect(picked, `${label} should continue into ${second}`).toBeDefined();
			expect(picked!.url, `${label} jumped to another release`).toBeDefined();
			expect(rowOf(provider, picked!, nextRows)?.hash.toLowerCase()).toBe(
				row!.hash.toLowerCase()
			);
			continued++;
		} else {
			expect(picked, `${label} is not in ${second}; Stremio must show the list`).toBe(
				undefined
			);
		}
	}
	// The recordings were chosen because the two episodes share a release.
	expect(continued).toBeGreaterThan(0);
}

describe('Stremio autoplays the next episode from DMM Cast', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		const profile = {
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		};
		for (const provider of providers) {
			mockRepository[provider.profile] = vi.fn().mockResolvedValue(profile);
		}
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		vi.mocked(getTroveCandidates).mockResolvedValue([]);
		const allCached = async (_key: string, hashes: string[]) =>
			hashes.map((hash) => ({ hash, cached: true }));
		vi.mocked(checkPremiumizeCache).mockImplementation(allCached as never);
		vi.mocked(checkOffcloudCache).mockImplementation(allCached as never);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	describe.each(providers)('$name', (provider) => {
		it('continues a release offered from the other-casts pool', async () => {
			const rows = new Map(
				provider.fixture.episodes.map((e) => [e.id, { own: [], other: e.otherStreams }])
			);
			await expectBingeContinuesTheRelease(provider, rows);
		});

		// The reporters cast whole seasons: one cast row per episode, all under
		// the pack's hash.
		it('continues the viewer’s own whole-season cast', async () => {
			const rows = new Map(
				provider.fixture.episodes.map((e) => [e.id, { own: e.otherStreams, other: [] }])
			);
			await expectBingeContinuesTheRelease(provider, rows);
		});
	});

	// A viewer who cast only the episode they started still continues with the
	// same pack when the next episode is in the shared pool.
	it('continues from the viewer’s cast into the pool’s copy of the same pack', async () => {
		const provider = providers[0];
		const [first, second] = provider.fixture.episodes;
		const rows = new Map([
			[first.id, { own: first.otherStreams, other: [] }],
			[second.id, { own: [], other: second.otherStreams }],
		]);
		await expectBingeContinuesTheRelease(provider, rows);
	});
});
