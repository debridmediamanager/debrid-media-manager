import { describe, expect, it, vi } from 'vitest';
import { KITSU_API_BASE, fetchKitsuAnime, normalizeKitsuAnime, searchKitsuAnimeIds } from './kitsu';

const respond = (body: unknown, ok = true) =>
	vi.fn().mockResolvedValue({
		ok,
		status: ok ? 200 : 500,
		json: async () => body,
	}) as unknown as typeof fetch;

// Shape copied from a live kitsu.io response.
const cowboyBebop = {
	canonicalTitle: 'Cowboy Bebop',
	synopsis: 'In the year 2071, humanity has colonized the solar system.',
	averageRating: '82.27',
	posterImage: { tiny: 't.jpg', large: 'l.jpg', original: 'o.jpg' },
	coverImage: { tiny: 'ct.jpg', original: 'co.jpg' },
};

describe('normalizeKitsuAnime', () => {
	it('maps a full attributes object', () => {
		expect(normalizeKitsuAnime(cowboyBebop)).toEqual({
			title: 'Cowboy Bebop',
			description: 'In the year 2071, humanity has colonized the solar system.',
			poster: 'o.jpg',
			backdrop: 'co.jpg',
			rating: 8.2,
		});
	});

	it('rescales the 0-100 score to the 0-10 the UI renders', () => {
		expect(normalizeKitsuAnime({ averageRating: 100 }).rating).toBe(10);
		expect(normalizeKitsuAnime({ averageRating: 0 }).rating).toBe(0);
		expect(normalizeKitsuAnime({ averageRating: 75 }).rating).toBe(7.5);
	});

	it('returns 0 for a missing or out-of-range score', () => {
		expect(normalizeKitsuAnime({}).rating).toBe(0);
		expect(normalizeKitsuAnime({ averageRating: null }).rating).toBe(0);
		expect(normalizeKitsuAnime({ averageRating: 'n/a' }).rating).toBe(0);
		// A future scale change should not produce a 40-star rating.
		expect(normalizeKitsuAnime({ averageRating: 400 }).rating).toBe(0);
	});

	it('falls back through the image sizes it is offered', () => {
		const meta = normalizeKitsuAnime({
			posterImage: { small: 's.jpg' },
			coverImage: { large: 'cl.jpg' },
		});
		expect(meta.poster).toBe('s.jpg');
		expect(meta.backdrop).toBe('cl.jpg');
	});

	it('returns empty strings when images are absent or malformed', () => {
		expect(normalizeKitsuAnime({ posterImage: null, coverImage: 'nope' })).toMatchObject({
			poster: '',
			backdrop: '',
		});
	});

	it('uses description when synopsis is missing', () => {
		expect(normalizeKitsuAnime({ description: 'fallback' }).description).toBe('fallback');
	});
});

describe('fetchKitsuAnime', () => {
	it('requests the JSON:API endpoint and returns normalized meta', async () => {
		const fetcher = respond({ data: { attributes: cowboyBebop } });
		const meta = await fetchKitsuAnime(1, fetcher);

		expect(fetcher).toHaveBeenCalledWith(`${KITSU_API_BASE}/anime/1`, {
			headers: { Accept: 'application/vnd.api+json' },
		});
		expect(meta?.title).toBe('Cowboy Bebop');
	});

	it('rejects a non-numeric id without making a request', async () => {
		const fetcher = respond({});
		expect(await fetchKitsuAnime('kitsu:1', fetcher)).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('returns null on a non-ok response', async () => {
		expect(await fetchKitsuAnime(1, respond({}, false))).toBeNull();
	});

	it('returns null when the payload has no attributes', async () => {
		expect(await fetchKitsuAnime(1, respond({ data: {} }))).toBeNull();
	});

	it('returns null when the entry has no title', async () => {
		expect(await fetchKitsuAnime(1, respond({ data: { attributes: {} } }))).toBeNull();
	});

	it('returns null when the request throws', async () => {
		const fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
		expect(await fetchKitsuAnime(1, fetcher)).toBeNull();
	});
});

describe('searchKitsuAnimeIds', () => {
	it('returns the numeric ids Kitsu reports as strings', async () => {
		const fetcher = respond({ data: [{ id: '1' }, { id: '2' }, { id: '3424' }] });
		expect(await searchKitsuAnimeIds('cowboy bebop', fetcher)).toEqual([1, 2, 3424]);
	});

	it('encodes the keyword into the filter parameter', async () => {
		const fetcher = respond({ data: [] });
		await searchKitsuAnimeIds('cowboy bebop', fetcher, 5);

		const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toContain('filter%5Btext%5D=cowboy%20bebop');
		expect(url).toContain('page%5Blimit%5D=5');
	});

	it('returns an empty list for a blank keyword without requesting', async () => {
		const fetcher = respond({ data: [] });
		expect(await searchKitsuAnimeIds('   ', fetcher)).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('drops entries whose id is not a positive integer', async () => {
		const fetcher = respond({ data: [{ id: 'abc' }, { id: '0' }, {}, { id: '7' }] });
		expect(await searchKitsuAnimeIds('x', fetcher)).toEqual([7]);
	});

	it('returns an empty list on error or malformed payload', async () => {
		expect(await searchKitsuAnimeIds('x', respond({}, false))).toEqual([]);
		expect(await searchKitsuAnimeIds('x', respond({ data: 'nope' }))).toEqual([]);
	});
});
