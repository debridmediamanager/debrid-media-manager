import type { WantedHintRow } from '@/services/database/wantedEvents';
import type { WantedItemRow } from '@/services/database/wantedItems';
import { _resetTokenSecretForTest, decryptReleaseId } from '@/services/newznab/opaqueId';
import { repository } from '@/services/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetWantedHintsForTest, wantedHints } from './wantedHints';

vi.mock('@/services/repository');
const mockRepository = vi.mocked(repository);

const ME = 'ZP1M';
const KEY = 'c'.repeat(64);
const HASH = 'b'.repeat(40);
const SHA = 'a'.repeat(64);
const T0 = new Date('2026-11-19T10:00:00Z');
const T1 = new Date('2026-11-19T11:00:00Z');

const release = (over: Partial<WantedHintRow> = {}): WantedHintRow => ({
	imdbId: 'tt0133093',
	ref: HASH,
	release: 'The.Matrix.1999.1080p.BluRay.x264-GRP',
	size: 9_000_000_000,
	resolution: '1080p',
	season: null,
	episode: null,
	pack: false,
	nzb: null,
	taken: 1,
	takers: ['AAAA'],
	refused: 0,
	lastTaken: T0,
	lastRefused: null,
	held: false,
	...over,
});
const item = (over: Partial<WantedItemRow> = {}): WantedItemRow => ({
	id: 'film',
	imdbId: 'tt0133093',
	kind: 'movie',
	title: 'The Matrix',
	seasons: null,
	createdAt: T0,
	fulfilledAt: null,
	fulfilled: null,
	lastPolledAt: null,
	...over,
});
const hintsFor = async (rows: WantedHintRow[], items = [item()]) => {
	mockRepository.wantedHintRows = vi.fn().mockResolvedValue(rows);
	return wantedHints(items, ME, KEY);
};

beforeEach(() => {
	process.env.NEWZNAB_TOKEN_SECRET = 'ab'.repeat(32);
	_resetTokenSecretForTest();
	_resetWantedHintsForTest();
});
afterEach(() => {
	delete process.env.NEWZNAB_TOKEN_SECRET;
	_resetTokenSecretForTest();
});

describe('wantedHints', () => {
	it('hands out a torrent other sponsors took, with how many', async () => {
		const hints = await hintsFor([release({ taken: 3, takers: ['AAAA', 'BBBB', 'CCCC'] })]);
		expect(hints.get('film')).toEqual({
			known: [
				{
					release: 'The.Matrix.1999.1080p.BluRay.x264-GRP',
					torrent: true,
					hash: HASH,
					size: 9_000_000_000,
					resolution: '1080p',
					pack: false,
					taken: 3,
				},
			],
		});
	});

	it("leaves the reader's own take out of the count, and a release only they took out altogether", async () => {
		const hints = await hintsFor([
			release({ taken: 3, takers: ['AAAA', ME, 'CCCC'] }),
			release({ ref: 'c'.repeat(40), taken: 1, takers: [ME] }),
		]);
		expect(hints.get('film')!.known).toEqual([
			expect.objectContaining({ hash: HASH, taken: 2 }),
		]);
	});

	it('serves an NZB only when DMM can: its own posting, or an upload it holds', async () => {
		const hints = await hintsFor([
			release({
				ref: 'ds:native-1',
				nzb: 'd'.repeat(64),
				taken: 2,
				takers: ['AAAA', 'BBBB'],
			}),
			release({ ref: SHA, nzb: SHA, held: true }),
			release({ ref: 'e'.repeat(64), nzb: 'e'.repeat(64), held: false }),
		]);
		const known = hints.get('film')!.known!;
		expect(known.map((k) => k.id)).toEqual(['d'.repeat(64), SHA]);
		for (const k of known) {
			expect(k.torrent).toBe(false);
			expect(k.hash).toBeUndefined();
			const url = new URL(k.nzb!);
			expect(url.pathname).toBe('/api/newznab/api');
			expect(url.searchParams.get('t')).toBe('get');
			expect(url.searchParams.get('apikey')).toBe(KEY);
		}
		const token = (k: (typeof known)[number]) => new URL(k.nzb!).searchParams.get('id')!;
		expect(decryptReleaseId(token(known[0]))).toEqual({ prefix: 'ds', nativeId: 'native-1' });
		expect(decryptReleaseId(token(known[1]))).toEqual({ prefix: 'wanted', nativeId: SHA });
	});

	it('condemns a release two sponsors found bad, unless someone confirmed it since', async () => {
		const bad = { taken: 0, takers: [], lastTaken: null, lastRefused: T1 };
		const hints = await hintsFor([
			release({ ...bad, refused: 2 }),
			release({ ...bad, ref: SHA, nzb: SHA, refused: 3, size: 5 }),
			// One sponsor's verdict is not enough.
			release({ ...bad, ref: '1'.repeat(40), refused: 1 }),
			// Taken before the verdicts: still bad, and no longer known.
			release({ ref: '2'.repeat(40), refused: 2, lastTaken: T0, lastRefused: T1 }),
			// Confirmed after them: known again.
			release({ ref: '3'.repeat(40), refused: 2, lastTaken: T1, lastRefused: T0 }),
		]);
		expect(hints.get('film')).toEqual({
			known: [expect.objectContaining({ hash: '3'.repeat(40) })],
			condemned: [
				{ release: expect.any(String), size: 5, nzb_sha: SHA },
				{ release: expect.any(String), hash: HASH },
				{ release: expect.any(String), hash: '2'.repeat(40) },
			],
		});
	});

	it('keeps ten known a season, most taken first, and only the seasons wanted', async () => {
		const episodes = Array.from({ length: 12 }, (_, i) =>
			release({
				imdbId: 'tt0115082',
				ref: String(i).padStart(40, '0'),
				season: 1,
				episode: i + 1,
				taken: i + 1,
				takers: [],
			})
		);
		const other = release({ imdbId: 'tt0115082', ref: 'f'.repeat(40), season: 2, episode: 1 });
		const show = item({ id: 'show', imdbId: 'tt0115082', kind: 'show', seasons: [1] });
		const all = item({ id: 'all', imdbId: 'tt0115082', kind: 'show', seasons: null });
		const hints = await hintsFor([...episodes, other], [show, all]);

		const known = hints.get('show')!.known!;
		expect(known.map((k) => k.taken)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
		expect(known.every((k) => k.season === 1)).toBe(true);
		expect(hints.get('all')!.known).toHaveLength(11);
	});

	it('keeps a wanted season its condemned releases however many other seasons have', async () => {
		const bad = { taken: 0, takers: [], lastTaken: null, lastRefused: T1, imdbId: 'tt0115082' };
		const rows = Array.from({ length: 30 }, (_, i) =>
			release({ ...bad, ref: String(i).padStart(40, '0'), season: 1, refused: 9 })
		);
		rows.push(release({ ...bad, ref: 'f'.repeat(40), season: 2, refused: 2 }));
		const two = item({ id: 'two', imdbId: 'tt0115082', kind: 'show', seasons: [2] });
		const all = item({ id: 'all', imdbId: 'tt0115082', kind: 'show', seasons: null });
		const hints = await hintsFor(rows, [two, all]);
		expect(hints.get('two')!.condemned).toEqual([
			{ release: expect.any(String), hash: 'f'.repeat(40) },
		]);
		expect(hints.get('all')!.condemned).toHaveLength(20);
	});

	it('answers a 10,000-title list from a warm cache quickly', async () => {
		const items = Array.from({ length: 10_000 }, (_, i) =>
			item({ id: `i${i}`, imdbId: `tt${String(i).padStart(7, '0')}` })
		);
		const rows = items.flatMap((it) =>
			Array.from({ length: 10 }, (_, n) =>
				release({
					imdbId: it.imdbId,
					ref: `ds:${it.id}-${n}`,
					nzb: SHA,
					taken: n + 1,
					takers: ['AAAA'],
				})
			)
		);
		mockRepository.wantedHintRows = vi.fn(async (ids: string[]) => {
			const asked = new Set(ids);
			return rows.filter((row) => asked.has(row.imdbId));
		});
		await wantedHints(items, ME, KEY);
		const started = performance.now();
		const hints = await wantedHints(items, 'OTHER', KEY);
		const took = performance.now() - started;
		expect(hints.size).toBe(10_000);
		expect(hints.get('i0')!.known).toHaveLength(10);
		// 100,000 NZB hints took 129 ms on a laptop (2026-11-19); the room is for a busy runner.
		expect(took).toBeLessThan(2000);
	});

	it('names no sponsor and no upstream in anything it answers', async () => {
		const hints = await hintsFor([
			release({ taken: 2, takers: ['AAAA', 'BBBB'] }),
			release({ ref: 'ds:native-1', nzb: null, taken: 2, takers: ['AAAA', 'BBBB'] }),
			release({
				ref: SHA,
				nzb: SHA,
				taken: 0,
				takers: [],
				refused: 2,
				lastTaken: null,
				lastRefused: T1,
			}),
		]);
		const out = JSON.stringify([...hints]);
		for (const secret of ['AAAA', 'BBBB', ME, 'shortId', 'takers', 'ds:', 'native-1']) {
			expect(out, secret).not.toContain(secret);
		}
	});

	it('reads each title once however many items and polls ask, in chunks of a thousand', async () => {
		const items = Array.from({ length: 2500 }, (_, i) =>
			item({ id: `i${i}`, imdbId: `tt${String(i).padStart(7, '0')}` })
		);
		mockRepository.wantedHintRows = vi.fn().mockResolvedValue([]);
		await wantedHints(items, ME, KEY);
		expect(mockRepository.wantedHintRows.mock.calls.map(([ids]) => ids.length)).toEqual([
			1000, 1000, 500,
		]);
		await wantedHints(items, 'OTHER', KEY);
		expect(mockRepository.wantedHintRows).toHaveBeenCalledTimes(3);
		// Past the ten minutes a title is reused for, it is read again.
		await wantedHints(items.slice(0, 1), ME, KEY, Date.now() + 11 * 60_000);
		expect(mockRepository.wantedHintRows).toHaveBeenCalledTimes(4);
	});

	it('answers nothing for a title nobody reported on', async () => {
		expect((await hintsFor([])).size).toBe(0);
	});
});
