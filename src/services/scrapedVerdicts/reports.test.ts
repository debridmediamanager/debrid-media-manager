import type { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { titleKeyOf } from '@/services/database/scrapedVerdict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import identified from './__fixtures__/identified-filenames.json';
import { reviewReports } from './reports';

vi.mock('@/services/repository', () => ({ repository: {} }));

const movie = {
	imdbId: 'tt15791034',
	name: 'Barbarian',
	year: 2022,
	titles: ['Barbarian'],
	ambiguous: {},
};

function fakeDb(overrides: Partial<Record<keyof ScrapedVerdictService, unknown>>) {
	return {
		getFilenames: vi.fn(async () => new Map<string, string>()),
		getMovieContext: vi.fn(async () => null),
		getShowTitles: vi.fn(async () => null),
		getVerdicts: vi.fn(async () => []),
		getTokensSpent: vi.fn(async () => 0),
		addTokensSpent: vi.fn(async () => {}),
		...overrides,
	} as unknown as ScrapedVerdictService;
}

/** Jev answering every media question with `media` and every title question with `title`. */
function jevAnswers(media: string, title: string) {
	const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		const answers = Object.fromEntries(
			Object.keys(body.questions).map((id) => [
				id,
				{ choice: id.startsWith('m') ? media : title },
			])
		);
		return new Response(
			JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 7 } })
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('reviewReports', () => {
	beforeEach(() => vi.stubEnv('TYPESAFE_API_KEY', 'test-key'));
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('files a movie report when the verdict trashes the release', async () => {
		const fetchMock = jevAnswers('ADULT', 'NO_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['aa', 'Barbarian.Girls.Hot.Clip.mp4']])),
			getMovieContext: vi.fn(async () => movie),
		});
		const file = vi.fn(async () => {});

		const confirmed = await reviewReports('tt15791034', ['aa'], 'porn', db, file);

		expect(confirmed).toEqual(['aa']);
		expect(file).toHaveBeenCalledWith('aa');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(db.addTokensSpent).toHaveBeenCalledWith(expect.any(String), 7);
	});

	it('does not file a movie report on a release content-identifier names as the movie', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.test');
		// content-identifier's answer for this filename, read 2026-10-18
		const identified = {
			confident: true,
			kind: 'movie',
			matches: [{ imdbId: 'tt15791034', score: 2.7284, title: 'Barbarian', year: 2022 }],
			parsedTitle: 'Barbarian',
			parsedYear: 2022,
			probability: 0.8934,
		};
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ results: [identified] }))
		);
		vi.stubGlobal('fetch', fetchMock);
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['aa', 'Barbarian.2022.1080p.WEBRip.x264']])),
			getMovieContext: vi.fn(async () => movie),
		});
		const file = vi.fn(async () => {});

		await expect(reviewReports('tt15791034', ['aa'], 'porn', db, file)).resolves.toEqual([]);
		expect(file).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('identifier.test');
	});

	it('files a movie report the identifier settles as another film without asking Jev', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.test');
		const row = identified.items.find((i) => i.filename.startsWith('Old.Henry.2021'))!;
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ results: [row.identifier] }))
		);
		vi.stubGlobal('fetch', fetchMock);
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['aa', row.filename]])),
			getMovieContext: vi.fn(
				async () => identified.movies[row.imdbId as keyof typeof identified.movies]
			),
		});
		const file = vi.fn(async () => {});

		await expect(reviewReports(row.imdbId, ['aa'], 'wrong_imdb', db, file)).resolves.toEqual([
			'aa',
		]);
		expect(file).toHaveBeenCalledWith('aa');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(db.addTokensSpent).not.toHaveBeenCalled();
	});

	it('does not file a movie report Jev disagrees with', async () => {
		jevAnswers('FILM', 'SAME_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['bb', 'Barbarian.2022.1080p.WEB-DL.mkv']])),
			getMovieContext: vi.fn(async () => movie),
		});
		const file = vi.fn(async () => {});

		expect(await reviewReports('tt15791034', ['bb'], 'wrong_imdb', db, file)).toEqual([]);
		expect(file).not.toHaveBeenCalled();
	});

	it('reuses a stored verdict without asking Jev', async () => {
		const fetchMock = jevAnswers('FILM', 'SAME_TITLE');
		const title = 'Some.Other.Film.2022.mkv';
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['cc', title]])),
			getMovieContext: vi.fn(async () => movie),
			getVerdicts: vi.fn(async () => [
				{ hash: 'cc', titleKey: titleKeyOf(title), verdict: 'trash' },
			]),
		});
		const file = vi.fn(async () => {});

		expect(await reviewReports('tt15791034', ['cc'], 'wrong_imdb', db, file)).toEqual(['cc']);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('checks a series report against the one question its type asks', async () => {
		jevAnswers('ADULT', 'SAME_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['dd', 'Show.S01E01.mkv']])),
			getShowTitles: vi.fn(async () => ({ titles: ['Show'], year: 2020 })),
		});
		const file = vi.fn(async () => {});

		expect(await reviewReports('tt1', ['dd'], 'porn', db, file)).toEqual(['dd']);
		expect(await reviewReports('tt1', ['dd'], 'wrong_imdb', db, file)).toEqual([]);
	});

	it('leaves wrong_season and keyless instances to the two-reporter rule', async () => {
		const fetchMock = jevAnswers('ADULT', 'NO_TITLE');
		const db = fakeDb({});
		expect(await reviewReports('tt1', ['ee'], 'wrong_season', db, vi.fn())).toEqual([]);
		vi.stubEnv('TYPESAFE_API_KEY', '');
		expect(await reviewReports('tt1', ['ee'], 'porn', db, vi.fn())).toEqual([]);
		expect(db.getFilenames).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('asks nothing once the day budget is spent', async () => {
		const fetchMock = jevAnswers('ADULT', 'NO_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['ff', 'Show.S01E01.mkv']])),
			getShowTitles: vi.fn(async () => ({ titles: ['Show'], year: 2020 })),
			getTokensSpent: vi.fn(async () => Number.MAX_SAFE_INTEGER),
		});
		expect(await reviewReports('tt1', ['ff'], 'porn', db, vi.fn())).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
