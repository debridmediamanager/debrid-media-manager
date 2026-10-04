import {
	pairKeyOf,
	type PageChange,
	type ScrapedSource,
	type ScrapedVerdictService,
	type StoredPair,
} from '@/services/database/scrapedVerdict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import recorded from './__fixtures__/written-back-trash.json';
import { ENGINE } from './job';
import { SWEEP_SETTLE_MS, SWEEP_START, sweepWrittenBackTrash } from './sweep';

const { mockClassify } = vi.hoisted(() => ({ mockClassify: vi.fn() }));
vi.mock('./jev', () => ({ classifyFilenames: mockClassify }));
vi.mock('@/services/database/client', () => ({ DatabaseClient: class {} }));

type Entry = { hash: string; title: string; fileSize: number | null; verdict: string | null };
type Page = { updatedAt: Date; entries: Entry[] };

const SOURCES: ScrapedSource[] = ['ScrapedTrue', 'Scraped'];
const trashedOn = <T extends Entry>(entries: T[]) => entries.filter((e) => e.verdict === 'trash');

/**
 * The recorded pages in memory, behind the calls the sweep makes. `trashPairs`
 * removes what it is handed from the page and keeps the page's `updatedAt`, as
 * the locked one does; anything the sweep must not touch is left undefined.
 */
function world() {
	const tables = new Map<ScrapedSource, Map<string, Page>>(SOURCES.map((s) => [s, new Map()]));
	const verdicts = new Map<string, Map<string, string>>();
	const names = new Map<string, string>();
	for (const page of recorded.pages) {
		names.set(page.imdbId, page.movieTitle);
		const byPair = new Map<string, string>();
		for (const source of SOURCES) {
			const stored = page[source];
			if (!stored) continue;
			tables.get(source)!.set(page.key, {
				updatedAt: new Date(stored.updatedAt),
				entries: stored.entries.map((e) => ({ ...e })),
			});
			for (const e of stored.entries)
				if (e.verdict) byPair.set(pairKeyOf(e.hash, e.title), e.verdict);
		}
		verdicts.set(page.imdbId, byPair);
	}
	const cursors = new Map<ScrapedSource, PageChange>();
	const trash: {
		key: string;
		imdbId: string;
		movieTitle: string;
		hash: string;
		title: string;
		rule: string;
		engine: string;
	}[] = [];
	let locked = false;

	const db = {
		acquireLock: vi.fn(async () => !locked),
		releaseLock: vi.fn(async () => {}),
		getSweepCursor: vi.fn(async (source: ScrapedSource) => cursors.get(source) ?? null),
		setSweepCursor: vi.fn(async (source: ScrapedSource, cursor: PageChange) => {
			cursors.set(source, cursor);
		}),
		getChangedMoviePages: vi.fn(
			async (source: ScrapedSource, after: PageChange, settledBefore: Date, limit: number) =>
				[...tables.get(source)!]
					.map(([key, page]) => ({ key, at: page.updatedAt }))
					.filter(
						(p) =>
							(p.at > after.at || (+p.at === +after.at && p.key > after.key)) &&
							p.at <= settledBefore
					)
					.sort((a, b) => +a.at - +b.at || a.key.localeCompare(b.key))
					.slice(0, limit)
		),
		getJudgedImdbIds: vi.fn(
			async (ids: string[]) => new Set(ids.filter((id) => (verdicts.get(id)?.size ?? 0) > 0))
		),
		getStoredPairs: vi.fn(async (key: string) => {
			const pairs: StoredPair[] = [];
			for (const source of SOURCES) {
				for (const e of tables.get(source)!.get(key)?.entries ?? []) {
					pairs.push({ source, hash: e.hash, title: e.title, fileSize: e.fileSize });
				}
			}
			return { pairs, lastChanged: null };
		}),
		getTrashedPairKeys: vi.fn(async (imdbId: string, hashes: string[]) => {
			const wanted = new Set(hashes.map((h) => h.toLowerCase()));
			return new Set(
				[...(verdicts.get(imdbId) ?? [])]
					.filter(
						([pair, verdict]) => verdict === 'trash' && wanted.has(pair.split(':')[0])
					)
					.map(([pair]) => pair)
			);
		}),
		getMovieName: vi.fn(async (imdbId: string) => names.get(imdbId) ?? null),
		trashPairs: vi.fn(
			async (
				key: string,
				movie: { imdbId: string; name: string },
				pairs: (StoredPair & { rule: string })[],
				engine: string
			) => {
				let removed = 0;
				for (const source of SOURCES) {
					const page = tables.get(source)!.get(key);
					if (!page) continue;
					const wanted = new Set(
						pairs
							.filter((p) => p.source === source)
							.map((p) => pairKeyOf(p.hash, p.title))
					);
					const kept = page.entries.filter(
						(e) => !wanted.has(pairKeyOf(e.hash, e.title))
					);
					for (const e of page.entries) {
						if (kept.includes(e)) continue;
						removed++;
						const rule = pairs.find(
							(p) => pairKeyOf(p.hash, p.title) === pairKeyOf(e.hash, e.title)
						)!.rule;
						trash.push({
							key,
							imdbId: movie.imdbId,
							movieTitle: movie.name,
							hash: e.hash,
							title: e.title,
							rule,
							engine,
						});
					}
					page.entries = kept;
				}
				return removed;
			}
		),
	};
	return {
		db: db as unknown as ScrapedVerdictService & typeof db,
		tables,
		trash,
		cursors,
		lock: () => (locked = true),
		/** A scraper writing a page: new entries, and `updatedAt` moved to `at`. */
		write: (source: ScrapedSource, key: string, entries: Entry[], at: Date) => {
			const page = tables.get(source)!.get(key)!;
			page.entries.push(...entries);
			page.updatedAt = at;
		},
	};
}

const NOW = new Date('2026-10-04T12:00:00Z');

describe('sweepWrittenBackTrash', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	// Recorded 2026-10-04: every one of these had been moved to ScrapedTrash and
	// was back on its page, served by every reader, until somebody viewed the
	// page with model budget left.
	it('moves every recorded result a scraper wrote back after it was trashed, and nothing else', async () => {
		const { db, tables, trash } = world();
		const before = new Map(
			recorded.pages.map((p) => [p.key, tables.get('ScrapedTrue')!.get(p.key)!.updatedAt])
		);
		const writtenBack = recorded.pages.flatMap((p) =>
			SOURCES.flatMap((s) =>
				trashedOn(p[s]?.entries ?? []).map((e) => ({ ...e, key: p.key }))
			)
		);
		expect(writtenBack).toHaveLength(33);
		expect(writtenBack.every((e) => e.previouslyTrashedAt)).toBe(true);

		const outcome = await sweepWrittenBackTrash(db);

		expect(outcome).toEqual({ status: 'done', pages: 4, judgedPages: 4, moved: 33, failed: 0 });
		for (const page of recorded.pages) {
			for (const source of SOURCES) {
				const stored = page[source];
				if (!stored) continue;
				const left = tables.get(source)!.get(page.key)!.entries;
				expect(trashedOn(left)).toEqual([]);
				// Keeps and results nobody has judged yet stay where they are.
				expect(left.map((e) => e.hash)).toEqual(
					stored.entries.filter((e) => e.verdict !== 'trash').map((e) => e.hash)
				);
			}
			expect(tables.get('ScrapedTrue')!.get(page.key)!.updatedAt).toEqual(
				before.get(page.key)
			);
		}
		expect(trash.map((t) => `${t.key} ${t.hash}`).sort()).toEqual(
			writtenBack.map((e) => `${e.key} ${e.hash}`).sort()
		);
		expect(new Set(trash.map((t) => `${t.rule} ${t.engine}`))).toEqual(
			new Set([`reused ${ENGINE}/sweep`])
		);
		expect(trash.find((t) => t.imdbId === 'tt0313990')?.movieTitle).toBe(
			"Doraemon: Nobita's Little Star Wars"
		);
		// No model call, and no checkpoint: unjudged results wait for a page view.
		expect(mockClassify).not.toHaveBeenCalled();
		expect((db as any).setCheckpoint).toBeUndefined();
	});

	it('reads each table on from where the last tick stopped', async () => {
		const { db, cursors, tables, write } = world();
		await sweepWrittenBackTrash(db);
		const newest = [...tables.get('ScrapedTrue')!].sort(
			(a, b) => +b[1].updatedAt - +a[1].updatedAt
		)[0];
		expect(cursors.get('ScrapedTrue')).toEqual({ key: newest[0], at: newest[1].updatedAt });

		db.getStoredPairs.mockClear();
		expect(await sweepWrittenBackTrash(db)).toMatchObject({ pages: 0, moved: 0 });
		expect(db.getStoredPairs).not.toHaveBeenCalled();

		// A scraper writes a trashed result back again.
		const page = recorded.pages.find((p) => p.imdbId === 'tt1147514')!;
		const again = trashedOn(page.ScrapedTrue!.entries)[0];
		write('ScrapedTrue', page.key, [{ ...again }], new Date(NOW.getTime() - 10 * 60 * 1000));
		expect(await sweepWrittenBackTrash(db)).toMatchObject({ pages: 1, moved: 1 });
		expect(trashedOn(tables.get('ScrapedTrue')!.get(page.key)!.entries)).toEqual([]);
	});

	it('starts from the first verdict and leaves a change younger than the settle window', async () => {
		const { db, tables, write } = world();
		const page = recorded.pages.find((p) => p.imdbId === 'tt0313990')!;
		write('ScrapedTrue', page.key, [], new Date(NOW.getTime() - SWEEP_SETTLE_MS + 1000));

		await sweepWrittenBackTrash(db);

		expect(db.getChangedMoviePages).toHaveBeenCalledWith(
			'ScrapedTrue',
			SWEEP_START,
			new Date(NOW.getTime() - SWEEP_SETTLE_MS),
			expect.any(Number)
		);
		expect(trashedOn(tables.get('ScrapedTrue')!.get(page.key)!.entries)).toHaveLength(4);
	});

	it('does not read a changed page that has no verdicts', async () => {
		const { db } = world();
		db.getJudgedImdbIds.mockResolvedValue(new Set());

		expect(await sweepWrittenBackTrash(db)).toMatchObject({
			pages: 4,
			judgedPages: 0,
			moved: 0,
		});
		expect(db.getStoredPairs).not.toHaveBeenCalled();
	});

	it('keeps going past a page that fails, and still moves on', async () => {
		const { db, cursors, trash } = world();
		const real = db.trashPairs.getMockImplementation()!;
		db.trashPairs.mockImplementation(async (key, ...rest) => {
			if (key === 'movie:tt0235679') throw new Error('Lock wait timeout exceeded');
			return real(key, ...rest);
		});

		const outcome = await sweepWrittenBackTrash(db);

		expect(outcome).toMatchObject({ moved: 17, failed: 1 });
		expect(trash.some((t) => t.key === 'movie:tt0235679')).toBe(false);
		expect(cursors.get('ScrapedTrue')).toBeDefined();
	});

	it('does nothing when the verdicts are switched off or another instance is sweeping', async () => {
		const off = world();
		vi.stubEnv('TYPESAFE_API_KEY', '');
		expect(await sweepWrittenBackTrash(off.db)).toEqual({
			status: 'skipped',
			reason: 'no api key',
		});
		expect(off.db.getChangedMoviePages).not.toHaveBeenCalled();

		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		const busy = world();
		busy.lock();
		expect(await sweepWrittenBackTrash(busy.db)).toEqual({
			status: 'skipped',
			reason: 'another instance is on it',
		});
		expect(busy.db.getChangedMoviePages).not.toHaveBeenCalled();
	});
});
