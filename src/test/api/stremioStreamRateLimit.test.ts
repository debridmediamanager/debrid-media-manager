/**
 * The DMM Cast stream routes' one-request-per-5-seconds budget, replayed from
 * dmm-01's access log.
 *
 * When an episode starts playing, Stremio asks the same addon for the next
 * episode's streams so it can autoplay into it. The budget was keyed on the
 * userid alone, so a viewer who pressed play within five seconds of opening the
 * list had that prefetch refused with a 429, and autoplay with it. It is now
 * keyed on the userid and the requested item: asking for another episode is
 * not blocked, asking for the same one again inside the window still is, and
 * that holds however the item id is spelled.
 *
 * The Premiumize, Offcloud and Debrid-Link routes wrap the same limiter but
 * never matched its stream paths, so they fell through to the 5-per-second
 * default keyed on the client address. They are on the stream budget now too.
 *
 * Each sequence is recorded traffic, anonymised, replayed at its recorded
 * seconds through the six routes as they are exported, with the real limiter
 * (its in-memory backend, since the test has no Redis).
 */
import adHandler from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import dlHandler from '@/pages/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]';
import ocHandler from '@/pages/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]';
import pmHandler from '@/pages/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]';
import tbHandler from '@/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]';
import rdHandler from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import fixture from '@/test/fixtures/stremioStreamRateLimit/npm-access-log.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { castStreamRequest, parseNpmAccessLine } from '@/test/utils/npmAccessLog';
import { getTroveCandidates } from '@/utils/cachedTroveStreams';
import type { NextApiHandler } from 'next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/rateLimit/withRateLimit');
vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/services/premiumize');
vi.mock('@/services/offcloud');
vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: vi.fn() }));

const routes: Record<string, NextApiHandler> = {
	stremio: rdHandler,
	'stremio-tb': tbHandler,
	'stremio-ad': adHandler,
	'stremio-pm': pmHandler,
	'stremio-oc': ocHandler,
	'stremio-dl': dlHandler,
};

// What each route reads: the viewer's profile, then their casts and the pool's.
const repositoryReads = ['', 'TorBox', 'AllDebrid', 'Premiumize', 'Offcloud', 'DebridLink'].map(
	(name) => ({
		profile: `get${name}CastProfile`,
		streams: [`get${name}UserCastStreams`, `get${name}OtherStreams`],
	})
);

type Outcome = 'served' | 'refused';
type Sequence = { name: string; provider: string; expect: Outcome[]; lines: string[] };
const sequences = fixture.sequences as Sequence[];

/**
 * Sends every stream request of a sequence to its route at the second it was
 * recorded, the way Next.js would hand it over: the raw path in `url`, the
 * decoded segments in `query`.
 */
async function replay(sequence: Sequence): Promise<string[]> {
	const outcomes: string[] = [];
	for (const line of sequence.lines) {
		const logged = parseNpmAccessLine(line);
		const stream = castStreamRequest(logged.path);
		// The play requests between them are context; that route has no limit.
		if (!stream) continue;

		vi.setSystemTime(logged.at);
		const res = createMockResponse();
		await routes[stream.route](
			createMockRequest({
				url: logged.path,
				query: {
					userid: decodeURIComponent(stream.userid),
					mediaType: decodeURIComponent(stream.mediaType),
					imdbid: decodeURIComponent(stream.item),
				},
				headers: { 'cf-connecting-ip': logged.clientIp },
			}),
			res
		);
		const status = res._getStatusCode();
		outcomes.push(status === 429 ? 'refused' : status === 200 ? 'served' : `status ${status}`);
	}
	return outcomes;
}

describe('DMM Cast stream budget, replayed from the access log', () => {
	const originalRedis = process.env.REDIS_URL;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeAll(() => {
		delete process.env.REDIS_URL;
		process.env.DMM_ORIGIN = 'https://dmm.test';
		// The limiter warns on every check that it has no Redis.
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		const restore = (name: string, value: string | undefined) => {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		};
		restore('REDIS_URL', originalRedis);
		restore('DMM_ORIGIN', originalOrigin);
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const db = vi.mocked(repository) as unknown as Record<string, unknown>;
		const profile = {
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		};
		for (const reads of repositoryReads) {
			db[reads.profile] = vi.fn().mockResolvedValue(profile);
			for (const name of reads.streams) db[name] = vi.fn().mockResolvedValue([]);
		}
		db.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		vi.mocked(getTroveCandidates).mockResolvedValue([]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('covers every provider route that wraps the stream limiter', () => {
		const covered = new Set(
			sequences.flatMap((s) =>
				s.lines.flatMap((l) => castStreamRequest(parseNpmAccessLine(l).path)?.route ?? [])
			)
		);
		expect([...covered].sort()).toEqual(Object.keys(routes).sort());
	});

	it.each(sequences.map((s) => [s.name, s] as const))('%s', async (_name, sequence) => {
		expect(await replay(sequence)).toEqual(sequence.expect);
	});
});
