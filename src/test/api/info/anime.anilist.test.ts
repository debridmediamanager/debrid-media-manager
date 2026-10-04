import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import productionUnknown from '@/test/fixtures/anime/api-info-anime-anidb-19795.json';
import fribb from '@/test/fixtures/anime/fribb-no-kitsu-entries.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fizzy #221. Entries Kitsu has never mapped had no metadata at all: the info
// route asks only Kitsu-keyed sources, and the daily import skips an entry the
// Fribb dataset gives no Kitsu id (397 of them on 2026-10-03). AniDB 19795,
// Tougen Anki: Nikko Kegon no Taki-hen, aired 2026-10-02 with eight stored
// releases and production called it "Unknown". The dataset entries and
// AniList's answers are production's, captured 2026-10-04.

vi.mock('axios');
vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({ toString: () => 'TestAgent/1.0' })),
}));
vi.mock('@/services/anime/simkl', () => ({ resolveImdbIdFromSimkl: async () => null }));
vi.mock('@/services/repository', () => ({
	repository: { getAnimeByExternalId: async () => null },
}));
vi.mock('@/services/anime/animeFranchise', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/anime/animeFranchise')>();
	return {
		...actual,
		getFranchiseIndex: async () => actual.buildFranchiseIndex(fribb as FribbAnimeEntry[]),
	};
});

const FIXTURES = path.resolve(__dirname, '../../fixtures/anime');
const anilistFixture = (name: string) =>
	JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

/** What AniList answered production for each lookup DMM makes. */
const ANILIST_ANSWERS: Record<string, { status: number; file: string }> = {
	'{"id":204650}': { status: 200, file: 'anilist-media-204650.json' },
	'{"idMal":61634}': { status: 200, file: 'anilist-media-mal-61634.json' },
};

describe('/api/info/anime for an entry Kitsu has never mapped', () => {
	const originalFetch = global.fetch;
	const anilistCalls: string[] = [];

	beforeEach(() => {
		// A fresh module each test, and with it an empty AniList cache.
		vi.resetModules();
		anilistCalls.length = 0;
		vi.mocked(axios.get).mockRejectedValue(new Error('Request failed with status code 403'));
		global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			if (String(url) !== 'https://graphql.anilist.co') {
				return { ok: false, status: 404, json: async () => ({}) } as Response;
			}
			const variables = JSON.stringify(JSON.parse(String(init?.body)).variables);
			anilistCalls.push(variables);
			const answer = ANILIST_ANSWERS[variables] ?? {
				status: 404,
				file: 'anilist-media-not-found.json',
			};
			const body = anilistFixture(answer.file);
			return {
				ok: answer.status === 200,
				status: answer.status,
				headers: new Headers(),
				json: async () => body,
			} as Response;
		}) as typeof fetch;
	});
	afterEach(() => {
		global.fetch = originalFetch;
	});

	const info = async (animeid: string) => {
		const { default: handler } = await import('@/pages/api/info/anime');
		const res = createMockResponse();
		await handler(createMockRequest({ query: { animeid } }), res);
		return vi.mocked(res.json).mock.calls[0][0];
	};

	it("answers AniDB 19795 from AniList by the dataset's AniList id", async () => {
		expect(productionUnknown.title).toBe('Unknown');

		const body = await info('anidb-19795');

		expect(body).toMatchObject({
			title: 'Tougen Anki: Nikko・Kegon no Taki-hen',
			type: 'TV',
			episodeCount: 24,
			imdbRating: 6.9,
			poster: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx204650-nvK5CuG60WGY.jpg',
			backdrop:
				'https://s4.anilist.co/file/anilistcdn/media/anime/banner/204650-MpownoVlYv69.jpg',
		});
		expect(body.description).toMatch(/^After battling in Kyoto and Nerima/);
		expect(body.description).not.toMatch(/<br|<i>/);
		expect(anilistCalls).toEqual(['{"id":204650}']);
	});

	it('asks AniList by MAL id for a MAL page', async () => {
		const body = await info('mal-61634');

		expect(body).toMatchObject({ title: 'Cheng Ye Xiao He', type: 'ONA', episodeCount: 16 });
		expect(anilistCalls).toEqual(['{"idMal":61634}']);
		// AniList has no score for it yet.
		expect(body.imdbRating).toBe(0);
	});

	it('remembers an answer instead of asking AniList again on the next view', async () => {
		await info('anidb-19795');
		await info('anidb-19795');

		expect(anilistCalls).toHaveLength(1);
	});

	it('still answers the placeholder when AniList has nothing either', async () => {
		const body = await info('mal-999999');

		expect(anilistCalls).toEqual(['{"idMal":999999}']);
		expect(body).toMatchObject({ title: 'Unknown', type: '', episodeCount: 0 });
	});
});
