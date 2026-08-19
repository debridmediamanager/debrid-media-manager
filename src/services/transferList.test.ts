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
	listTransfers,
	mergeRows,
	nzb2rdRowOf,
	parseServiceTime,
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

describe('mergeRows', () => {
	const at = (id: string, createdAt: number) => ({
		...debridRowOf({ id, status: 'completed' }),
		createdAt,
	});

	it('orders newest first across every service', () => {
		const rows = [at('old', 1000), at('new', 3000), at('mid', 2000)];
		expect(mergeRows(rows, 10, 0).map((r) => r.id)).toEqual(['new', 'mid', 'old']);
	});

	it('pages the merged order, not each service separately', () => {
		// Taking rows 1-2 from each service and concatenating them is not rows 1-2
		// of the merged list, which is why the slice happens here.
		const rows = [at('a', 4000), at('b', 3000), at('c', 2000), at('d', 1000)];
		expect(mergeRows(rows, 2, 0).map((r) => r.id)).toEqual(['a', 'b']);
		expect(mergeRows(rows, 2, 2).map((r) => r.id)).toEqual(['c', 'd']);
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

		const { transfers, degraded } = await listTransfers('rd-key', 10, 0);

		expect(transfers.map((t) => t.id)).toEqual(['d1', 'n1', 'd2']);
		expect(degraded).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('sends the key as a header and never in the URL', async () => {
		const spy = okFetch();
		vi.stubGlobal('fetch', spy);

		await listTransfers('rd-secret-key', 10, 0);

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

		const { transfers, degraded } = await listTransfers('rd-key', 10, 0);

		expect(transfers.map((t) => t.id)).toEqual(['d1', 'd2']);
		expect(degraded).toEqual(['nzb2rd']);
	});

	it('treats a non-200 as degraded rather than as an empty account', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
		);

		const { transfers, degraded } = await listTransfers('rd-key', 10, 0);

		expect(transfers).toEqual([]);
		expect(degraded).toHaveLength(3);
	});

	it('asks each service for enough rows to satisfy the offset', async () => {
		// A global ordering cannot be paged per-source, so every service is asked
		// for offset+limit and the slice happens after the merge.
		const spy = okFetch();
		vi.stubGlobal('fetch', spy);

		await listTransfers('rd-key', 20, 40);

		for (const [url] of spy.mock.calls as any[]) expect(url).toContain('limit=60');
	});

	it('keeps the raw service job beside the row, not on it', async () => {
		// Registration needs `input`, `files` and `completed_at`; the browser needs
		// none of them and must not be sent them.
		vi.stubGlobal('fetch', okFetch());

		const { transfers, raw } = await listTransfers('rd-key', 10, 0);

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

		const { transfers } = await listTransfers('rd-key', 10, 0);

		expect(transfers.every((t) => t.id === 'ok')).toBe(true);
	});
});
