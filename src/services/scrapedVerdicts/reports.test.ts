import { forgetIdentifications } from '@/services/contentIdentifier';
import type { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { titleKeyOf } from '@/services/database/scrapedVerdict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import identified from './__fixtures__/identified-filenames.json';
import { AUTO_APPROVE_NOTE, reviewReports } from './reports';

const repositoryMock = vi.hoisted(() => ({
	reportContent: vi.fn(async () => {}),
	approveUndecidedReports: vi.fn(async () => 1),
}));
vi.mock('@/services/repository', () => ({ repository: repositoryMock }));

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

/** The model answering every media question with `media` and every title question with `title`. */
function jevAnswers(media: string, title: string) {
	const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
		if (!String(url).includes('openrouter.ai')) {
			// anything else (the identifier) gets no usable answer
			return new Response(JSON.stringify({}));
		}
		const body = JSON.parse(init.body as string);
		const count = (body.messages[1].content.match(/^\d+\. /gm) ?? []).length;
		const content = JSON.stringify(
			Object.fromEntries(
				Array.from({ length: count }, (_, i) => [String(i + 1), { media, title }])
			)
		);
		return new Response(
			JSON.stringify({
				model: 'gemma-test',
				choices: [{ message: { content } }],
				usage: { prompt_tokens: 5, completion_tokens: 2 },
			})
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('reviewReports', () => {
	beforeEach(() => {
		forgetIdentifications();
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', 'test-key');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('never files a malware report on its own, not even on a release it would trash', async () => {
		// A real release that ships an executable (AllDebrid's file list, 2026-10-18):
		// one report must not hide what every RARBG release looks like.
		const hash = '0069dda6150d1fd09f143d9d61ae3878b2e76b82';
		const title = '28.Days.Later.2002.1080p.BluRay.x265-RARBG';
		const file = vi.fn(async () => {});
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([[hash, title]])),
			getMovieContext: vi.fn(async () => movie),
			getVerdicts: vi.fn(async () => [{ titleKey: titleKeyOf(title), verdict: 'trash' }]),
		});

		expect(await reviewReports(movie.imdbId, [hash], 'malware', db, file)).toEqual([]);
		expect(file).not.toHaveBeenCalled();
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
		expect(file).toHaveBeenCalledWith('aa', 'confirmed');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(db.addTokensSpent).toHaveBeenCalledWith(expect.any(String), 7);
	});

	it('marks a movie report disputed when content-identifier names the release as the movie', async () => {
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
		expect(file).toHaveBeenCalledWith('aa', 'disputed');
		expect(file).toHaveBeenCalledTimes(1);
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
		expect(file).toHaveBeenCalledWith('aa', 'confirmed');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(db.addTokensSpent).not.toHaveBeenCalled();
	});

	// Since the review queue (2026-11-11) a disagreement is recorded, so the queue can
	// tell "the model looked and disagrees" from "never judged".
	it('marks a movie report disputed when Jev disagrees with it', async () => {
		jevAnswers('FILM', 'SAME_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['bb', 'Barbarian.2022.1080p.WEB-DL.mkv']])),
			getMovieContext: vi.fn(async () => movie),
		});
		const file = vi.fn(async () => {});

		expect(await reviewReports('tt15791034', ['bb'], 'wrong_imdb', db, file)).toEqual([]);
		expect(file).toHaveBeenCalledWith('bb', 'disputed');
		expect(file).toHaveBeenCalledTimes(1);
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
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', '');
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

describe('reviewReports with another model', () => {
	beforeEach(() => {
		forgetIdentifications();
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', 'test-key');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('asks that model with reasoning off, and files a show report it disputes', async () => {
		const fetchMock = jevAnswers('TV', 'SAME_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async () => new Map([['gg', 'Some.Show.S01E01.1080p.mkv']])),
			getShowTitles: vi.fn(async () => ({ titles: ['Some Show'], year: 2020 })),
		});
		const file = vi.fn(async () => {});
		const model = 'deepseek/deepseek-v4.1-flash-1017';

		expect(await reviewReports('tt2', ['gg'], 'wrong_imdb', db, file, { model })).toEqual([]);
		const body = JSON.parse(
			(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(body.model).toBe(model);
		expect(body.reasoning).toEqual({ enabled: false });
		expect(file).toHaveBeenCalledWith('gg', 'disputed');
	});
});

describe('reviewReports filing', () => {
	beforeEach(() => {
		forgetIdentifications();
		vi.stubEnv('OPENROUTER_VERDICTS_KEY', 'test-key');
		repositoryMock.reportContent.mockClear();
		repositoryMock.approveUndecidedReports.mockClear();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	// The model decides what it can; only disputed and unjudged reports reach the admin.
	it('hides a confirmed release on its own and leaves a disputed one for the admin', async () => {
		jevAnswers('ADULT', 'SAME_TITLE');
		const db = fakeDb({
			getFilenames: vi.fn(async (_imdbId: string, hashes: string[]) => {
				const names = new Map([
					['hh', 'Some.Show.S01E01.XXX.1080p.mkv'],
					['ii', 'Some.Show.S01E02.1080p.mkv'],
				]);
				return new Map([...names].filter(([hash]) => hashes.includes(hash)));
			}),
			getShowTitles: vi.fn(async () => ({ titles: ['Some Show'], year: 2020 })),
		});
		expect(await reviewReports('tt3', ['hh'], 'porn', db)).toEqual(['hh']);
		expect(repositoryMock.reportContent).toHaveBeenCalledWith(
			'hh',
			'tt3',
			'jev:confirmed',
			'porn'
		);
		expect(repositoryMock.approveUndecidedReports).toHaveBeenCalledWith(
			[{ imdbId: 'tt3', hash: 'hh' }],
			AUTO_APPROVE_NOTE
		);

		jevAnswers('TV', 'SAME_TITLE');
		expect(await reviewReports('tt3', ['ii'], 'porn', db)).toEqual([]);
		expect(repositoryMock.reportContent).toHaveBeenLastCalledWith(
			'ii',
			'tt3',
			'jev:disputed',
			'porn'
		);
		expect(repositoryMock.approveUndecidedReports).toHaveBeenCalledTimes(1);
	});
});
