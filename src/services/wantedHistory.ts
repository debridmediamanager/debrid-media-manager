import {
	CONTENT_REASONS,
	FAILED_REASONS,
	LOCAL_REASONS,
	type WantedEventInput,
	type WantedEventKind,
	type WantedSeasonProgress,
} from '@/services/database/wantedEvents';
import { decryptReleaseId } from '@/services/newznab/opaqueId';
import { nativeReleaseId, qualifyReleaseId } from '@/services/nzb2rd';

/**
 * The store prefix of NZBs zurgs upload for one another, keyed on the sha256 zurg
 * named the upload by. The Newznab grab serves `wanted:<sha>` as it serves any
 * stored release, so a hint's `nzb` is an ordinary grab URL. Not an indexer: the
 * admin page refuses it as an upstream's prefix.
 */
export const WANTED_NZB_PREFIX = 'wanted';

export const MAX_HISTORY_ITEMS = 20;
export const MAX_HISTORY_EVENTS = 200;

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_-]{1,64}$/;
const HASH = /^[0-9a-f]{40}$/;
export const NZB_SHA = /^[0-9a-f]{64}$/;
/** A Newznab grab token (base64url), as `x-dmm-id` names a posting. */
const TOKEN = /^[A-Za-z0-9_-]{1,512}$/;
const KINDS = ['grabbed', 'rejected', 'failed', 'removed'];
const RESOLUTIONS = ['', '480p', '720p', '1080p', '2160p'];
const MAX_SEASONS = 200;
const MAX_EPISODES = 2000;
/** An URL or a key in free text is an indexer's address or a secret: refused, never stored. */
const PRIVATE = /:\/\/|apikey/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface ParsedHistoryItem {
	id: string;
	seasons?: WantedSeasonProgress[];
	events: WantedEventInput[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Absent and `""` are the same; anything but a string is undefined. */
const text = (value: unknown): string | undefined =>
	value === undefined || value === null ? '' : typeof value === 'string' ? value : undefined;

function when(value: unknown): Date | undefined {
	if (typeof value !== 'string' || value.length > 40) return undefined;
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? undefined : at;
}

const whole = (value: unknown, max: number): value is number =>
	Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

function episodes(value: unknown): number[] | undefined {
	if (!Array.isArray(value) || value.length > MAX_EPISODES) return undefined;
	if (!value.every((n) => whole(n, 99999))) return undefined;
	return [...new Set(value as number[])].sort((a, b) => a - b);
}

function parseSeasons(raw: unknown): WantedSeasonProgress[] | string {
	if (!Array.isArray(raw) || raw.length > MAX_SEASONS) {
		return `"seasons" must be a list of at most ${MAX_SEASONS} seasons`;
	}
	const seen = new Set<number>();
	const out: WantedSeasonProgress[] = [];
	for (const s of raw) {
		const have = isObject(s) ? episodes(s.have ?? []) : undefined;
		const missing = isObject(s) ? episodes(s.missing ?? []) : undefined;
		if (!isObject(s) || !whole(s.season, 9999) || seen.has(s.season) || !have || !missing) {
			return `each of "seasons" is {"season", "have": [episodes], "missing": [episodes]}, a season once, at most ${MAX_EPISODES} episodes`;
		}
		seen.add(s.season);
		out.push({ season: s.season, have, missing });
	}
	return out.sort((a, b) => a.season - b.season);
}

/**
 * The posting a `dmm_id` token names. A token DMM cannot read (minted under another
 * secret) names nothing, so the event counts as an NZB from elsewhere.
 */
function postingOf(token: string): { dmmId: string } | { uploaded: string } | null {
	const release = decryptReleaseId(token);
	if (!release) return null;
	if (release.prefix === WANTED_NZB_PREFIX) {
		return NZB_SHA.test(release.nativeId) ? { uploaded: release.nativeId } : null;
	}
	const dmmId = qualifyReleaseId(release.prefix, nativeReleaseId(release.nativeId));
	return dmmId.length <= 255 ? { dmmId } : null;
}

function parseEvent(itemId: string, raw: unknown): WantedEventInput | string {
	if (!isObject(raw)) return 'is not an object';
	const { key, kind, torrent = false, pack = false } = raw;
	if (typeof key !== 'string' || !KEY.test(key)) {
		return '"key" must be 1-64 characters of A-Z, a-z, 0-9, ":", "_" and "-"';
	}
	const at = when(raw.at);
	if (!at) return '"at" must be an ISO 8601 time';
	if (typeof kind !== 'string' || !KINDS.includes(kind)) {
		return '"kind" must be "grabbed", "rejected", "failed" or "removed"';
	}
	const reason = text(raw.reason);
	const reasons =
		kind === 'grabbed'
			? ['']
			: kind === 'failed'
				? FAILED_REASONS
				: [...CONTENT_REASONS, ...LOCAL_REASONS];
	if (reason === undefined || !reasons.includes(reason)) {
		return kind === 'grabbed'
			? '"reason" must be empty for "grabbed"'
			: `"reason" must be one of ${reasons.join(', ')} for "${kind}"`;
	}
	const detail = text(raw.detail);
	if (detail === undefined || detail.length > 300) {
		return '"detail" must be a string of at most 300 characters';
	}
	const release = text(raw.release);
	if (release === undefined || release.length > 512 || (kind === 'grabbed' && !release)) {
		return '"release" must be a string of at most 512 characters, and is required for "grabbed"';
	}
	if (PRIVATE.test(detail) || PRIVATE.test(release)) {
		return '"detail" and "release" must not carry an URL or an API key';
	}
	if (CONTROL.test(detail) || CONTROL.test(release)) {
		return '"detail" and "release" must not carry control characters';
	}
	if (typeof torrent !== 'boolean') return '"torrent" must be true or false';
	if (typeof pack !== 'boolean') return '"pack" must be true or false';
	const hash = text(raw.hash);
	if (hash === undefined || (hash && !HASH.test(hash))) {
		return '"hash" must be 40 lowercase hex characters';
	}
	const nzb = text(raw.nzb);
	if (nzb === undefined || (nzb && !NZB_SHA.test(nzb))) {
		return '"nzb" must be 64 lowercase hex characters';
	}
	const token = text(raw.dmm_id);
	if (token === undefined || (token && !TOKEN.test(token))) {
		return '"dmm_id" must be a grab token';
	}
	if (torrent ? !!nzb || !!token : !!hash) {
		return 'a torrent carries "hash" only, an NZB "nzb" and "dmm_id" only';
	}
	const resolution = text(raw.resolution);
	if (resolution === undefined || !RESOLUTIONS.includes(resolution)) {
		return '"resolution" must be "", "480p", "720p", "1080p" or "2160p"';
	}
	const { size, season, episode } = raw;
	if (size != null && !(Number.isSafeInteger(size) && (size as number) >= 0)) {
		return '"size" must be a whole number of bytes';
	}
	if ((season != null && !whole(season, 9999)) || (episode != null && !whole(episode, 99999))) {
		return '"season" and "episode" must be whole numbers';
	}
	const posted = raw.posted == null || raw.posted === '' ? null : when(raw.posted);
	if (posted === undefined) return '"posted" must be an ISO 8601 time';

	const posting = token ? postingOf(token) : null;
	return {
		itemId,
		key,
		at,
		kind: kind as WantedEventKind,
		reason,
		detail,
		release,
		torrent,
		hash: hash || null,
		// An NZB another zurg uploaded is the same release under the sha it was uploaded as.
		nzb: (posting && 'uploaded' in posting ? posting.uploaded : nzb) || null,
		dmmId: posting && 'dmmId' in posting ? posting.dmmId : null,
		size: (size as number | null | undefined) ?? null,
		posted,
		season: (season as number | null | undefined) ?? null,
		episode: (episode as number | null | undefined) ?? null,
		pack,
		resolution,
	};
}

/** The body of POST /api/sponsor/wanted/history, or what is wrong with it. */
export function parseHistory(body: unknown): ParsedHistoryItem[] | string {
	const items = isObject(body) ? body.items : undefined;
	if (!Array.isArray(items) || items.length > MAX_HISTORY_ITEMS) {
		return `Expected {"items": [...]} with at most ${MAX_HISTORY_ITEMS} items`;
	}
	const out: ParsedHistoryItem[] = [];
	const seen = new Set<string>();
	let total = 0;
	for (const [i, item] of items.entries()) {
		if (!isObject(item) || typeof item.id !== 'string' || !ITEM_ID.test(item.id)) {
			return `items[${i}].id is not a wanted item id`;
		}
		const id = item.id.toLowerCase();
		if (seen.has(id)) return `items[${i}].id is listed twice`;
		seen.add(id);
		const rawEvents = item.events ?? [];
		if (!Array.isArray(rawEvents)) return `items[${i}].events must be a list`;
		total += rawEvents.length;
		if (total > MAX_HISTORY_EVENTS) {
			return `At most ${MAX_HISTORY_EVENTS} events a call`;
		}
		const parsed: ParsedHistoryItem = { id, events: [] };
		if (item.seasons !== undefined) {
			const seasons = parseSeasons(item.seasons);
			if (typeof seasons === 'string') return `items[${i}]: ${seasons}`;
			parsed.seasons = seasons;
		}
		for (const [j, raw] of rawEvents.entries()) {
			const event = parseEvent(id, raw);
			if (typeof event === 'string') return `items[${i}].events[${j}]: ${event}`;
			parsed.events.push(event);
		}
		out.push(parsed);
	}
	return out;
}
