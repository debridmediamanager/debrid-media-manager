// @vitest-environment node
import listing from '@/test/fixtures/debridlink/seedbox-list-2026-09-06.json';
import filterReads from '@/test/fixtures/debridlink/seedbox-list-ids-filter-2026-10-03.json';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LIBRARY_SNAPSHOT_MAX_AGE_MS,
	_testing,
	addSeedboxTorrent,
	checkDebridLinkCache,
	deleteSeedboxTorrents,
	listSeedboxTorrents,
	type DebridLinkTorrent,
} from './debridLink';

/**
 * Fizzy card 136: Check DL on a 52,685-torrent Debrid-Link library made
 * hundreds of listing requests before the probe and hundreds more after it.
 * `checkDebridLinkCache` walked the whole seedbox to learn what the user
 * already held, probed, removed what it created, and walked the whole seedbox
 * again to confirm the removal: 1,054 listing requests for one hit.
 *
 * The account below is a model of Debrid-Link's seedbox built from recorded
 * answers (see the fixture README): the four-page listing of 2026-09-06, and
 * the `ids=` reads of 2026-10-03. The first describe block holds the model to
 * those recordings; the rest drive the real client against it.
 */

type Row = DebridLinkTorrent & Record<string, unknown>;

const TOKEN = 'dl-recorded-token';
const RECORDED_ROWS = listing.pages.flatMap((page) => page.value) as unknown as Row[];
const RECORDED_PAGES = listing.pages.length;

/**
 * The narrowest id rule consistent with every recorded `ids=` answer: real ids
 * are `s` and 23 more characters; `notarealid` dropped the filter, absent ids
 * of the real shape did not. Debrid-Link's actual validation is unknown.
 */
const WELL_FORMED_ID = /^s[a-z0-9]{23}$/;

/**
 * How the filter treats ids the account does not hold.
 *
 * - `recorded`: as answered on 2026-10-03 - the filter is dropped only when no
 *   requested id is well-formed.
 * - `dropped-unless-one-is-held`: the 2026-09-02 reading - the filter is
 *   dropped when none of the requested ids is in the account.
 */
type FilterRule = 'recorded' | 'dropped-unless-one-is-held';

const stableId = (hash: string) =>
	's' + createHash('sha1').update(`id:${hash}`).digest('hex').slice(0, 23);

const syntheticHash = (n: number) => createHash('sha1').update(`hash:${n}`).digest('hex');

/** A cached hash none of the libraries below holds. */
const CACHED_A = syntheticHash(-1);
const CACHED_B = syntheticHash(-2);
const UNCACHED = syntheticHash(-3);

class DebridLinkAccount {
	/** In list order: newest `created` first, as every recorded listing is. */
	rows: Row[];
	/** What a bare-hash add of each cached hash answers with. */
	cache = new Map<string, Row>();
	/** The account's own hash per torrent id, whatever its listing row shows. */
	hashOf = new Map<string, string>();
	rule: FilterRule = 'recorded';
	ignoreDeletes = false;
	/** Drops `pagination` from this page of an unfiltered read, when set. */
	pageWithoutPagination: number | null = null;
	clock: number;
	requests: Array<{ method: string; path: string; params: URLSearchParams }> = [];

	constructor(rows: Row[]) {
		this.rows = [...rows];
		for (const row of rows) this.hashOf.set(row.id, row.hashString);
		this.clock = Math.max(0, ...rows.map((row) => row.created)) + 60;
	}

	cacheHash(hash: string) {
		const template = RECORDED_ROWS[0];
		this.cache.set(hash, {
			...template,
			id: stableId(hash),
			hashString: hash,
			name: `cached ${hash.slice(0, 8)}`,
		});
	}

	/** An add made somewhere other than this tab: zurg, an *arr, the web app. */
	addElsewhere(hash: string): Row {
		return this.add(hash)!;
	}

	removeElsewhere(ids: string[]) {
		const gone = new Set(ids);
		this.rows = this.rows.filter((row) => !gone.has(row.id));
	}

	list(params: URLSearchParams) {
		const page = Number(params.get('page') ?? 0);
		const perPage = Math.min(100, Math.max(20, Number(params.get('perPage') ?? 20)));
		const ids = params.get('ids')?.split(',');

		let result = this.rows;
		if (ids) {
			const held = new Set(this.rows.map((row) => row.id));
			const dropped =
				this.rule === 'recorded'
					? !ids.some((id) => WELL_FORMED_ID.test(id))
					: !ids.some((id) => held.has(id));
			if (!dropped) {
				// A filter that holds answers in the order the ids were asked
				// for, not in list order (recorded 2026-10-03).
				const byId = new Map(this.rows.map((row) => [row.id, row]));
				result = ids.flatMap((id) => byId.get(id) ?? []);
			}
		}

		// The rule every recorded pagination object follows, the 2026-09-12
		// page past the end included: {page: 5, pages: 1, next: -1, previous: 4}.
		const pages = Math.max(1, Math.ceil(result.length / perPage));
		const pagination = {
			page,
			pages,
			next: page + 1 < pages ? page + 1 : -1,
			previous: page > 0 ? page - 1 : -1,
		};
		const value = result.slice(page * perPage, (page + 1) * perPage);
		if (!ids && page === this.pageWithoutPagination) return { success: true, value };
		return { success: true, value, pagination };
	}

	/** Idempotent by hash with a stable id, and always to the top (see the README). */
	private add(hash: string): Row | null {
		const held = this.rows.find((row) => this.hashOf.get(row.id) === hash);
		if (held) {
			this.rows = [
				{ ...held, created: ++this.clock },
				...this.rows.filter((r) => r !== held),
			];
			return this.rows[0];
		}
		const template = this.cache.get(hash);
		if (!template) return null;
		const row = { ...template, created: ++this.clock };
		this.hashOf.set(row.id, hash);
		this.rows = [row, ...this.rows];
		return row;
	}

	serve = async (input: unknown, init?: RequestInit) => {
		const url = new URL(String(input));
		const path = url.pathname.replace('/api/v2/', '');
		const method = init?.method ?? 'GET';
		this.requests.push({ method, path, params: url.searchParams });

		if (method === 'GET' && path === 'seedbox/list')
			return respond(this.list(url.searchParams));
		if (method === 'POST' && path === 'seedbox/add') {
			const source = new URLSearchParams(String(init?.body)).get('url') ?? '';
			if (!/^[0-9a-f]{40}$/i.test(source)) {
				return respond({ success: false, error: 'badArguments' }, 400);
			}
			const row = this.add(source.toLowerCase());
			return row
				? respond({ success: true, value: row })
				: respond({ success: false, error: 'notAddTorrent' }, 400);
		}
		const remove = path.match(/^seedbox\/(.+)\/remove$/);
		if (method === 'DELETE' && remove) {
			const ids = decodeURIComponent(remove[1]).split(',');
			if (!this.ignoreDeletes) this.removeElsewhere(ids);
			return respond({ success: true, value: ids });
		}
		return respond({ success: false, error: 'unknowR' }, 404);
	};

	/** `seedbox/list` requests since the last call, by what they read. */
	takeListReads() {
		const reads = this.requests.filter((r) => r.path === 'seedbox/list');
		this.requests = [];
		return {
			total: reads.length,
			// Only a walk reads past page 0.
			pastPageZero: reads.filter((r) => Number(r.params.get('page') ?? 0) > 0).length,
			filtered: reads.filter((r) => r.params.has('ids')).length,
		};
	}
}

const respond = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

/**
 * The reporter's library: 52,685 torrents, built from the recorded rows with
 * synthetic ids and hashes and an unbroken newest-first order.
 */
const reporterLibrary = (): Row[] =>
	Array.from({ length: 52_685 }, (_, i) => {
		const hash = syntheticHash(i);
		return {
			...RECORDED_ROWS[i % RECORDED_ROWS.length],
			id: stableId(hash),
			hashString: hash,
			created: 1_788_677_229 - i,
		};
	});

const REPORTER_PAGES = Math.ceil(52_685 / 100);

let account: DebridLinkAccount;

const serve = (rows: Row[]) => {
	account = new DebridLinkAccount(rows);
	account.cacheHash(CACHED_A);
	account.cacheHash(CACHED_B);
	vi.stubGlobal('fetch', vi.fn(account.serve));
	return account;
};

beforeEach(() => {
	_testing.resetFloodLockouts();
	_testing.resetProbeBudget();
	_testing.resetLibrarySnapshots();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('the Debrid-Link model against its recordings', () => {
	it('pages the 2026-09-06 library exactly as Debrid-Link did', async () => {
		serve(RECORDED_ROWS);

		for (const [page, recorded] of listing.pages.entries()) {
			const { torrents, pagination } = await listSeedboxTorrents(TOKEN, { page });
			expect(pagination).toEqual(recorded.pagination);
			expect(torrents.map((t) => t.id)).toEqual(recorded.value.map((t) => t.id));
		}
	});

	it('answers every recorded 2026-10-03 ids= read the way the account did', () => {
		const held = filterReads.account as unknown as Row[];
		const model = new DebridLinkAccount(held);

		for (const read of filterReads.captures) {
			const params = new URLSearchParams({
				page: '0',
				perPage: '100',
				ids: read.requestedIds.join(','),
			});
			const answer = model.list(params);
			expect({ name: read.name, pagination: answer.pagination }).toEqual({
				name: read.name,
				pagination: read.response.pagination,
			});
			expect(answer.value.map((row) => row.id)).toEqual(read.response.ids);
		}
	});
});

describe('one Check DL on a large Debrid-Link library (card 136)', () => {
	it('walks the recorded four-page library once for a hit, not before and after', async () => {
		serve(RECORDED_ROWS);
		const before = account.rows.map((row) => row.id);

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_A]);

		expect(sweep.results[0]).toMatchObject({ cached: true, checked: true, removed: true });
		expect(sweep.leftBehindIds).toEqual([]);
		expect(account.rows.map((row) => row.id)).toEqual(before);
		// One walk of four pages, one look at page 0 just before the probe (the
		// walk read it first), one filtered read to confirm the removal. It
		// was eight: the four pages before the probe and the same four after.
		expect(account.takeListReads()).toEqual({
			total: RECORDED_PAGES + 2,
			pastPageZero: RECORDED_PAGES - 1,
			filtered: 1,
		});
	});

	it('costs the reporter one walk for the first check and none for the next', async () => {
		serve(reporterLibrary());

		const first = await checkDebridLinkCache(TOKEN, [CACHED_A]);
		expect(first.results[0]).toMatchObject({ cached: true, removed: true });
		expect(account.takeListReads()).toEqual({
			total: REPORTER_PAGES + 2,
			pastPageZero: REPORTER_PAGES - 1,
			filtered: 1,
		});

		// The next row's Check DL, moments later: page 0 vouches for the
		// reading, and the removal is confirmed by id.
		const second = await checkDebridLinkCache(TOKEN, [CACHED_B]);
		expect(second.results[0]).toMatchObject({ cached: true, removed: true });
		expect(account.takeListReads()).toEqual({ total: 2, pastPageZero: 0, filtered: 1 });

		// A miss creates nothing, so there is nothing to confirm.
		const third = await checkDebridLinkCache(TOKEN, [UNCACHED]);
		expect(third.results[0]).toEqual({ hash: UNCACHED, cached: false, checked: true });
		expect(account.takeListReads()).toEqual({ total: 1, pastPageZero: 0, filtered: 0 });

		expect(account.rows).toHaveLength(52_685);
	});

	it('never removes a torrent added elsewhere after the library was read', async () => {
		serve(reporterLibrary());
		await checkDebridLinkCache(TOKEN, [CACHED_A]);
		account.takeListReads();

		// zurg, an *arr or the web app adds a release; the next Check DL is on
		// that same release. The add answers with the user's torrent, so a
		// sweep that believed the old reading would delete it.
		const theirs = account.addElsewhere(CACHED_B);

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_B]);

		expect(sweep.results[0]).toMatchObject({
			cached: true,
			alreadyInLibrary: true,
			torrentId: theirs.id,
		});
		expect(sweep.removedIds).toEqual([]);
		expect(account.requests.filter((r) => r.method !== 'GET')).toEqual([]);
		expect(account.rows.some((row) => row.id === theirs.id)).toBe(true);
		// Page 0 carried it, so the reading was brought up to date without a walk.
		expect(account.takeListReads()).toEqual({ total: 1, pastPageZero: 0, filtered: 0 });
	});

	it('reads the library again after this tab adds to it', async () => {
		serve(reporterLibrary());
		await checkDebridLinkCache(TOKEN, [CACHED_A]);
		account.takeListReads();

		const added = await addSeedboxTorrent(TOKEN, CACHED_B);
		account.takeListReads();

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_B]);

		expect(sweep.results[0]).toMatchObject({ alreadyInLibrary: true, torrentId: added.id });
		expect(account.rows.some((row) => row.id === added.id)).toBe(true);
		expect(account.takeListReads().pastPageZero).toBe(REPORTER_PAGES - 1);
	});

	it('reads the library again after this tab removes from it', async () => {
		serve(reporterLibrary());
		await checkDebridLinkCache(TOKEN, [CACHED_A]);
		account.takeListReads();

		await deleteSeedboxTorrents(TOKEN, [account.rows[0].id]);
		await checkDebridLinkCache(TOKEN, [CACHED_B]);

		expect(account.takeListReads().pastPageZero).toBe(REPORTER_PAGES - 1);
	});

	it('reads the library again once the reading is older than its freshness window', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
		serve(reporterLibrary());
		await checkDebridLinkCache(TOKEN, [CACHED_A]);
		account.takeListReads();

		vi.setSystemTime(Date.now() + LIBRARY_SNAPSHOT_MAX_AGE_MS + 1);
		await checkDebridLinkCache(TOKEN, [CACHED_B]);

		expect(account.takeListReads().pastPageZero).toBe(REPORTER_PAGES - 1);
	});

	it('keeps the filtered confirmation cheap when an absent id drops the filter', async () => {
		serve(reporterLibrary());
		account.rule = 'dropped-unless-one-is-held';

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_A]);

		// The ids read carries two torrents the account holds, so the filter
		// stays in force even under the reading where absent ids drop it.
		expect(sweep.results[0]).toMatchObject({ cached: true, removed: true });
		expect(sweep.leftBehindIds).toEqual([]);
		expect(account.takeListReads()).toEqual({
			total: REPORTER_PAGES + 2,
			pastPageZero: REPORTER_PAGES - 1,
			filtered: 1,
		});
	});

	it('walks to confirm a removal when the filtered read is page 0 of everything', async () => {
		serve(reporterLibrary());
		account.rule = 'dropped-unless-one-is-held';
		await checkDebridLinkCache(TOKEN, [CACHED_A]);
		account.takeListReads();

		// Both anchor torrents leave the account elsewhere, so the confirming
		// read asks only for ids the account does not hold, and Debrid-Link
		// answers with page 0 of the whole library. That proves nothing about
		// the other 526 pages.
		account.removeElsewhere(account.rows.slice(-2).map((row) => row.id));

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_B]);

		expect(sweep.results[0]).toMatchObject({ cached: true, removed: true });
		expect(sweep.leftBehindIds).toEqual([]);
		// 52,683 torrents are still 527 pages.
		const reads = account.takeListReads();
		expect(reads.filtered).toBe(1);
		expect(reads.pastPageZero).toBe(REPORTER_PAGES - 1);
	});

	it('reports a removal Debrid-Link only pretended to make, off the filtered read', async () => {
		serve(reporterLibrary());
		account.ignoreDeletes = true;

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_A]);

		expect(sweep.leftBehindIds).toEqual([stableId(CACHED_A)]);
		expect(sweep.results[0].removed).toBe(false);
		expect(account.takeListReads().filtered).toBe(1);
	});

	it('probes nothing when the library cannot be read to its end', async () => {
		serve(reporterLibrary());
		account.pageWithoutPagination = 3;

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_A, UNCACHED]);

		// Three pages of 527 say nothing about the rest, and a probe of a hash
		// the user holds answers with their torrent, which the clean-up would
		// then delete.
		for (const result of sweep.results) {
			expect(result).toMatchObject({ cached: false, checked: false });
		}
		expect(account.requests.filter((r) => r.path === 'seedbox/add')).toEqual([]);
	});

	it('keeps a torrent the probe answered with when the library already held its id', async () => {
		// The account holds the release, but its listing row carried no hash -
		// so the reading cannot match it by hash. Ids are stable per account
		// and hash, which is how the probe's answer is recognised as theirs.
		const rows = reporterLibrary().slice(0, 300);
		rows[150] = { ...rows[150], id: stableId(CACHED_A), hashString: '' };
		serve(rows);
		account.hashOf.set(stableId(CACHED_A), CACHED_A);

		const sweep = await checkDebridLinkCache(TOKEN, [CACHED_A]);

		expect(sweep.results[0]).toMatchObject({ cached: true, alreadyInLibrary: true });
		expect(sweep.removedIds).toEqual([]);
		expect(account.rows.some((row) => row.id === stableId(CACHED_A))).toBe(true);
	});
});
