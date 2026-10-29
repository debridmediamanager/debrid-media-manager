import type { WantedKind } from '@/services/database/wantedItems';
import type { WantedListRow } from '@/services/database/wantedLists';
import { getMdblistClient } from '@/services/mdblistClient';
import { repository as db } from '@/services/repository';
import axios from 'axios';
import getConfig from 'next/config';

const TRAKT_API_URL = 'https://api.trakt.tv';
/** Trakt's largest page: `limit=1000` came back as `x-pagination-limit: 250` (2026-10-29). */
const TRAKT_PAGE = 250;
/** Lists read per cron tick: ticks are five minutes apart, so this clears 240 lists an hour. */
export const LISTS_PER_TICK = 20;
const IMDB_ID = /^tt\d{7,}$/;

/** What a sponsor may paste: the page of a list on trakt.tv or mdblist.com. */
export type ParsedListUrl =
	| { source: 'trakt'; kind: 'list'; url: string; label: string; user: string; slug: string }
	| { source: 'trakt'; kind: 'listId'; url: string; label: string; id: string }
	| { source: 'trakt'; kind: 'watchlist'; url: string; label: string; user: string }
	| { source: 'mdblist'; kind: 'list'; url: string; label: string; user: string; slug: string };

export const LIST_URL_HELP =
	'Paste the page of a Trakt or MDBList list: https://trakt.tv/users/<user>/lists/<list>, https://trakt.tv/users/<user>/watchlist, https://trakt.tv/lists/<id> or https://mdblist.com/lists/<user>/<list>';

/** `url` is the page normalised, so the same list pasted two ways is followed once. */
export function parseListUrl(raw: string): ParsedListUrl | null {
	let url: URL;
	try {
		url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase().replace(/^(www|app)\./, '');
	const path = url.pathname.replace(/\/+$/, '');
	if (host === 'trakt.tv') {
		let m = path.match(/^\/users\/([^/]+)\/lists\/([^/]+)/);
		if (m) {
			const [user, slug] = [m[1], m[2]].map(decodeURIComponent);
			return {
				source: 'trakt',
				kind: 'list',
				url: `https://trakt.tv/users/${user}/lists/${slug}`,
				label: `${user}'s ${slug}`,
				user,
				slug,
			};
		}
		m = path.match(/^\/users\/([^/]+)\/watchlist(\/|$)/);
		if (m) {
			const user = decodeURIComponent(m[1]);
			return {
				source: 'trakt',
				kind: 'watchlist',
				url: `https://trakt.tv/users/${user}/watchlist`,
				label: `${user}'s watchlist`,
				user,
			};
		}
		m = path.match(/^\/lists\/(\d+)/);
		if (m) {
			return {
				source: 'trakt',
				kind: 'listId',
				url: `https://trakt.tv/lists/${m[1]}`,
				label: `Trakt list ${m[1]}`,
				id: m[1],
			};
		}
		return null;
	}
	if (host === 'mdblist.com') {
		const m = path.match(/^\/lists\/([^/]+)\/([^/]+)/);
		if (!m) return null;
		const [user, slug] = [m[1], m[2]].map(decodeURIComponent);
		return {
			source: 'mdblist',
			kind: 'list',
			url: `https://mdblist.com/lists/${user}/${slug}`,
			label: `${user}'s ${slug}`,
			user,
			slug,
		};
	}
	return null;
}

export interface ListTitle {
	imdbId: string;
	kind: WantedKind;
	title: string;
}

export interface ListRead {
	name: string;
	titles: ListTitle[];
	/** Films and shows on the list that have no IMDb id, which DMM keys everything on. */
	noImdbId: number;
}

/** The list cannot be read, for a reason the sponsor can act on; the message is shown to them. */
export class ListUnreadable extends Error {}

function traktHeaders() {
	return {
		'Content-Type': 'application/json',
		'trakt-api-version': '2',
		'trakt-api-key': getConfig()?.publicRuntimeConfig?.traktClientId,
	};
}

async function traktGet(path: string, params?: Record<string, number>) {
	try {
		return await axios.get(`${TRAKT_API_URL}${path}`, { headers: traktHeaders(), params });
	} catch (error) {
		const status = axios.isAxiosError(error) ? error.response?.status : undefined;
		if (status === 404) throw new ListUnreadable('Trakt has no such list or user');
		if (status === 401 || status === 403)
			throw new ListUnreadable('That Trakt list is private');
		throw new ListUnreadable(`Trakt could not be read${status ? ` (${status})` : ''}`);
	}
}

/** Every page of a Trakt items endpoint; the page count rides in a response header. */
async function traktItems(path: string): Promise<any[]> {
	const items: any[] = [];
	for (let page = 1; ; page++) {
		const res = await traktGet(path, { page, limit: TRAKT_PAGE });
		items.push(...(Array.isArray(res.data) ? res.data : []));
		if (page >= Number(res.headers?.['x-pagination-page-count'] ?? 1)) break;
	}
	return items;
}

/** Trakt lists hold seasons, episodes and people too; only films and shows are titles. */
function traktTitles(items: any[]): { titles: ListTitle[]; noImdbId: number } {
	const titles: ListTitle[] = [];
	let noImdbId = 0;
	for (const item of items) {
		const kind = item?.type === 'movie' || item?.type === 'show' ? item.type : null;
		if (!kind) continue;
		const media = item[kind];
		const imdbId = media?.ids?.imdb;
		if (typeof imdbId !== 'string' || !IMDB_ID.test(imdbId)) {
			noImdbId++;
			continue;
		}
		titles.push({ imdbId, kind, title: String(media.title ?? imdbId) });
	}
	return { titles, noImdbId };
}

async function readTrakt(parsed: ParsedListUrl & { source: 'trakt' }): Promise<ListRead> {
	if (parsed.kind === 'watchlist') {
		// An unknown user's watchlist is `200 []`; only the profile says the user is missing or private.
		const profile = (await traktGet(`/users/${encodeURIComponent(parsed.user)}`)).data;
		if (profile?.private) {
			throw new ListUnreadable(
				`${parsed.user}'s Trakt profile is private, so the watchlist cannot be read. Make the profile public in Trakt's settings, or follow a public list instead`
			);
		}
		const base = `/users/${encodeURIComponent(parsed.user)}/watchlist`;
		const items = [
			...(await traktItems(`${base}/movies`)),
			...(await traktItems(`${base}/shows`)),
		];
		return { name: `${profile?.username ?? parsed.user}'s watchlist`, ...traktTitles(items) };
	}
	const base =
		parsed.kind === 'list'
			? `/users/${encodeURIComponent(parsed.user)}/lists/${encodeURIComponent(parsed.slug)}`
			: `/lists/${parsed.id}`;
	const info = (await traktGet(base)).data;
	const items = await traktItems(`${base}/items`);
	return { name: String(info?.name ?? parsed.label), ...traktTitles(items) };
}

async function readMdblist(parsed: ParsedListUrl & { source: 'mdblist' }): Promise<ListRead> {
	const client = getMdblistClient();
	let found;
	try {
		found = await client.getListByPath(parsed.user, parsed.slug);
	} catch (error) {
		const status = axios.isAxiosError(error) ? error.response?.status : undefined;
		if (status === 404) throw new ListUnreadable('MDBList has no such list');
		throw new ListUnreadable(`MDBList could not be read${status ? ` (${status})` : ''}`);
	}
	const list = found[0];
	if (!list) throw new ListUnreadable('MDBList has no such list');
	if (list.private) throw new ListUnreadable('That MDBList list is private');
	const titles: ListTitle[] = [];
	let noImdbId = 0;
	for (let offset = 0; ;) {
		let page;
		try {
			page = await client.getListItemsPage(list.id, offset);
		} catch {
			throw new ListUnreadable('MDBList could not be read');
		}
		const items = [
			...page.movies.map((item) => ({ item, kind: 'movie' as const })),
			...page.shows.map((item) => ({ item, kind: 'show' as const })),
		];
		for (const { item, kind } of items) {
			if (typeof item.imdb_id !== 'string' || !IMDB_ID.test(item.imdb_id)) {
				noImdbId++;
				continue;
			}
			titles.push({ imdbId: item.imdb_id, kind, title: String(item.title ?? item.imdb_id) });
		}
		offset += items.length;
		if (!items.length || !page.pagination?.has_more) break;
	}
	return { name: String(list.name ?? parsed.label), titles, noImdbId };
}

/** The list as it is now. Throws `ListUnreadable` with a message for the sponsor. */
export async function readList(parsed: ParsedListUrl): Promise<ListRead> {
	const read = parsed.source === 'trakt' ? await readTrakt(parsed) : await readMdblist(parsed);
	// A title listed twice is one title.
	const byId = new Map(read.titles.map((t) => [t.imdbId, t]));
	return { ...read, titles: [...byId.values()] };
}

export interface ListSyncResult {
	name: string;
	/** Films and shows on the list, IMDb-identified. */
	count: number;
	/** Of the titles new on the list since the last read. */
	added: number;
	alreadyWanted: number;
	overCap: number;
	noImdbId: number;
}

/**
 * Reads a followed list and wants what is new on it since the last read. Only
 * new ids are added, so a title the sponsor removed from the wanted list is not
 * put back, and a title that left the list stays wanted, as Radarr's import
 * lists behave. A read that fails is recorded on the row and rethrown.
 */
export async function syncWantedList(row: WantedListRow): Promise<ListSyncResult> {
	const parsed = parseListUrl(row.url);
	let read: ListRead;
	try {
		if (!parsed) throw new ListUnreadable('Not a Trakt or MDBList list URL');
		read = await readList(parsed);
	} catch (error) {
		await db.recordWantedListFailure(
			row.id,
			error instanceof ListUnreadable ? error.message : 'The list could not be read'
		);
		throw error;
	}
	const seen = new Set(row.seen);
	const fresh = read.titles.filter((t) => !seen.has(t.imdbId));
	const result = await db.wantMany(
		row.shortId,
		fresh.map((t) => ({ ...t, seasons: null }))
	);
	await db.recordWantedListRead(row.id, {
		name: read.name,
		seen: read.titles.map((t) => t.imdbId),
		added: row.added + result.added,
	});
	return { name: read.name, count: read.titles.length, noImdbId: read.noImdbId, ...result };
}

/** The cron's pass: the lists longest unread, a page of them per tick. */
export async function syncDueWantedLists(): Promise<{ synced: number; failed: number }> {
	let synced = 0;
	let failed = 0;
	for (const row of await db.dueWantedLists(LISTS_PER_TICK)) {
		try {
			await syncWantedList(row);
			synced++;
		} catch (error) {
			failed++;
			console.error(
				`[wantedLists] ${row.url}: ${error instanceof ListUnreadable ? error.message : error}`
			);
		}
	}
	return { synced, failed };
}
