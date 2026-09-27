import axios from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ANIME_SUGGESTION_REQUESTS_PER_MINUTE,
	fetchAnimeSuggestions,
	pickAnimeSuggestions,
	resetAnimeSuggestions,
} from './animeSuggestions';

vi.mock('axios', () => ({
	__esModule: true,
	default: { get: vi.fn() },
}));
const mockedGet = axios.get as ReturnType<typeof vi.fn>;

// Production's `/api/search/anime` answers, captured 2026-09-27.
const fixture = (name: string) =>
	JSON.parse(readFileSync(path.resolve(__dirname, '../test/fixtures/searchBar', name), 'utf8'));

const T0 = 1_790_000_000_000;

describe('pickAnimeSuggestions', () => {
	it('keeps the first three rows that have an anime page', () => {
		const { results } = fixture('api-search-anime-dou-po.json');
		expect(results.map((r: { id: string }) => r.id).slice(0, 4)).toEqual([
			'anime:anidb-14874',
			'anime:anidb-17052',
			'anime:mal-null',
			'anime:mal-null',
		]);

		expect(pickAnimeSuggestions(results).map((r) => r.id)).toEqual([
			'anime:anidb-14874',
			'anime:anidb-17052',
			'anime:anidb-1763',
		]);
	});

	it('keeps MAL-only rows, which have a page of their own', () => {
		const { results } = fixture('api-search-anime-bookworm.json');
		expect(pickAnimeSuggestions(results).map((r) => [r.id, r.type])).toEqual([
			['anime:anidb-14727', 'TV'],
			['anime:mal-1278', 'SPECIAL'],
			['anime:anidb-15293', 'TV'],
		]);
	});

	it('answers nothing for a body that is not a list', () => {
		expect(pickAnimeSuggestions(undefined)).toEqual([]);
		expect(pickAnimeSuggestions({ status: 'error' })).toEqual([]);
	});
});

describe('fetchAnimeSuggestions', () => {
	beforeEach(() => {
		mockedGet.mockReset();
		resetAnimeSuggestions();
		mockedGet.mockResolvedValue({ data: fixture('api-search-anime-frieren.json') });
	});

	it('asks once per query, whatever its case or surrounding spaces', async () => {
		const first = await fetchAnimeSuggestions('Frieren', T0);
		const again = await fetchAnimeSuggestions(' frieren ', T0 + 60_000);

		expect(first.map((r) => r.title)).toEqual([
			'Sousou no Frieren',
			'Sousou no Frieren (2026)',
			'Sousou no Frieren (2027)',
		]);
		expect(again).toEqual(first);
		expect(mockedGet).toHaveBeenCalledTimes(1);
		expect(mockedGet.mock.calls[0][0]).toBe('/api/search/anime?keyword=frieren');
	});

	it('asks again once the cached answer is five minutes old', async () => {
		await fetchAnimeSuggestions('frieren', T0);
		await fetchAnimeSuggestions('frieren', T0 + 5 * 60_000);
		expect(mockedGet).toHaveBeenCalledTimes(2);
	});

	it('does not keep a failure as the answer', async () => {
		mockedGet.mockRejectedValueOnce(new Error('Request failed with status code 500'));
		await expect(fetchAnimeSuggestions('frieren', T0)).rejects.toThrow('500');

		expect((await fetchAnimeSuggestions('frieren', T0 + 1000)).length).toBe(3);
		expect(mockedGet).toHaveBeenCalledTimes(2);
	});

	it('leaves two letters to Trakt', async () => {
		expect(await fetchAnimeSuggestions('fr', T0)).toEqual([]);
		expect(await fetchAnimeSuggestions(' fr ', T0)).toEqual([]);
		expect(mockedGet).not.toHaveBeenCalled();
	});

	// A slow typist asks once per letter. The server allows 30 a minute across
	// anime search and the anime page, so the dropdown stops well short of it.
	it('spends at most its share of the per-minute budget', async () => {
		const title = 'ascendance of a bookworm season two';
		for (let end = 3; end <= title.length; end++) {
			await fetchAnimeSuggestions(title.slice(0, end), T0 + end * 400);
		}
		expect(title.length - 2).toBeGreaterThan(ANIME_SUGGESTION_REQUESTS_PER_MINUTE);
		expect(mockedGet).toHaveBeenCalledTimes(ANIME_SUGGESTION_REQUESTS_PER_MINUTE);
		expect(ANIME_SUGGESTION_REQUESTS_PER_MINUTE).toBeLessThan(30);

		await fetchAnimeSuggestions('frieren', T0 + 3 * 400 + 60_000);
		expect(mockedGet).toHaveBeenCalledTimes(ANIME_SUGGESTION_REQUESTS_PER_MINUTE + 1);
	});

	it('stops asking for as long as a refusal says to', async () => {
		mockedGet.mockRejectedValueOnce(
			Object.assign(new Error('Request failed with status code 429'), {
				response: { status: 429, headers: { 'retry-after': '60' } },
			})
		);
		await expect(fetchAnimeSuggestions('frieren', T0)).rejects.toThrow('429');

		expect(await fetchAnimeSuggestions('frieren', T0 + 59_000)).toEqual([]);
		expect(mockedGet).toHaveBeenCalledTimes(1);

		expect((await fetchAnimeSuggestions('frieren', T0 + 60_000)).length).toBe(3);
		expect(mockedGet).toHaveBeenCalledTimes(2);
	});
});
