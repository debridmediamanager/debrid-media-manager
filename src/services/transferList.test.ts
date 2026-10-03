import uncachedJob from '@/test/fixtures/contentRequests/job-failed-uncached.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/debridUploaderServers', () => ({
	__esModule: true,
	getDebridUploaderServers: () => ['http://debrid01:3100', 'http://debrid02:3100'],
}));

vi.mock('@/services/nzb2rd', () => ({
	__esModule: true,
	getNzb2rdUrl: () => 'http://nzb2rd:3200',
}));

import {
	debridRowOf,
	decodeCursor,
	encodeCursor,
	listTransfers,
	mergePage,
	nzb2rdRowOf,
	parseServiceTime,
	sourceIdOf,
	withMeta,
} from './transferList';

describe('parseServiceTime', () => {
	it('reads a bare SQLite timestamp as UTC', () => {
		// Both services store `datetime('now')`, which is UTC with no zone marker.
		// Without the appended Z, Node reads it as *local* time and a transfer on a
		// UTC+2 host is dated two hours in the future.
		expect(parseServiceTime('2026-08-19 12:00:00')).toBe(Date.parse('2026-08-19T12:00:00Z'));
	});

	it('leaves an explicit zone alone', () => {
		expect(parseServiceTime('2026-08-19T12:00:00Z')).toBe(Date.parse('2026-08-19T12:00:00Z'));
		expect(parseServiceTime('2026-08-19T14:00:00+02:00')).toBe(
			Date.parse('2026-08-19T12:00:00Z')
		);
	});

	it('answers 0 for anything unparseable, so a bad row sorts last', () => {
		expect(parseServiceTime(undefined)).toBe(0);
		expect(parseServiceTime('')).toBe(0);
		expect(parseServiceTime('not a date')).toBe(0);
		expect(parseServiceTime(12345)).toBe(0);
	});
});

describe('row mapping', () => {
	it('renames the debrid job `source` so it cannot be read as the service', () => {
		// The service calls the cache provider `source`; on the merged shape that
		// word already means "which service ran this". Two questions sharing one
		// field name is how a TorBox transfer ends up labelled Usenet.
		const row = debridRowOf({ id: 'j1', status: 'uploading', source: 'torbox' });
		expect(row.source).toBe('debrid');
		expect(row.jobSource).toBe('torbox');
	});

	// What a Retry on a failed row sends again. The body is a real failed job
	// from debrid02; `info_hash` would be the rewritten torrent's, never the
	// release's, and the full `input` is not the browser's business.
	it('carries the release hash out of a failed debrid job, and not its input', () => {
		const row = debridRowOf(uncachedJob);
		expect(row.hash).toBe('abb28cb1dc25c1e2fa27aac9d1fe70d4c02be8f2');
		expect(row).toMatchObject({ status: 'failed', error: 'uncached', imdbId: 'tt1228322' });
		expect(row).not.toHaveProperty('input');
	});

	it('falls back to the NZB name when nzb2rd has not settled a clean one', () => {
		expect(nzb2rdRowOf({ id: 'j2', status: 'probing', nzb_name: 'raw.nzb' }).name).toBe(
			'raw.nzb'
		);
		expect(
			nzb2rdRowOf({ id: 'j2', status: 'preparing', name: 'Clean', nzb_name: 'raw.nzb' }).name
		).toBe('Clean');
	});

	it('carries the progress fields the phase bar reads', () => {
		const row = nzb2rdRowOf({
			id: 'j3',
			status: 'fetching',
			total_bytes: 100,
			done_bytes: 40,
			queue: { position: 2, waiting: 5 },
		});
		expect(row).toMatchObject({ total_bytes: 100, done_bytes: 40 });
		expect(row.queue).toEqual({ position: 2, waiting: 5 });
	});
});

describe('withMeta', () => {
	const base = debridRowOf({ id: 'j1', status: 'completed', imdb_id: 'tt1' });

	it('leaves a row untouched when nothing was stored', () => {
		// An *arr job, or one submitted before DMM began recording context.
		expect(withMeta(base, undefined)).toBe(base);
	});

	it('overlays the DMM title and the page link', () => {
		const row = withMeta(base, {
			source: 'debrid',
			jobId: 'j1',
			title: 'Nice Title',
			returnPath: '/movie/tt1',
			updatedAt: 0,
		});
		expect(row).toMatchObject({ title: 'Nice Title', returnPath: '/movie/tt1' });
	});

	it("keeps the service's own imdb id over the stored one", () => {
		// The job row is the live record; the stored context is a snapshot from
		// submit time.
		const row = withMeta(base, {
			source: 'debrid',
			jobId: 'j1',
			imdbId: 'tt-stale',
			updatedAt: 0,
		});
		expect(row.imdbId).toBe('tt1');
	});
});

describe('mergePage', () => {
	const at = (id: string, createdAt: number) => ({
		...debridRowOf({ id, status: 'completed' }),
		createdAt,
	});

	it('orders newest first across every service', () => {
		const { rows } = mergePage([[at('new', 3000), at('old', 1000)], [at('mid', 2000)]], 10);
		expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
	});

	it('says how much of each window the page used, which is what the cursor advances by', () => {
		const windows = [
			[at('a', 4000), at('c', 2000)],
			[at('b', 3000), at('d', 1000)],
		];
		const { rows, taken } = mergePage(windows, 3);
		expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
		expect(taken).toEqual([2, 1]);
	});

	it('breaks a same-second tie the same way every time', () => {
		// Service timestamps are whole seconds, and ties are real: six pairs in
		// one account's 648 Usenet jobs. The service listed first wins.
		const { rows } = mergePage([[at('debrid', 1000)], [at('usenet', 1000)]], 2);
		expect(rows.map((r) => r.id)).toEqual(['debrid', 'usenet']);
	});
});

describe('cursor', () => {
	it('round-trips', () => {
		const cursor = { 'debrid-1a2b3c4d': 12, nzb2rd: 300 };
		expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
	});

	it('names a debrid host by a hash, never its address', () => {
		// The cursor rides in a query string, which every proxy in front of DMM logs.
		const id = sourceIdOf('http://100.122.58.7:3100');
		expect(id).toMatch(/^debrid-[0-9a-f]{8}$/);
		expect(id).toBe(sourceIdOf('http://100.122.58.7:3100'));
		expect(id).not.toBe(sourceIdOf('http://100.110.215.49:3100'));
	});

	it('refuses anything it did not write', () => {
		for (const raw of [
			'',
			'nzb2rd',
			'nzb2rd.-1',
			'nzb2rd.1e3',
			'NZB2RD.1',
			'nzb2rd.1_',
			'x'.repeat(2000),
		]) {
			expect(decodeCursor(raw)).toBeNull();
		}
	});
});

describe('listTransfers', () => {
	beforeEach(() => vi.clearAllMocks());

	const jobsFor = (url: string) => {
		if (url.startsWith('http://nzb2rd')) {
			return [{ id: 'n1', status: 'fetching', created_at: '2026-08-19 12:00:02' }];
		}
		if (url.startsWith('http://debrid01')) {
			return [{ id: 'd1', status: 'uploading', created_at: '2026-08-19 12:00:03' }];
		}
		return [{ id: 'd2', status: 'completed', created_at: '2026-08-19 12:00:01' }];
	};

	const okFetch = () =>
		vi.fn(async (url: string) => ({
			ok: true,
			status: 200,
			json: async () => jobsFor(url),
		}));

	it('fans out to every service and merges newest first', async () => {
		vi.stubGlobal('fetch', okFetch());

		const { transfers, degraded } = await listTransfers('rd-key', 10);

		expect(transfers.map((t) => t.id)).toEqual(['d1', 'n1', 'd2']);
		expect(degraded).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('sends the key as a header and never in the URL', async () => {
		const spy = okFetch();
		vi.stubGlobal('fetch', spy);

		await listTransfers('rd-secret-key', 10);

		for (const [url, init] of spy.mock.calls as any[]) {
			expect(url).not.toContain('rd-secret-key');
			expect(init.headers['x-rd-api-key']).toBe('rd-secret-key');
		}
	});

	it('names a service that fails instead of silently shortening the list', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.startsWith('http://nzb2rd')) throw new Error('unreachable');
				return { ok: true, status: 200, json: async () => jobsFor(url) };
			})
		);

		const { transfers, degraded } = await listTransfers('rd-key', 10);

		expect(transfers.map((t) => t.id)).toEqual(['d1', 'd2']);
		expect(degraded).toEqual(['nzb2rd']);
	});

	it('treats a non-200 as degraded rather than as an empty account', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
		);

		const { transfers, degraded } = await listTransfers('rd-key', 10);

		expect(transfers).toEqual([]);
		expect(degraded).toHaveLength(3);
	});

	it('asks each service for one row past the page, from the start', async () => {
		// The extra row is what tells the last page from one that merely ends
		// where a service's list does.
		const spy = okFetch();
		vi.stubGlobal('fetch', spy);

		await listTransfers('rd-key', 20);

		for (const [url] of spy.mock.calls as any[]) expect(url).toMatch(/\?limit=21&offset=0$/);
	});

	it("reads each service from the cursor's position for it", async () => {
		const spy = okFetch();
		vi.stubGlobal('fetch', spy);

		await listTransfers('rd-key', 20, {
			[sourceIdOf('http://debrid01:3100')]: 7,
			nzb2rd: 40,
		});

		const asked = Object.fromEntries(
			(spy.mock.calls as any[]).map(([url]) => [new URL(url).host, new URL(url).search])
		);
		expect(asked).toEqual({
			'debrid01:3100': '?limit=21&offset=7',
			// A host the cursor does not name starts at the top.
			'debrid02:3100': '?limit=21&offset=0',
			'nzb2rd:3200': '?limit=21&offset=40',
		});
	});

	it('links to no further page once every service has run out', async () => {
		vi.stubGlobal('fetch', okFetch());

		const { next } = await listTransfers('rd-key', 10);

		expect(next).toBeNull();
	});

	it('moves each service on by what the page took from it', async () => {
		vi.stubGlobal('fetch', okFetch());

		const { transfers, next } = await listTransfers('rd-key', 2);

		expect(transfers.map((t) => t.id)).toEqual(['d1', 'n1']);
		expect(decodeCursor(next!)).toEqual({
			[sourceIdOf('http://debrid01:3100')]: 1,
			[sourceIdOf('http://debrid02:3100')]: 0,
			nzb2rd: 1,
		});
	});

	it('keeps an unreachable service where it was, so its rows are not stepped over', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.startsWith('http://nzb2rd')) throw new Error('unreachable');
				return { ok: true, status: 200, json: async () => jobsFor(url) };
			})
		);

		const { next } = await listTransfers('rd-key', 1, { nzb2rd: 30 });

		expect(decodeCursor(next!)).toMatchObject({ nzb2rd: 30 });
	});

	it('counts a malformed row it skipped when moving a service on', async () => {
		// The service's offset counts every row it sent. Advancing by usable rows
		// only would read the same row again on the next page.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => ({
				ok: true,
				status: 200,
				json: async () =>
					url.startsWith('http://nzb2rd')
						? [
								{ id: 'n1', status: 'failed', created_at: '2026-08-19 12:00:09' },
								{ id: 'broken' },
								{ id: 'n2', status: 'failed', created_at: '2026-08-19 12:00:08' },
								{ id: 'n3', status: 'failed', created_at: '2026-08-19 12:00:07' },
							]
						: [],
			}))
		);

		const { transfers, next } = await listTransfers('rd-key', 2);

		expect(transfers.map((t) => t.id)).toEqual(['n1', 'n2']);
		expect(decodeCursor(next!)).toMatchObject({ nzb2rd: 3 });
	});

	it('keeps the raw service job beside the row, not on it', async () => {
		// Registration needs `input`, `files` and `completed_at`; the browser needs
		// none of them and must not be sent them.
		vi.stubGlobal('fetch', okFetch());

		const { transfers, raw } = await listTransfers('rd-key', 10);

		expect(raw.get('debrid:d1')).toMatchObject({ id: 'd1' });
		expect(transfers[0]).not.toHaveProperty('input');
	});

	it('skips a malformed job row rather than rendering a blank card', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => [{ id: 'ok', status: 'pending' }, { id: 'no-status' }, null],
			}))
		);

		const { transfers } = await listTransfers('rd-key', 10);

		expect(transfers.every((t) => t.id === 'ok')).toBe(true);
	});
});
