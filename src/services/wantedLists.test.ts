import type { WantedListRow } from '@/services/database/wantedLists';
import { getMdblistClient } from '@/services/mdblistClient';
import { repository as db } from '@/services/repository';
import axios from 'axios';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ListUnreadable,
	parseListUrl,
	readList,
	syncDueWantedLists,
	syncWantedList,
} from './wantedLists';

vi.mock('axios');
vi.mock('@/services/repository');
vi.mock('@/services/mdblistClient');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-client-id' } }),
}));

// Recorded 2026-10-29 from api.trakt.tv (DMM's client id, no user token) and api.mdblist.com.
const FIXTURES = join(__dirname, '__fixtures__/wantedLists');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const headersOf = (name: string) =>
	Object.fromEntries(
		readFileSync(join(FIXTURES, name), 'utf8')
			.split('\n')
			.filter((line) => line.includes(':'))
			.map((line) => {
				const i = line.indexOf(':');
				return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
			})
	);

const TRAKT = 'https://api.trakt.tv';
const LIST = `${TRAKT}/users/giladg/lists/latest-4k-releases`;
const WATCHLIST = `${TRAKT}/users/sean/watchlist`;

/** Trakt as recorded: the list's two pages, sean's profile and watchlist. */
function serveTrakt(profile = fixture('trakt-user-sean.json')) {
	vi.mocked(axios.get).mockImplementation(async (url, config) => {
		const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
		if (url === LIST) return { data: fixture('trakt-list-giladg-latest-4k-releases.json') };
		if (url === `${LIST}/items`) {
			return {
				data: fixture(`trakt-list-giladg-latest-4k-releases-p${page}.json`),
				headers: headersOf(`trakt-list-giladg-latest-4k-releases-p${page}.headers`),
			};
		}
		if (url === `${TRAKT}/users/sean`) return { data: profile };
		if (url === `${WATCHLIST}/movies`)
			return { data: fixture('trakt-watchlist-sean-movies.json') };
		if (url === `${WATCHLIST}/shows`)
			return { data: fixture('trakt-watchlist-sean-shows.json') };
		throw Object.assign(new Error('Request failed with status code 404'), {
			isAxiosError: true,
			response: { status: 404 },
		});
	});
	vi.mocked(axios.isAxiosError).mockImplementation(((e: any) => !!e?.isAxiosError) as any);
}

const mdblist = {
	getListByPath: vi.fn(),
	getListItemsPage: vi.fn(),
};

const row = (over: Partial<WantedListRow> = {}): WantedListRow => ({
	id: 'list-1',
	shortId: 'ZP1M',
	url: 'https://mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week',
	name: 'x',
	seen: [],
	added: 0,
	createdAt: new Date('2026-10-29T10:00:00Z'),
	syncedAt: null,
	error: null,
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
	serveTrakt();
	vi.mocked(getMdblistClient).mockReturnValue(mdblist as any);
	mdblist.getListByPath.mockResolvedValue(
		fixture('mdblist-list-linaspurinis-top-watched-movies-of-the-week.json')
	);
	mdblist.getListItemsPage.mockResolvedValue(fixture('mdblist-items-14.json'));
	vi.mocked(db).wantMany = vi.fn().mockResolvedValue({ added: 0, alreadyWanted: 0, overCap: 0 });
	vi.mocked(db).recordWantedListRead = vi.fn().mockResolvedValue(undefined);
	vi.mocked(db).recordWantedListFailure = vi.fn().mockResolvedValue(undefined);
	vi.mocked(db).getSponsorByShortId = vi.fn().mockResolvedValue({ isSponsor: true });
});

describe('parseListUrl', () => {
	it('normalises the pages a sponsor may paste', () => {
		expect(
			parseListUrl('https://trakt.tv/users/giladg/lists/latest-4k-releases/?sort=added')
		).toMatchObject({
			source: 'trakt',
			kind: 'list',
			url: 'https://trakt.tv/users/giladg/lists/latest-4k-releases',
			user: 'giladg',
			slug: 'latest-4k-releases',
		});
		expect(parseListUrl('app.trakt.tv/users/sean/watchlist/movies')).toMatchObject({
			kind: 'watchlist',
			url: 'https://trakt.tv/users/sean/watchlist',
			user: 'sean',
		});
		expect(parseListUrl('https://trakt.tv/lists/2142753')).toMatchObject({
			kind: 'listId',
			url: 'https://trakt.tv/lists/2142753',
			id: '2142753',
		});
		expect(
			parseListUrl(
				'https://www.mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week/'
			)
		).toMatchObject({
			source: 'mdblist',
			url: 'https://mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week',
			user: 'linaspurinis',
			slug: 'top-watched-movies-of-the-week',
		});
	});

	it('refuses what is not a list page', () => {
		expect(parseListUrl('https://www.imdb.com/list/ls055592025/')).toBeNull();
		expect(parseListUrl('https://trakt.tv/users/giladg')).toBeNull();
		expect(parseListUrl('https://mdblist.com/lists/')).toBeNull();
		expect(parseListUrl('not a url at all')).toBeNull();
	});
});

describe('readList', () => {
	it('reads every page of a Trakt list with no user token', async () => {
		const read = await readList(
			parseListUrl('https://trakt.tv/users/giladg/lists/latest-4k-releases')!
		);
		expect(read.name).toBe('Latest 4K Releases');
		expect(read.titles).toHaveLength(272);
		expect(read.titles[0]).toEqual({
			imdbId: 'tt38504402',
			kind: 'movie',
			title: 'You, Me, Us',
		});
		expect(read.noImdbId).toBe(0);
		expect(
			vi
				.mocked(axios.get)
				.mock.calls.map(([, c]) => (c?.params as { page?: number } | undefined)?.page)
		).toEqual([undefined, 1, 2]);
	});

	it("reads a public profile's watchlist, films and shows", async () => {
		const read = await readList(parseListUrl('https://trakt.tv/users/sean/watchlist')!);
		expect(read.name).toBe("sean's watchlist");
		expect(read.titles.filter((t) => t.kind === 'movie')).toHaveLength(220);
		expect(read.titles.filter((t) => t.kind === 'show')).toHaveLength(106);
	});

	it('tells the sponsor when the profile is private, since Trakt would answer with an empty list', async () => {
		serveTrakt({ ...fixture('trakt-user-sean.json'), private: true });
		await expect(
			readList(parseListUrl('https://trakt.tv/users/sean/watchlist')!)
		).rejects.toThrow(/profile is private/);
	});

	it('names a list Trakt does not have', async () => {
		await expect(
			readList(parseListUrl('https://trakt.tv/users/nobody/lists/nothing')!)
		).rejects.toThrow(new ListUnreadable('Trakt has no such list or user'));
	});

	it('reads an MDBList list by the path of its page', async () => {
		const read = await readList(
			parseListUrl('https://mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week')!
		);
		expect(mdblist.getListByPath).toHaveBeenCalledWith(
			'linaspurinis',
			'top-watched-movies-of-the-week'
		);
		expect(mdblist.getListItemsPage).toHaveBeenCalledWith(14, 0);
		expect(read.name).toBe('Top Watched Movies of The Week / >60');
		expect(read.titles).toHaveLength(39);
		expect(read.titles[0]).toEqual({ imdbId: 'tt8946378', kind: 'movie', title: 'Knives Out' });
	});

	it('names a list MDBList does not have', async () => {
		mdblist.getListByPath.mockResolvedValue(fixture('mdblist-list-unknown.json'));
		await expect(
			readList(parseListUrl('https://mdblist.com/lists/nobody/nothing')!)
		).rejects.toThrow(new ListUnreadable('MDBList has no such list'));
	});
});

describe('syncWantedList', () => {
	it('wants the whole list the first time, shows with every season', async () => {
		vi.mocked(db).wantMany = vi
			.fn()
			.mockResolvedValue({ added: 38, alreadyWanted: 1, overCap: 0 });
		const result = await syncWantedList(row());
		const wanted = vi.mocked(db.wantMany).mock.calls[0][1];
		expect(wanted).toHaveLength(39);
		expect(wanted[0]).toEqual({
			imdbId: 'tt8946378',
			kind: 'movie',
			title: 'Knives Out',
			seasons: null,
		});
		expect(result).toMatchObject({
			name: 'Top Watched Movies of The Week / >60',
			count: 39,
			added: 38,
			alreadyWanted: 1,
		});
		expect(db.recordWantedListRead).toHaveBeenCalledWith('list-1', {
			name: 'Top Watched Movies of The Week / >60',
			seen: wanted.map((t: { imdbId: string }) => t.imdbId),
			added: 38,
		});
	});

	it('adds only what is new since the last read, so a removed title stays removed', async () => {
		const seen = fixture('mdblist-items-14.json').movies.map((m: any) => m.imdb_id);
		// The sponsor removed Knives Out from the wanted list since; the list still has it.
		await syncWantedList(row({ seen, added: 39 }));
		expect(db.wantMany).toHaveBeenCalledWith('ZP1M', []);

		// Then the list gains a title: that one is added, and only it.
		const items = fixture('mdblist-items-14.json');
		items.movies.push({ ...items.movies[0], imdb_id: 'tt0133093', title: 'The Matrix' });
		mdblist.getListItemsPage.mockResolvedValue(items);
		vi.mocked(db).wantMany = vi
			.fn()
			.mockResolvedValue({ added: 1, alreadyWanted: 0, overCap: 0 });
		await syncWantedList(row({ seen, added: 39 }));
		expect(db.wantMany).toHaveBeenCalledWith('ZP1M', [
			{ imdbId: 'tt0133093', kind: 'movie', title: 'The Matrix', seasons: null },
		]);
		expect(db.recordWantedListRead).toHaveBeenLastCalledWith(
			'list-1',
			expect.objectContaining({ added: 40, seen: [...seen, 'tt0133093'] })
		);
	});

	it('records why a read failed and leaves the wanted list alone', async () => {
		mdblist.getListByPath.mockResolvedValue([]);
		await expect(syncWantedList(row())).rejects.toThrow(ListUnreadable);
		expect(db.recordWantedListFailure).toHaveBeenCalledWith(
			'list-1',
			'MDBList has no such list'
		);
		expect(db.wantMany).not.toHaveBeenCalled();
	});
});

describe('syncDueWantedLists', () => {
	it('reads each due list and counts the ones that could not be read', async () => {
		vi.mocked(db).dueWantedLists = vi
			.fn()
			.mockResolvedValue([
				row(),
				row({ id: 'list-2', url: 'https://trakt.tv/users/nobody/lists/nothing' }),
			]);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(syncDueWantedLists()).resolves.toEqual({ synced: 1, failed: 1, lapsed: 0 });
		expect(db.recordWantedListRead).toHaveBeenCalledTimes(1);
		expect(db.recordWantedListFailure).toHaveBeenCalledWith(
			'list-2',
			'Trakt has no such list or user'
		);
	});

	// Nothing reads a lapsed sponsor's wanted list, so a list they follow would
	// only fill it, up to the 5,000 cap, with titles no zurg fetches. Their list
	// waits its six hours unread instead, so it takes no tick from the lists of
	// sponsors still active, and is read again once the sponsorship is back.
	it("leaves a lapsed sponsor's list unread until the sponsorship is back", async () => {
		vi.mocked(db).dueWantedLists = vi.fn().mockResolvedValue([row()]);
		vi.mocked(db).getSponsorByShortId = vi.fn().mockResolvedValue({ isSponsor: false });
		await expect(syncDueWantedLists()).resolves.toEqual({ synced: 0, failed: 0, lapsed: 1 });
		expect(axios.get).not.toHaveBeenCalled();
		expect(db.wantMany).not.toHaveBeenCalled();
		expect(db.recordWantedListFailure).toHaveBeenCalledWith(
			row().id,
			'Sponsorship is no longer active'
		);
	});

	// A lookup that failed is not a sponsorship that ended: the list is left due.
	it('skips a list whose sponsorship could not be checked, without recording a read', async () => {
		vi.mocked(db).dueWantedLists = vi.fn().mockResolvedValue([row()]);
		vi.mocked(db).getSponsorByShortId = vi.fn().mockRejectedValue(new Error('db down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(syncDueWantedLists()).resolves.toEqual({ synced: 0, failed: 1, lapsed: 0 });
		expect(db.wantMany).not.toHaveBeenCalled();
		expect(db.recordWantedListFailure).not.toHaveBeenCalled();
		expect(db.recordWantedListRead).not.toHaveBeenCalled();
	});
});
