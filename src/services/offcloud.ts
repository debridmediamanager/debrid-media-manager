/**
 * Offcloud API client.
 *
 * Offcloud publishes no API documentation at all, so everything here comes from
 * a live probe session (`docs/providers/offcloud.md`, 2026-09-02). Five of its
 * behaviours are load-bearing and are encoded here rather than left to callers:
 *
 *  - **The browser calls Offcloud directly.** CORS is wide open
 *    (`Access-Control-Allow-Origin: *`, preflight allows `authorization`), so
 *    unlike Premiumize there is no proxy. The key travels in the header and
 *    never in the query string - `?key=` also works upstream and is exactly the
 *    leak path that put ten Real-Debrid keys in the nginx access logs.
 *  - **Not every answer is JSON.** An unknown path under `/api/` returns
 *    Offcloud's HTML 404 page and a wrong verb returns Symfony's HTML 405 page,
 *    both with 200-family content types. A JSON-assuming client throws on the
 *    parse rather than on the status, so the content type is checked first.
 *  - **The two cache endpoints disagree about their input.** `/cache` takes bare
 *    hashes; `/cache/info` **silently reports cached content as uncached** when
 *    given one. `getOffcloudCacheInfo` refuses anything it cannot put into full
 *    magnet form.
 *  - **`/cache` answers with hits only.** There is no per-item answer to line
 *    up, so results are built by set membership and misses by set difference.
 *  - **A garbage magnet is accepted.** `magnet:?xt=urn:btih:zzzz` returns a
 *    requestId and parks in `created`/"Loading..." forever, so `isValidBtih`
 *    has to refuse it before the add rather than after.
 *
 * The cached-torrent backend is measured to be Premiumize's storage - same
 * energycdn objects, caches identical to the hash. The probes are kept
 * independent anyway: one vendor's outage is not the other's.
 */

const OC_API_BASE = 'https://offcloud.com/api';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `/api/cache` swallowed 5,000 hashes in 2.1 s without complaint, and no rate
 * limit was found at 96 req/s. This chunk is politeness plus headroom against a
 * limit that is off rather than absent.
 */
export const CACHE_CHECK_CHUNK_SIZE = 1000;

/** A 40-char hex info hash. */
const BTIH_HEX = /^[0-9a-fA-F]{40}$/;
/** A 32-char base32 info hash - RFC 4648 alphabet, no digits 0/1/8/9. */
const BTIH_BASE32 = /^[A-Za-z2-7]{32}$/;

/** Status enum recovered from StremThru; `created` and `downloaded` seen live. */
export type OffcloudStatus =
	| 'created'
	| 'queued'
	| 'downloading'
	| 'downloaded'
	| 'error'
	| 'canceled'
	| (string & {});

export interface OffcloudAccountInfo {
	user_id: string;
	email: string;
	is_premium: boolean;
	/** `YYYY-MM-DD`, not a unix timestamp. */
	expiration_date: string;
	can_download: boolean;
}

export interface OffcloudCacheResult {
	hash: string;
	cached: boolean;
}

export interface OffcloudCacheInfoFile {
	/**
	 * The containing directory as a `/`-joined path, normalised by
	 * `normalizeCacheInfoFolder` - the wire form is an **array of path
	 * segments**, not a string.
	 */
	folder: string;
	filename: string;
	size: number;
}

export interface OffcloudCacheInfoResult {
	/** The magnet actually sent, not the caller's input. */
	source: string;
	cached: boolean;
	files: OffcloudCacheInfoFile[];
}

export interface OffcloudAddResult {
	requestId: string;
	fileName: string;
	status: OffcloudStatus;
	/**
	 * Offcloud's *resolved* source, not an echo of the input: a minimal magnet
	 * comes back canonicalised with trackers and webseeds, and a torrent URL
	 * comes back as `<hash>.torrent`. Never diff this against what you sent.
	 */
	originalLink: string;
	site?: string;
	createdOn?: string;
}

export interface OffcloudCloudStatus {
	requestId: string;
	status: OffcloudStatus;
	fileName: string;
	/** `null` on a finished item. */
	progress: number | null;
	/** `null` on a finished item; `"Loading..."` on a zombie. */
	message: string | null;
}

export interface OffcloudHistoryItem {
	requestId: string;
	fileName: string;
	status: OffcloudStatus;
	originalLink: string;
	createdOn?: string;
	isDirectory?: boolean;
	server?: string;
}

/** One explore link paired with whatever `cache/info` knew about that file. */
export interface OffcloudFile {
	link: string;
	filename: string;
	folder: string | null;
	size: number | null;
}

export class OffcloudError extends Error {
	readonly code: string;

	constructor(message: string, code: string = 'unknown_error') {
		super(message);
		this.name = 'OffcloudError';
		this.code = code;
	}
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * One Offcloud call, with the guarantees the API does not give.
 *
 * The content type is inspected **before** the body is parsed: Offcloud answers
 * an unknown path with its HTML 404 page and a wrong verb with Symfony's HTML
 * 405 page, and both carry a 200-family content type. Parsing first turns a
 * routing mistake into a `SyntaxError` from somewhere unrelated.
 */
async function ocRequest<T>(
	apiKey: string,
	path: string,
	body?: Record<string, unknown>
): Promise<T> {
	if (!apiKey) throw new OffcloudError('Missing Offcloud API key.', 'authentication_failed');

	return withTimeout(async (signal) => {
		const response = await fetch(`${OC_API_BASE}/${path}`, {
			method: body ? 'POST' : 'GET',
			headers: {
				// Header only. `?key=<key>` authenticates upstream and is a leak
				// path - query strings land in access logs.
				Authorization: `Bearer ${apiKey}`,
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
			signal,
		});

		const contentType = (response.headers.get('content-type') || '').toLowerCase();
		if (!contentType.includes('application/json')) {
			throw new OffcloudError(
				`Offcloud answered ${response.status} with ${contentType || 'no content type'}`,
				'non_json_response'
			);
		}

		let parsed: unknown;
		try {
			parsed = await response.json();
		} catch {
			throw new OffcloudError(
				`Offcloud answered ${response.status} with a body that is not JSON`,
				'non_json_response'
			);
		}

		// A 500 from the add endpoint comes back as a bare JSON string carrying
		// the upstream failure ("Error parsing url - HTTP code: 404 ").
		if (typeof parsed === 'string') {
			if (!response.ok) throw new OffcloudError(parsed, `http_${response.status}`);
			return parsed as T;
		}

		const envelope = (parsed ?? {}) as Record<string, unknown>;
		const error = typeof envelope.error === 'string' ? envelope.error : null;

		// `error` never appears on a successful payload, so it is treated as a
		// failure whatever the status - covering the possibility that Offcloud
		// grows TorBox's habit of reporting failures as HTTP 200.
		if (error || !response.ok) {
			const code = error || (response.status === 401 ? 'NOAUTH' : `http_${response.status}`);
			// `NOAUTH` is returned for a missing, malformed and revoked key
			// alike - there is no oracle telling them apart.
			throw new OffcloudError(error || `Offcloud ${path} failed (${response.status})`, code);
		}

		return parsed as T;
	});
}

/**
 * Whether a string is a usable BitTorrent info hash.
 *
 * Offcloud accepts `magnet:?xt=urn:btih:zzzz` with a 200 and a requestId, then
 * parks it in `created` with `message: "Loading..."` indefinitely. Nothing
 * upstream ever rejects it, so the refusal has to happen here.
 */
export const isValidBtih = (hash: string): boolean => {
	const trimmed = hash.trim();
	return BTIH_HEX.test(trimmed) || BTIH_BASE32.test(trimmed);
};

/**
 * The info hash a source string carries, lowercased, or null if it carries none.
 *
 * Two forms, because `originalLink` on a cloud item is Offcloud's **resolved**
 * source rather than an echo of the input:
 *
 *  - a magnet, canonicalised with trackers and webseeds - the usual case;
 *  - `<hash>.torrent`, which is what a torrent-file URL is rewritten to.
 *
 * The second form is the whole reason a library row built from a `.torrent`
 * submission has a hash at all: without it those rows share nothing, group under
 * the empty string and lose their magnet-shaped actions. Only the 40-char hex
 * spelling is accepted there - a base32 info hash is indistinguishable from an
 * ordinary 32-character release name, and guessing wrong would invent a hash.
 */
export const extractBtih = (source: string): string | null => {
	const magnet = /urn:btih:([a-zA-Z0-9]{32,40})/.exec(source);
	if (magnet) return isValidBtih(magnet[1]) ? magnet[1].toLowerCase() : null;

	const torrentFile = /(?:^|[/\\])([0-9a-fA-F]{40})\.torrent(?:$|[?#])/.exec(source);
	return torrentFile ? torrentFile[1].toLowerCase() : null;
};

/** `/cache/info` and `/cloud` want a magnet; only `/cache` takes a bare hash. */
export const toMagnetUri = (hashOrMagnet: string): string =>
	hashOrMagnet.startsWith('magnet:')
		? hashOrMagnet
		: `magnet:?xt=urn:btih:${hashOrMagnet.trim()}`;

/** The reverse: what `/cache` wants, from either form. */
const toBareHash = (hashOrMagnet: string): string =>
	(hashOrMagnet.startsWith('magnet:')
		? (extractBtih(hashOrMagnet) ?? '')
		: hashOrMagnet.trim()
	).toLowerCase();

/**
 * `cache/info` reports a file's directory as an **array of path segments**, not
 * a string - `{"folder": ["Big Buck Bunny"], "filename": "Big Buck Bunny.mp4"}`
 * (measured live 2026-09-03 against the reference release). Handing that array
 * on unconverted crashed every consumer that builds a path from it with
 * `TypeError: value.replace is not a function`, which is the whole Offcloud cast
 * surface plus the library modal and the watch intent: each of them turns the
 * folder into a stored path through `offcloudFilePath`.
 *
 * A plain string is accepted too, because nothing in Offcloud's undocumented API
 * promises the array form will stay - and a single string is the shape everyone
 * downstream was written against.
 */
const normalizeCacheInfoFolder = (folder: unknown): string => {
	if (Array.isArray(folder)) {
		return folder
			.map((segment) => String(segment ?? '').replace(/^\/+|\/+$/g, ''))
			.filter((segment) => segment.length > 0 && segment !== '.')
			.join('/');
	}
	return typeof folder === 'string' ? folder : '';
};

const basenameOf = (link: string): string => {
	const raw = (() => {
		try {
			return new URL(link).pathname.split('/').filter(Boolean).pop() ?? '';
		} catch {
			return link.split('?')[0].split('/').pop() ?? '';
		}
	})();
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
};

export const getOffcloudAccountInfo = (apiKey: string): Promise<OffcloudAccountInfo> =>
	ocRequest<OffcloudAccountInfo>(apiKey, 'account/info');

/** The account has to be premium; a free one cannot download at all. */
export const isOffcloudPremium = (info: Pick<OffcloudAccountInfo, 'is_premium'>): boolean =>
	info.is_premium === true;

/**
 * Batch cache probe. Non-destructive - nothing is added to the account - and
 * `/cache` takes bare hashes, unlike its `/cache/info` sibling.
 *
 * The reply is `{"cachedItems": [...]}` carrying **hits only**: misses are
 * filtered out server-side rather than answered `false`. That makes a
 * positional zip impossible to get wrong, but it also means "not cached" is a
 * set difference and never an absent answer. Anything Offcloud volunteers that
 * was not asked about is ignored by construction.
 */
export async function checkOffcloudCache(
	apiKey: string,
	hashes: string[]
): Promise<OffcloudCacheResult[]> {
	const items = hashes.map(toBareHash).filter((hash) => hash.length > 0);
	if (items.length === 0) return [];

	const results: OffcloudCacheResult[] = [];
	for (let start = 0; start < items.length; start += CACHE_CHECK_CHUNK_SIZE) {
		const chunk = items.slice(start, start + CACHE_CHECK_CHUNK_SIZE);
		const body = await ocRequest<{ cachedItems?: string[] }>(apiKey, 'cache', {
			hashes: chunk,
		});

		// An absent array is the same statement as an empty one here, because
		// the endpoint only ever reports hits.
		const cached = new Set(
			(Array.isArray(body.cachedItems) ? body.cachedItems : []).map((hash) =>
				String(hash).trim().toLowerCase()
			)
		);
		for (const hash of chunk) {
			results.push({ hash, cached: cached.has(hash) });
		}
	}
	return results;
}

/**
 * Cache probe **with a file listing** - folder, filename and byte size per
 * file, without adding anything. This is strictly more than Premiumize's own
 * `cache/check` returns even though it is the same cache underneath, and it is
 * the best "what would I get" probe of any provider measured.
 *
 * Every input goes out in full magnet form. A bare hash here does not error, it
 * answers `cached: false` for content that is cached - the most dangerous kind
 * of wrong answer, and the reason anything that is neither a magnet nor a valid
 * info hash is refused outright rather than sent and hoped for.
 */
export async function getOffcloudCacheInfo(
	apiKey: string,
	hashesOrMagnets: string[],
	includeFiles = true
): Promise<OffcloudCacheInfoResult[]> {
	const urls = hashesOrMagnets.map((source) => {
		const trimmed = source.trim();
		if (!trimmed.startsWith('magnet:') && !isValidBtih(trimmed)) {
			throw new OffcloudError(
				`cache/info needs a magnet or an info hash, got "${trimmed}"`,
				'invalid_info_hash'
			);
		}
		return toMagnetUri(trimmed);
	});
	if (urls.length === 0) return [];

	const body = await ocRequest<Array<{ cached?: boolean; files?: unknown }>>(
		apiKey,
		'cache/info',
		{ urls, includeFiles }
	);

	if (!Array.isArray(body) || body.length !== urls.length) {
		throw new OffcloudError(
			`cache/info returned ${Array.isArray(body) ? body.length : 'a non-array'} answers for ${urls.length} urls`,
			'misaligned_response'
		);
	}

	return urls.map((source, i) => {
		const raw = body[i]?.files;
		return {
			source,
			cached: body[i]?.cached === true,
			files: (Array.isArray(raw) ? raw : []).map((file) => {
				const entry = (file ?? {}) as Record<string, unknown>;
				return {
					// The wire form is an array of path segments - see
					// `normalizeCacheInfoFolder`.
					folder: normalizeCacheInfoFolder(entry.folder),
					filename: typeof entry.filename === 'string' ? entry.filename : '',
					size: typeof entry.size === 'number' ? entry.size : 0,
				};
			}),
		};
	});
}

/**
 * Submits a magnet, a torrent-file URL or a plain HTTP URL to the cloud.
 *
 * A cached magnet answers `status: "downloaded"` synchronously in this very
 * response - Premiumize-style instant finish - so a caller does not have to
 * poll to know it worked. Idempotent while the item lives: re-submitting the
 * same magnet returns the same `requestId`. After removal the same magnet gets
 * a new one.
 */
export function addOffcloudCloud(apiKey: string, source: string): Promise<OffcloudAddResult> {
	const trimmed = source.trim();
	const looksLikeUrl = /^https?:\/\//i.test(trimmed);
	if (!looksLikeUrl) {
		// Magnet or bare hash: validate before spending a requestId on a zombie.
		const hash = trimmed.startsWith('magnet:') ? extractBtih(trimmed) : trimmed;
		if (!hash || !isValidBtih(hash)) {
			throw new OffcloudError(
				`"${trimmed}" is not a valid info hash or magnet.`,
				'invalid_info_hash'
			);
		}
	}
	return ocRequest<OffcloudAddResult>(apiKey, 'cloud', {
		url: looksLikeUrl ? trimmed : toMagnetUri(trimmed),
	});
}

/**
 * One item per call. `requestIds` (plural) is rejected with
 * `400 Missing required parameter: requestId`; no batching form was found.
 */
export async function getOffcloudCloudStatus(
	apiKey: string,
	requestId: string
): Promise<OffcloudCloudStatus> {
	const body = await ocRequest<{ status?: OffcloudCloudStatus }>(apiKey, 'cloud/status', {
		requestId,
	});
	if (!body?.status) {
		throw new OffcloudError(`cloud/status returned no status for ${requestId}`, 'no_status');
	}
	return body.status;
}

/**
 * A **bare array of signed CDN URLs**, one per file - no names, no sizes, no
 * ids. Pair it with `getOffcloudCacheInfo` through `joinExploreWithCacheInfo`
 * when metadata is needed.
 */
export async function exploreOffcloudCloud(apiKey: string, requestId: string): Promise<string[]> {
	const body = await ocRequest<unknown>(apiKey, `cloud/explore/${encodeURIComponent(requestId)}`);
	if (!Array.isArray(body)) {
		throw new OffcloudError(
			`cloud/explore returned ${typeof body}, expected an array of links`,
			'unexpected_response'
		);
	}
	return body.filter((link): link is string => typeof link === 'string');
}

/** The account's cloud items, newest first. Carries no sizes. */
export async function getOffcloudHistory(apiKey: string): Promise<OffcloudHistoryItem[]> {
	const body = await ocRequest<unknown>(apiKey, 'cloud/history');
	return Array.isArray(body) ? (body as OffcloudHistoryItem[]) : [];
}

/**
 * DESTRUCTIVE, AND IT IS A **GET**.
 *
 * `GET /api/cloud/remove/<id>` deletes the item, immediately and completely.
 * That means anything which follows URLs - a prefetcher, a link expander, a log
 * scraper, a chat client unfurling a link, a browser speculative fetch - can
 * destroy a user's items just by resolving one. Never render this URL as an
 * `href`, never log it, never put it anywhere that resolves links. Call it, and
 * only from an explicit user action.
 */
export const removeOffcloudCloud = (
	apiKey: string,
	requestId: string
): Promise<{ success?: boolean }> =>
	ocRequest(apiKey, `cloud/remove/${encodeURIComponent(requestId)}`);

/**
 * Pairs explore's anonymous links with cache/info's named files.
 *
 * Explore gives links and nothing else; cache/info gives names, folders and
 * sizes and no links. The only thing both sides carry is the filename, which
 * sits URL-encoded at the end of the CDN path. Duplicate filenames in different
 * folders are matched one-for-one in order rather than all pointing at the
 * first match, and a link with no metadata still comes back with its decoded
 * basename so a picker has something to show.
 */
export function joinExploreWithCacheInfo(
	links: string[],
	files: OffcloudCacheInfoFile[]
): OffcloudFile[] {
	const byName = new Map<string, OffcloudCacheInfoFile[]>();
	for (const file of files) {
		const bucket = byName.get(file.filename);
		if (bucket) bucket.push(file);
		else byName.set(file.filename, [file]);
	}

	return links.map((link) => {
		const filename = basenameOf(link);
		const match = byName.get(filename)?.shift();
		return {
			link,
			filename,
			folder: match?.folder ?? null,
			size: typeof match?.size === 'number' ? match.size : null,
		};
	});
}

export const _testing = { toBareHash, basenameOf, normalizeCacheInfoFolder, OC_API_BASE };
