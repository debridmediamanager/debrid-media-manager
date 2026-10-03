/**
 * The RD Cast stream list must not offer a play URL for a row that has no
 * Real-Debrid link.
 *
 * Real-Debrid availability learned from Debridio is stored under a
 * `debridio:{hash}` marker instead of a link, and the route cut every link at
 * character 26, so the live Breaking Bad S01E01 list (recorded from dmmdb on
 * 2026-10-03) offered `play/4541931934ff9693e83f686` - the tail of the
 * infohash - as its third other stream. RD can only refuse that.
 */
import handler from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import rdFixture from '@/test/fixtures/stremioNextEpisode/rd.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (h: unknown) => h,
}));

const mockRepository = vi.mocked(repository) as unknown as Record<string, unknown>;

type Stream = { url?: string; externalUrl?: string };

const VIEWER = 'viewer000001';
const ORIGIN = 'https://dmm.test';
const PLAY = `${ORIGIN}/api/stremio/${VIEWER}/play/`;
const RD = 'https://real-debrid.com/d/';

const episode = rdFixture.episodes[0];
const rows = episode.otherStreams;

async function streamsFor(): Promise<Stream[]> {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			query: { userid: VIEWER, mediaType: 'series', imdbid: `${episode.id}.json` },
		}),
		res
	);
	expect(res._getStatusCode()).toBe(200);
	return (res._getData() as { streams: Stream[] }).streams;
}

describe('RD Cast streams for rows without a Real-Debrid link', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = ORIGIN;
		vi.clearAllMocks();
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it.each([
		['shared pool', 'getOtherStreams', 'getUserCastStreams'],
		['viewer’s own casts', 'getUserCastStreams', 'getOtherStreams'],
	])('plays only Real-Debrid links from the %s', async (_label, filled, empty) => {
		const markers = rows.filter((row) => row.link.startsWith('debridio:'));
		expect(markers).toHaveLength(1);
		mockRepository[filled] = vi.fn().mockResolvedValue(rows);
		mockRepository[empty] = vi.fn().mockResolvedValue([]);

		const played = (await streamsFor()).filter((s) => s.url !== undefined);

		// RD refuses some names outright; the route drops those first.
		const links = rows.filter(
			(row) => row.link.startsWith(RD) && !isRdBlockedFilename(row.filename)
		);
		expect(links.length).toBeGreaterThan(0);
		expect(played.map((s) => s.url)).toEqual(
			links.map((row) => PLAY + row.link.slice(RD.length))
		);
		for (const marker of markers) {
			expect(played.some((s) => marker.hash.includes(s.url!.slice(PLAY.length)))).toBe(false);
		}
	});
});
