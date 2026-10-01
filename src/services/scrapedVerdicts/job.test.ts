import { titleKeyOf, type ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/labelled-filenames.json';
import {
	cleanMovieResultsInBackground,
	ENGINE,
	judgeMoviePage,
	withoutTrashedResults,
} from './job';

const { mockClassify } = vi.hoisted(() => ({ mockClassify: vi.fn() }));
vi.mock('./jev', () => ({ classifyFilenames: mockClassify }));
vi.mock('@/services/database/client', () => ({ DatabaseClient: class {} }));

const ministry = { imdbId: 'tt5177120', ...fixture.movies.tt5177120 };
const MOVIE = 'The.Ministry.of.Ungentlemanly.Warfare.2024.1080p.WEBRip';
const EPISODE = 'Some.Show.S01E02.1080p.WEB';
const OLD_JUNK = 'Old.Junk.2011.DVDRip';
const GAME = 'Ungentlemanly Warfare Tactics v1.2 Repack';

function fakeDb(overrides: Partial<Record<keyof ScrapedVerdictService, any>> = {}) {
	return {
		getStoredPairs: vi.fn().mockResolvedValue({
			pairs: [
				{ source: 'ScrapedTrue', hash: 'h1', title: MOVIE, fileSize: 8000 },
				{ source: 'Scraped', hash: 'h1', title: MOVIE, fileSize: 8000 },
				{ source: 'Scraped', hash: 'h2', title: EPISODE, fileSize: 900 },
				{ source: 'Scraped', hash: 'aaa', title: OLD_JUNK, fileSize: 700 },
				{ source: 'Scraped', hash: 'h4', title: OLD_JUNK, fileSize: 700 },
				{ source: 'ScrapedTrue', hash: 'h5', title: GAME, fileSize: 30000 },
			],
			lastChanged: new Date('2026-09-27T00:00:00Z'),
		}),
		getCheckpoint: vi.fn().mockResolvedValue(null),
		acquireLock: vi.fn().mockResolvedValue(true),
		releaseLock: vi.fn().mockResolvedValue(undefined),
		getMovieContext: vi.fn().mockResolvedValue(ministry),
		getVerdicts: vi
			.fn()
			.mockResolvedValue([{ hash: 'aaa', titleKey: titleKeyOf(OLD_JUNK), verdict: 'trash' }]),
		saveVerdicts: vi.fn().mockResolvedValue(undefined),
		trashPairs: vi.fn().mockImplementation(async (_k, _m, pairs) => pairs.length),
		setCheckpoint: vi.fn().mockResolvedValue(undefined),
		getTrashedPairKeys: vi.fn().mockResolvedValue(new Set()),
		getTokensSpent: vi.fn().mockResolvedValue(0),
		addTokensSpent: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as ScrapedVerdictService & Record<string, ReturnType<typeof vi.fn>>;
}

describe('judgeMoviePage', () => {
	beforeEach(() => {
		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		mockClassify.mockReset();
		mockClassify.mockResolvedValue({
			answers: [
				{ media: 'FILM', titleMatch: 'SAME_TITLE' },
				{ media: 'GAME_SOFTWARE', titleMatch: 'DIFFERENT_TITLE' },
			],
			model: 'jev-1.13.0',
			inputTokens: 1234,
		});
	});
	afterEach(() => vi.unstubAllEnvs());

	it('does nothing without an API key', async () => {
		vi.stubEnv('TYPESAFE_API_KEY', '');
		const db = fakeDb();
		await expect(judgeMoviePage('tt5177120', db)).resolves.toEqual({
			status: 'skipped',
			reason: 'no api key',
		});
		expect(db.getStoredPairs).not.toHaveBeenCalled();
	});

	it('skips a page that has not changed since its last check', async () => {
		const db = fakeDb({
			getCheckpoint: vi
				.fn()
				.mockResolvedValue({ engine: ENGINE, checkedAt: new Date('2026-09-27T01:00:00Z') }),
		});
		const outcome = await judgeMoviePage('tt5177120', db);
		expect(outcome).toEqual({ status: 'skipped', reason: 'unchanged since last check' });
		expect(db.acquireLock).not.toHaveBeenCalled();
		expect(mockClassify).not.toHaveBeenCalled();
	});

	it('revisits a checked page once the rules engine changes', async () => {
		const db = fakeDb({
			getCheckpoint: vi.fn().mockResolvedValue({
				engine: 'older',
				checkedAt: new Date('2026-09-27T01:00:00Z'),
			}),
		});
		await expect(judgeMoviePage('tt5177120', db)).resolves.toMatchObject({ status: 'done' });
	});

	it('stops once the fleet has spent the day’s token budget', async () => {
		vi.stubEnv('SCRAPED_VERDICTS_DAILY_TOKENS', '1000');
		const db = fakeDb({ getTokensSpent: vi.fn().mockResolvedValue(1000) });
		await expect(judgeMoviePage('tt5177120', db)).resolves.toEqual({
			status: 'skipped',
			reason: 'daily token budget spent',
		});
		expect(db.getTokensSpent).toHaveBeenCalledWith(new Date().toISOString().slice(0, 10));
		expect(mockClassify).not.toHaveBeenCalled();
	});

	it('leaves the page to the instance holding the lock', async () => {
		const db = fakeDb({ acquireLock: vi.fn().mockResolvedValue(false) });
		await expect(judgeMoviePage('tt5177120', db)).resolves.toEqual({
			status: 'skipped',
			reason: 'another instance is on it',
		});
		expect(db.getMovieContext).not.toHaveBeenCalled();
	});

	it('judges only unjudged results and sends the model only what code cannot settle', async () => {
		const db = fakeDb();
		const outcome = await judgeMoviePage('tt5177120', db);

		expect(mockClassify).toHaveBeenCalledTimes(1);
		expect(mockClassify).toHaveBeenCalledWith('test-key', ministry, [MOVIE, GAME]);

		const saved = (db.saveVerdicts as any).mock.calls[0][0];
		expect(
			saved.map((v: any) => [v.hash, v.title, v.verdict, v.rule, v.media, v.titleMatch])
		).toEqual([
			['h1', MOVIE, 'keep', 'jev', 'FILM', 'SAME_TITLE'],
			['h2', EPISODE, 'trash', 'rules', null, null],
			['h4', OLD_JUNK, 'trash', 'reused', null, null],
			['h5', GAME, 'trash', 'jev', 'GAME_SOFTWARE', 'DIFFERENT_TITLE'],
		]);
		expect(saved.every((v: any) => v.engine === `${ENGINE}/jev-1.13.0`)).toBe(true);

		const [pageKey, movie, trashed] = (db.trashPairs as any).mock.calls[0];
		expect(pageKey).toBe('movie:tt5177120');
		expect(movie).toBe(ministry);
		// The previously judged 'aaa' is trashed again: a scraper wrote it back.
		expect(trashed.map((p: any) => [p.source, p.hash, p.rule])).toEqual([
			['Scraped', 'h2', 'rules'],
			['Scraped', 'aaa', 'reused'],
			['Scraped', 'h4', 'reused'],
			['ScrapedTrue', 'h5', 'jev'],
		]);

		expect(outcome).toEqual({
			status: 'done',
			judged: 4,
			modelTitles: 2,
			trashed: 4,
			inputTokens: 1234,
		});
		expect(db.addTokensSpent).toHaveBeenCalledWith(new Date().toISOString().slice(0, 10), 1234);
		expect(db.setCheckpoint).toHaveBeenCalledWith('movie:tt5177120', ENGINE, expect.any(Date));
		expect(db.releaseLock).toHaveBeenCalledWith('movie:tt5177120');
	});

	it('records nothing and keeps the page due when the model fails', async () => {
		mockClassify.mockRejectedValue(new Error('Jev answered HTTP 503'));
		const db = fakeDb();
		await expect(judgeMoviePage('tt5177120', db)).rejects.toThrow('HTTP 503');
		expect(db.saveVerdicts).not.toHaveBeenCalled();
		expect(db.trashPairs).not.toHaveBeenCalled();
		expect(db.setCheckpoint).not.toHaveBeenCalled();
		expect(db.releaseLock).toHaveBeenCalled();
	});

	it('checkpoints a page IMDb knows nothing about instead of retrying every view', async () => {
		const db = fakeDb({ getMovieContext: vi.fn().mockResolvedValue(null) });
		await expect(judgeMoviePage('tt5177120', db)).resolves.toEqual({
			status: 'skipped',
			reason: 'no IMDb record',
		});
		expect(db.setCheckpoint).toHaveBeenCalled();
		expect(mockClassify).not.toHaveBeenCalled();
	});
});

describe('cleanMovieResultsInBackground', () => {
	it('never throws into the route', async () => {
		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		// The real service is built lazily; its missing prisma makes the pass fail.
		await expect(cleanMovieResultsInBackground('tt5177120')).resolves.toBeUndefined();
		vi.unstubAllEnvs();
	});
});

describe('withoutTrashedResults', () => {
	beforeEach(() => vi.stubEnv('TYPESAFE_API_KEY', 'test-key'));
	afterEach(() => vi.unstubAllEnvs());

	it('drops results whose hash and filename carry a trash verdict', async () => {
		const db = fakeDb({
			getTrashedPairKeys: vi.fn().mockResolvedValue(new Set([`h2:${titleKeyOf(EPISODE)}`])),
		});
		const results = [
			{ hash: 'H1', title: MOVIE },
			{ hash: 'H2', title: EPISODE },
			{ hash: 'h2', title: 'Same hash, filename never judged' },
		];
		await expect(withoutTrashedResults('tt5177120', results, db)).resolves.toEqual([
			results[0],
			results[2],
		]);
		expect(db.getTrashedPairKeys).toHaveBeenCalledWith('tt5177120', ['H1', 'H2', 'h2']);
	});

	it('serves the results unfiltered when the lookup fails', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const db = fakeDb({ getTrashedPairKeys: vi.fn().mockRejectedValue(new Error('db down')) });
		const results = [{ hash: 'h1', title: MOVIE }];
		await expect(withoutTrashedResults('tt5177120', results, db)).resolves.toBe(results);
	});
});
