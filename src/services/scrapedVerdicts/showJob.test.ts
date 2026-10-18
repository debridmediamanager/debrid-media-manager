import { forgetIdentifications } from '@/services/contentIdentifier';
import { titleKeyOf, type ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/show-pages-2026-10-18.json';
import { IDENTIFY_PER_PASS } from './identified';
import { judgeShowPage, namesOnlyOtherSeasons, SHOW_ENGINE } from './job';

vi.mock('./jev', () => ({ classifyFilenames: vi.fn() }));
vi.mock('@/services/database/client', () => ({ DatabaseClient: class {} }));

type Page = (typeof fixture.pages)[number];
const page = (key: string) => fixture.pages.find((p) => p.key === key)!;

function fakeDb(p: Page, overrides: Partial<Record<keyof ScrapedVerdictService, any>> = {}) {
	return {
		getStoredPairs: vi.fn().mockResolvedValue({
			pairs: p.results.map(({ source, hash, title, fileSize }) => ({
				source,
				hash,
				title,
				fileSize,
			})),
			lastChanged: new Date('2026-10-18T00:00:00Z'),
		}),
		getCheckpoint: vi.fn().mockResolvedValue(null),
		acquireLock: vi.fn().mockResolvedValue(true),
		releaseLock: vi.fn().mockResolvedValue(undefined),
		getShowTitles: vi.fn().mockResolvedValue(p.show),
		getShowSeasons: vi.fn().mockResolvedValue(new Set(p.seasons)),
		getVerdicts: vi.fn().mockResolvedValue([]),
		saveVerdicts: vi.fn().mockResolvedValue(undefined),
		trashPairs: vi.fn().mockImplementation(async (_k, _s, pairs) => pairs.length),
		setCheckpoint: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as ScrapedVerdictService & Record<string, ReturnType<typeof vi.fn>>;
}

/** content-identifier answering each filename as it did on 2026-10-18. */
function recordedAnswers() {
	const byName = new Map(
		fixture.pages.flatMap((p) => p.results.map((r) => [r.title, r.identifier] as const))
	);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			const { filenames } = JSON.parse(init.body as string) as { filenames: string[] };
			return new Response(JSON.stringify({ results: filenames.map((n) => byName.get(n)) }));
		})
	);
}

const trashedBy = (db: ReturnType<typeof fakeDb>) =>
	((db.trashPairs as any).mock.calls[0]?.[2] ?? []) as { title: string; rule: string }[];

describe('judgeShowPage', () => {
	beforeEach(() => {
		forgetIdentifications();
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.test');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		recordedAnswers();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('trashes from the recorded pages exactly what was expected, under its rule', async () => {
		for (const p of fixture.pages) {
			const db = fakeDb(p);
			await judgeShowPage(p.imdbId, p.season, db);
			const got = new Map(trashedBy(db).map((t) => [t.title, t.rule]));
			for (const r of p.results) {
				expect([p.key, r.title, got.get(r.title) ?? null]).toEqual([
					p.key,
					r.title,
					r.expected,
				]);
			}
		}
	});

	it('records the identifier verdicts under the show, and nothing for the season rule', async () => {
		const p = page('tv:tt11311514:1');
		const db = fakeDb(p);
		await judgeShowPage(p.imdbId, p.season, db);
		const saved = (db.saveVerdicts as any).mock.calls[0][0];
		expect(saved.length).toBeGreaterThan(0);
		expect(saved.every((v: any) => v.imdbId === p.imdbId && v.rule === 'identified')).toBe(
			true
		);
		expect(saved.every((v: any) => v.engine === SHOW_ENGINE)).toBe(true);
		const seasonTitles = new Set(
			p.results.filter((r) => r.expected === 'season').map((r) => r.title)
		);
		expect(
			saved.filter((v: any) => seasonTitles.has(v.title) && v.verdict === 'trash')
		).toEqual([]);
		expect(db.setCheckpoint).toHaveBeenCalledWith(p.key, SHOW_ENGINE, expect.any(Date));
	});

	it('reuses a stored verdict without asking the identifier again', async () => {
		const p = page('tv:tt2398172:1');
		const stored = p.results.map((r) => ({
			hash: r.hash,
			titleKey: titleKeyOf(r.title),
			verdict: r.expected === 'identified' ? 'trash' : 'keep',
		}));
		const db = fakeDb(p, { getVerdicts: vi.fn().mockResolvedValue(stored) });
		await judgeShowPage(p.imdbId, p.season, db);
		expect(fetch).not.toHaveBeenCalled();
		expect(trashedBy(db).every((t) => t.rule === 'reused')).toBe(true);
		expect(trashedBy(db)).toHaveLength(p.results.filter((r) => r.expected).length);
	});

	it('keeps a page due when content-identifier cannot be asked, and still moves other seasons', async () => {
		// as on dmm-01 on 2026-10-18: "content-identifier unreachable: The operation
		// was aborted due to timeout" while the first show passes ran
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
			})
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const p = page('tv:tt11311514:1');
		const db = fakeDb(p);
		await judgeShowPage(p.imdbId, p.season, db);
		expect(db.setCheckpoint).not.toHaveBeenCalled();
		expect(
			trashedBy(db)
				.map((t) => t.title)
				.sort()
		).toEqual(
			p.results
				.filter((r) => r.expected === 'season')
				.map((r) => r.title)
				.sort()
		);
		expect(db.releaseLock).toHaveBeenCalled();
	});

	it('works through a page bigger than one pass can ask about, over several views', async () => {
		// the Ghost page held 3,204 results on 2026-10-18
		const p = page('tv:tt2398172:1');
		const names = Array.from(
			{ length: IDENTIFY_PER_PASS + 20 },
			(_, i) => `Ghost.S01E${i}.1080p`
		);
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				const { filenames } = JSON.parse(init.body as string) as { filenames: string[] };
				asked.push(...filenames);
				const results = filenames.map(() => ({ confident: false, matches: [] }));
				return new Response(JSON.stringify({ results }));
			})
		);
		const db = fakeDb(p, {
			getStoredPairs: vi.fn().mockResolvedValue({
				pairs: names.map((title, i) => ({
					source: 'Scraped',
					hash: `h${i}`,
					title,
					fileSize: 1,
				})),
				lastChanged: new Date('2026-10-18T00:00:00Z'),
			}),
		});

		await judgeShowPage(p.imdbId, p.season, db);
		expect(asked).toHaveLength(IDENTIFY_PER_PASS);
		expect(db.setCheckpoint).not.toHaveBeenCalled();

		await judgeShowPage(p.imdbId, p.season, db);
		expect(asked).toHaveLength(names.length);
		expect(db.setCheckpoint).toHaveBeenCalledWith(p.key, SHOW_ENGINE, expect.any(Date));
	});

	it('leaves a page alone when IMDb has no record of the show', async () => {
		const p = page('tv:tt2398172:1');
		const db = fakeDb(p, { getShowTitles: vi.fn().mockResolvedValue(null) });
		await expect(judgeShowPage(p.imdbId, p.season, db)).resolves.toEqual({
			status: 'skipped',
			reason: 'no IMDb record',
		});
		expect(db.trashPairs).not.toHaveBeenCalled();
	});

	it('skips a page that has not changed since its last check', async () => {
		const p = page('tv:tt2398172:1');
		const db = fakeDb(p, {
			getCheckpoint: vi.fn().mockResolvedValue({
				engine: SHOW_ENGINE,
				checkedAt: new Date('2026-10-18T01:00:00Z'),
			}),
		});
		await expect(judgeShowPage(p.imdbId, p.season, db)).resolves.toEqual({
			status: 'skipped',
			reason: 'unchanged since last check',
		});
	});
});

describe('namesOnlyOtherSeasons', () => {
	const seasons = new Set([1, 2, 3]);

	it('moves a release that names only other seasons IMDb lists', () => {
		expect(namesOnlyOtherSeasons('Psych Season 6 Complete', 1, new Set([1, 6]))).toBe(true);
	});

	it('keeps packs holding the season, unnamed seasons and seasons IMDb does not list', () => {
		expect(namesOnlyOtherSeasons('Log Horizon [S1S2S3]', 3, seasons)).toBe(false);
		expect(namesOnlyOtherSeasons('Show.S01-S03.1080p', 2, seasons)).toBe(false);
		expect(namesOnlyOtherSeasons('Show Complete Series 1080p', 2, seasons)).toBe(false);
		expect(namesOnlyOtherSeasons('Yuru Camp S3 - 01', 1, new Set([1, 2]))).toBe(false);
		expect(namesOnlyOtherSeasons('Would I Lie to You S00E15', 1, seasons)).toBe(false);
	});
});
