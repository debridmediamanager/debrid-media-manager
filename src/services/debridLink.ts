/**
 * Debrid-Link API client.
 *
 * Debrid-Link is the best-behaved of the providers here - real HTTP status
 * codes, one consistent envelope, a published error taxonomy - so most of this
 * file is plain. Five of its behaviours are not plain at all, and each is
 * encoded here rather than left to callers (`docs/providers/debrid-link.md`,
 * measured 2026-09-02):
 *
 *  - **The `/v2` segment is part of the base, not part of a path.**
 *    `https://debrid-link.fr/api/account/infos` answers too, with a *different
 *    envelope* that carries no `success` field at all. A path-joining bug that
 *    drops the version therefore does not fail loudly, it silently moves onto
 *    an API this client cannot read. The version lives in the constant and
 *    endpoints are joined without a leading slash so nothing can rebase them.
 *  - **An unknown `ids=` filter returns the WHOLE list.**
 *    `GET /seedbox/list?ids=notarealid` answered with every torrent in the
 *    account. A client that fetches by filter and acts on the result - delete,
 *    reconcile, retry - acts on the entire library the moment one id goes
 *    stale. Every filtered read here is matched against the requested set
 *    client-side afterwards.
 *  - **A `floodDetected` costs that endpoint for an hour**, which is the most
 *    expensive throttle of any provider in this stack. Once it fires, this
 *    module stops calling that endpoint entirely rather than spending the hour
 *    collecting the same refusal.
 *  - **Removal never fails.** `DELETE /seedbox/<garbage>/remove` answers
 *    `{"success":true,"value":["<garbage>"]}`. The echoed array is what the
 *    server *tried*, not what existed, so a delete result is "attempted" and
 *    nothing more - re-list to find out.
 *  - **`status` is bit-flag-ish and `100` is not one of the flags.** The
 *    vendor's own sample carries `status: 6` (verification|downloading), so
 *    "finished" is `>= 100` and never an equality test.
 */

/** `/v2` is deliberately inside the base - see the note above. */
const DL_API_BASE = 'https://debrid-link.fr/api/v2';

const REQUEST_TIMEOUT_MS = 30_000;

/** Documented: "API rate limit reached for the endpoint, retry after 1 hour". */
export const FLOOD_LOCKOUT_MS = 60 * 60 * 1000;

/** `perPage` is documented min 20 / max 100. Paging costs requests; take the max. */
export const SEEDBOX_PAGE_SIZE = 100;

/**
 * A stop for `listAllSeedboxTorrents`. At the max page size this is 100,000
 * torrents, an order of magnitude past the largest library seen, so reaching it
 * means the cursor is not advancing rather than that the account is enormous.
 */
const MAX_PAGES = 1000;

/** 401. The session is gone: re-auth, or refresh if a refresh token is held. */
export const BAD_TOKEN = 'badToken';
/** The hour-long per-endpoint lockout. */
export const FLOOD_DETECTED = 'floodDetected';

/**
 * Documented torrent status enum. Treat these as flags: the vendor's own sample
 * shows `status: 6`, which is VERIFICATION|DOWNLOADING and equals none of them.
 * `FINISHED` is not a flag at all, which is why the completion test is `>=`.
 */
export const DL_STATUS = {
	PAUSED: 0,
	QUEUED: 1,
	VERIFICATION: 2,
	DOWNLOADING: 4,
	SEEDING: 8,
	FINISHED: 100,
} as const;

export interface DebridLinkPagination {
	page: number;
	pages: number;
	/** The next page number, or **-1** at the end of the list. */
	next: number;
	previous: number;
}

export interface DebridLinkEnvelope<T = unknown> {
	success: boolean;
	value?: T;
	pagination?: DebridLinkPagination;
	error?: string;
	error_description?: string;
	/** A support correlation id on every 4xx. Undocumented; carried, not shown. */
	error_id?: string;
}

export interface DebridLinkAccountInfo {
	username: string;
	/** Partially masked by the API, e.g. `p**d@deb*******k`. */
	email: string;
	emailVerified: boolean;
	/** 0 free, 1 premium. */
	accountType: number;
	/** **Seconds** of premium remaining, not a timestamp. */
	premiumLeft: number;
	/** Loyalty points. */
	pts: number;
	registerDate?: string;
	/** Account-level datacenter/VPN flag; enforcement is by flag, not per request. */
	serverDetected?: boolean;
	settings?: {
		https?: boolean;
		themeDark?: boolean;
		hideOldLinks?: boolean;
		/**
		 * Reflects the *caller*, not stored state: the same account read
		 * `"auto"` from one vantage and `"direct"` from another moments apart.
		 */
		cdn?: string;
	};
}

export interface DebridLinkFile {
	id: string;
	name: string;
	size: number;
	/**
	 * Keyless, IP-agnostic and durable: no token, signature or timestamp in the
	 * URL, and it keeps serving after the torrent is deleted. The whole
	 * capability is the torrent id, so these belong nowhere that logs URLs.
	 */
	downloadUrl: string;
	/** Per-file completion. This, not `downloaded`, is what "ready" means. */
	downloadPercent: number;
}

export interface DebridLinkTorrent {
	id: string;
	name: string;
	created: number;
	/** 40-char hex info hash. Present on every seedbox row. */
	hashString: string;
	uploadRatio: number;
	/** Observed empty on cached items - read the host off `downloadUrl` instead. */
	serverId: string;
	wait: boolean;
	peersConnected: number;
	/** See `DL_STATUS`; test completion with `isDlFinished`, never equality. */
	status: number;
	totalSize: number;
	downloadPercent: number;
	downloadSpeed: number;
	uploadSpeed: number;
	/** A torrent with many files lists as one ZIP - expand with `getSeedboxTorrent`. */
	isZip: boolean;
	srvMaint?: boolean;
	files: DebridLinkFile[];
	/** Rides on every torrent object; `0`/`""` when healthy. Not in the docs. */
	error?: number;
	errorString?: string;
	/**
	 * **Not completion.** It tracks whether the user has fetched the file (the
	 * webapp's `hideOldLinks` feature). `downloadPercent` is completion.
	 */
	downloaded?: boolean;
}

export interface DebridLinkActivity {
	status: number;
	downloadPercent: number;
	/** Percent per file, aligned by index with the list's `files`. */
	files: number[];
	zip?: unknown[];
	size?: number;
	uploadRatio?: number;
	peersConnected?: number;
	downloadSpeed?: number;
	uploadSpeed?: number;
	wait?: boolean;
}

export interface DebridLinkZip {
	/** `"ready"` on a cached torrent, answered instantly. */
	status: string;
	/** `…/zip/<zipid>/Name.zip`, keyless like every other Debrid-Link URL. */
	url?: string;
	[key: string]: unknown;
}

/** `{current, value}` per limit; `-1` means "not applicable". */
export interface DebridLinkLimit {
	current: number;
	value: number;
}

export type DebridLinkLimits = Record<string, DebridLinkLimit>;

export class DebridLinkError extends Error {
	readonly code: string;
	/** The `error_id` correlation stamp, when the API sent one. */
	readonly errorId?: string;
	/** Milliseconds left of a `floodDetected` lockout, when that is the code. */
	readonly retryAfterMs?: number;

	constructor(
		message: string,
		code: string = 'unknown_error',
		options: { errorId?: string; retryAfterMs?: number } = {}
	) {
		super(message);
		this.name = 'DebridLinkError';
		this.code = code;
		this.errorId = options.errorId;
		this.retryAfterMs = options.retryAfterMs;
	}
}

/**
 * Endpoints currently inside a `floodDetected` lockout, keyed by route
 * template, valued by the epoch ms the lockout ends.
 *
 * Module-level on purpose. The vendor locks the *endpoint* for an hour, so the
 * knowledge has to outlive the component that learned it - otherwise every
 * remount cheerfully spends another request finding out the same thing, and a
 * library page that polls turns one refusal into thousands.
 */
const floodLockouts = new Map<string, number>();

const resetFloodLockouts = () => floodLockouts.clear();

/** Milliseconds left of an endpoint's lockout; 0 when it is not locked. */
const floodLockoutRemainingMs = (endpoint: string): number => {
	const until = floodLockouts.get(endpoint);
	if (until === undefined) return 0;
	const remaining = until - Date.now();
	if (remaining > 0) return remaining;
	floodLockouts.delete(endpoint);
	return 0;
};

type DlMethod = 'GET' | 'POST' | 'DELETE';

interface DlCallOptions {
	method?: DlMethod;
	/**
	 * The concrete path, when it differs from the route template - a delete is
	 * `seedbox/<ids>/remove` but its flood identity is `seedbox/:ids/remove`.
	 */
	path?: string;
	query?: Record<string, string | number | boolean | undefined>;
	body?: Record<string, string | number | boolean | undefined>;
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

const toQueryString = (query: DlCallOptions['query']): string => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined) continue;
		params.append(key, String(value));
	}
	const encoded = params.toString();
	return encoded ? `?${encoded}` : '';
};

const toFormBody = (body: DlCallOptions['body']): string => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body ?? {})) {
		if (value === undefined) continue;
		params.append(key, String(value));
	}
	return params.toString();
};

/**
 * One Debrid-Link call, returning the unwrapped envelope.
 *
 * `endpoint` is the **route template** rather than the concrete path, because
 * that is what the vendor's flood lockout applies to: deleting torrent A and
 * deleting torrent B are one endpoint as far as the hour-long ban is concerned.
 */
async function dlRequest<T>(
	token: string,
	endpoint: string,
	options: DlCallOptions = {}
): Promise<{ value: T; pagination: DebridLinkPagination | null }> {
	if (!token) throw new DebridLinkError('Missing Debrid-Link token.', 'authentication_failed');

	// Self-defense, not politeness: while the vendor's hour is running, every
	// further call to this endpoint is refused anyway. Answer locally instead
	// of spending a round trip to be told again.
	const remaining = floodLockoutRemainingMs(endpoint);
	if (remaining > 0) {
		throw new DebridLinkError(
			`Debrid-Link rate-limited ${endpoint} - about ${Math.ceil(
				remaining / 60_000
			)} minute(s) of the one-hour lockout left.`,
			FLOOD_DETECTED,
			{ retryAfterMs: remaining }
		);
	}

	const path = options.path ?? endpoint;
	const method = options.method ?? 'GET';
	const body = options.body ? toFormBody(options.body) : undefined;

	return withTimeout(async (signal) => {
		const response = await fetch(`${DL_API_BASE}/${path}${toQueryString(options.query)}`, {
			method,
			headers: {
				// Header only. `?access_token=<token>` authenticates upstream and
				// is a live log-leak path - query strings land in access logs,
				// which is exactly how ten Real-Debrid keys got there.
				Authorization: `Bearer ${token}`,
				...(body === undefined
					? {}
					: { 'Content-Type': 'application/x-www-form-urlencoded' }),
			},
			...(body === undefined ? {} : { body }),
			signal,
		});

		// The doc-site Angular shell is served with HTTP 200 for unauthenticated
		// paths on this host, so a routing mistake can arrive as HTML under a
		// success status. Check the type before parsing, or that surfaces as a
		// SyntaxError from somewhere unrelated.
		const contentType = (response.headers.get('content-type') || '').toLowerCase();
		if (!contentType.includes('application/json')) {
			throw new DebridLinkError(
				`Debrid-Link answered ${response.status} with ${contentType || 'no content type'}`,
				'non_json_response'
			);
		}

		let parsed: unknown;
		try {
			parsed = await response.json();
		} catch {
			throw new DebridLinkError(
				`Debrid-Link answered ${response.status} with a body that is not JSON`,
				'non_json_response'
			);
		}

		const envelope = (parsed ?? {}) as DebridLinkEnvelope<T>;

		if (!response.ok || envelope.success !== true) {
			const code =
				typeof envelope.error === 'string' && envelope.error
					? envelope.error
					: response.status === 401
						? BAD_TOKEN
						: `http_${response.status}`;

			if (code === FLOOD_DETECTED) {
				floodLockouts.set(endpoint, Date.now() + FLOOD_LOCKOUT_MS);
			}

			throw new DebridLinkError(
				envelope.error_description || `Debrid-Link ${path} failed (${response.status})`,
				code,
				{
					errorId: envelope.error_id,
					retryAfterMs: code === FLOOD_DETECTED ? FLOOD_LOCKOUT_MS : undefined,
				}
			);
		}

		return { value: envelope.value as T, pagination: envelope.pagination ?? null };
	});
}

/**
 * `/seedbox/add` takes a magnet, a public torrent URL **or a bare hash** - and
 * a bare hash is only accepted when the content is already cached, which is the
 * closest thing Debrid-Link has to a cache probe now that `/seedbox/cached` is
 * disabled. Send the full magnet when the intent is "download this".
 */
export const toMagnetUri = (hashOrMagnet: string): string =>
	hashOrMagnet.startsWith('magnet:')
		? hashOrMagnet
		: `magnet:?xt=urn:btih:${hashOrMagnet.trim()}`;

/**
 * Whether a torrent is done.
 *
 * **`>=`, never `===`.** The lower states are flags that combine - the vendor's
 * own documentation sample carries `status: 6`, which is VERIFICATION(2) plus
 * DOWNLOADING(4) and equals no single enum member. Only `FINISHED` sits above
 * the flag range, so a threshold is the one test that cannot be fooled by a
 * combination the enum never spelled out.
 */
export const isDlFinished = (status: number): boolean => status >= DL_STATUS.FINISHED;

export const getDebridLinkAccountInfo = async (token: string): Promise<DebridLinkAccountInfo> => {
	const { value } = await dlRequest<DebridLinkAccountInfo>(token, 'account/infos');
	return value;
};

/** `accountType` is 0 free / 1 premium. A free account cannot use the seedbox. */
export const isDebridLinkPremium = (info: Pick<DebridLinkAccountInfo, 'accountType'>): boolean =>
	info.accountType === 1;

/** `premiumLeft` is **seconds**, so days are a division and never a date diff. */
export const debridLinkPremiumDaysLeft = (
	info: Pick<DebridLinkAccountInfo, 'premiumLeft'>
): number => (info.premiumLeft > 0 ? Math.floor(info.premiumLeft / 86_400) : 0);

/**
 * One page of the seedbox.
 *
 * When `ids` is passed the answer is **always** matched against the requested
 * set afterwards. This is not defensive tidying: an id Debrid-Link does not
 * recognise makes the filter vanish and the entire account come back, so a
 * caller that reconciles or deletes against an unfiltered result destroys the
 * library. An explicitly empty `ids` list short-circuits for the same reason -
 * dropping an empty filter would fetch everything.
 */
export async function listSeedboxTorrents(
	token: string,
	options: { page?: number; perPage?: number; ids?: string[] } = {}
): Promise<{ torrents: DebridLinkTorrent[]; pagination: DebridLinkPagination | null }> {
	const ids = options.ids?.map((id) => id.trim()).filter((id) => id.length > 0);
	if (options.ids && (!ids || ids.length === 0)) return { torrents: [], pagination: null };

	const { value, pagination } = await dlRequest<DebridLinkTorrent[]>(token, 'seedbox/list', {
		query: {
			page: options.page,
			perPage: options.perPage ?? SEEDBOX_PAGE_SIZE,
			ids: ids?.join(','),
			// The endpoint's own description spells the single-torrent
			// (ZIP-expanding) parameter `id` while its parameter table lists
			// only `ids`. Sending both costs nothing, and the client-side match
			// below makes it safe whichever one the server honours.
			id: ids?.length === 1 ? ids[0] : undefined,
		},
	});

	const torrents = Array.isArray(value) ? value : [];
	if (!ids) return { torrents, pagination };

	const wanted = new Set(ids);
	return { torrents: torrents.filter((torrent) => wanted.has(torrent.id)), pagination };
}

/**
 * Every torrent in the account, paged at the documented maximum.
 *
 * The list ends when `pagination.next` comes back as **-1**. A cursor that
 * fails to advance also ends it: without that guard a server repeating page 0
 * would spin forever, and Debrid-Link's punishment for a request loop is an
 * hour without the endpoint.
 */
export async function listAllSeedboxTorrents(
	token: string,
	perPage: number = SEEDBOX_PAGE_SIZE
): Promise<DebridLinkTorrent[]> {
	const all: DebridLinkTorrent[] = [];
	let page = 0;

	for (let fetched = 0; fetched < MAX_PAGES; fetched++) {
		const { torrents, pagination } = await listSeedboxTorrents(token, { page, perPage });
		all.push(...torrents);

		const next = pagination?.next;
		if (typeof next !== 'number' || next < 0 || next <= page) break;
		page = next;
	}

	return all;
}

/**
 * One torrent by id, with its full file list.
 *
 * This is the ZIP escape hatch: a torrent with many files lists as a single
 * `isZip: true` entry in the bulk listing and only expands when fetched on its
 * own. Returns null when the id is unknown - which, thanks to the filter trap,
 * is a *whole account* coming back and being filtered to nothing rather than an
 * error.
 */
export async function getSeedboxTorrent(
	token: string,
	id: string
): Promise<DebridLinkTorrent | null> {
	const { torrents } = await listSeedboxTorrents(token, { ids: [id] });
	return torrents[0] ?? null;
}

/**
 * Adds a magnet, a public torrent URL or a bare hash.
 *
 * Idempotent by hash **and the id is stable**: a bare-hash add, a magnet add, a
 * duplicate add and even a re-add after removal all return the same torrent id.
 * A double click therefore costs one wasted request and changes nothing, so
 * there is no dedup machinery here on purpose.
 *
 * A cached source answers synchronously complete - `status: 100` with live
 * download URLs, in about 150 ms - so the response alone says whether the user
 * can play it now.
 */
export async function addSeedboxTorrent(
	token: string,
	source: string,
	options: { wait?: boolean; structureType?: 'list' | 'tree'; ip?: string } = {}
): Promise<DebridLinkTorrent> {
	const url = source.trim();
	if (!url) throw new DebridLinkError('Nothing to add to Debrid-Link.', 'badArguments');

	const { value } = await dlRequest<DebridLinkTorrent>(token, 'seedbox/add', {
		method: 'POST',
		body: {
			url,
			wait: options.wait,
			structureType: options.structureType,
			ip: options.ip,
		},
	});
	return value;
}

/**
 * The cheap status poll: per-id status, percent and per-file percents, with
 * none of the list's metadata.
 *
 * Filtered the same way and guarded the same way - `ids` is a filter Debrid-Link
 * discards when it does not recognise an entry, so the answer is matched
 * client-side before it is returned.
 */
export async function getSeedboxActivity(
	token: string,
	ids?: string[]
): Promise<Record<string, DebridLinkActivity>> {
	const wanted = ids?.map((id) => id.trim()).filter((id) => id.length > 0);
	if (ids && (!wanted || wanted.length === 0)) return {};

	const { value } = await dlRequest<Record<string, DebridLinkActivity>>(
		token,
		'seedbox/activity',
		{ query: { ids: wanted?.join(','), perPage: SEEDBOX_PAGE_SIZE } }
	);

	const activity = value && typeof value === 'object' ? value : {};
	if (!wanted) return activity;

	const requested = new Set(wanted);
	return Object.fromEntries(
		Object.entries(activity).filter(([id]) => requested.has(id))
	) as Record<string, DebridLinkActivity>;
}

/**
 * Removes torrents. The result is what the server **attempted**, not what it
 * found: deleting a nonexistent id answers `success: true` echoing that id
 * back, and no error shape exists for "no such torrent". Treat a return value
 * as "asked", and re-list if the answer matters.
 */
export async function deleteSeedboxTorrents(token: string, ids: string[]): Promise<string[]> {
	const wanted = ids.map((id) => id.trim()).filter((id) => id.length > 0);
	// `seedbox//remove` is not a delete-nothing, it is an unknown route - and
	// there is no reason to find out what the server makes of it.
	if (wanted.length === 0) return [];

	const { value } = await dlRequest<string[]>(token, 'seedbox/:ids/remove', {
		method: 'DELETE',
		path: `seedbox/${wanted.map(encodeURIComponent).join(',')}/remove`,
	});
	return Array.isArray(value) ? value : [];
}

/**
 * Mints a zip of chosen files. Answers `status: "ready"` with a keyless URL
 * instantly for a cached torrent.
 */
export async function zipSeedboxTorrent(
	token: string,
	torrentId: string,
	fileIds: string[]
): Promise<DebridLinkZip> {
	const ids = fileIds.map((id) => id.trim()).filter((id) => id.length > 0);
	if (ids.length === 0) {
		throw new DebridLinkError('A zip needs at least one file id.', 'badArguments');
	}

	const { value } = await dlRequest<DebridLinkZip>(token, 'seedbox/:id/zip', {
		method: 'POST',
		path: `seedbox/${encodeURIComponent(torrentId)}/zip`,
		body: { ids: ids.join(',') },
	});
	return value;
}

/**
 * Quotas and usage: torrents per day/month, data per day/month, max torrent
 * size, active transfers, and `nextResetSeconds` for the daily reset.
 */
export async function getSeedboxLimits(token: string): Promise<DebridLinkLimits> {
	const { value } = await dlRequest<DebridLinkLimits>(token, 'seedbox/limits');
	return value && typeof value === 'object' ? value : {};
}

/** One hash's verdict from `checkDebridLinkCache`. */
export interface DebridLinkCacheResult {
	hash: string;
	/** Whether Debrid-Link can serve this content now. */
	cached: boolean;
	/**
	 * False when the sweep never got an answer for this hash - it ran into the
	 * hour-long lockout, hit the probe budget, or was aborted. A caller must
	 * not render "not cached" for these: nothing was learned about them.
	 */
	checked: boolean;
	/** The torrent id, for a hit. Stable across remove and re-add. */
	torrentId?: string;
	/** Total bytes, for a hit. Useful for repairing a scraped row's missing size. */
	filesize?: number;
	files?: DebridLinkFile[];
	/** True when this hash was already in the account before the sweep started. */
	alreadyInLibrary?: boolean;
	/** True when the probe created the torrent and the sweep removed it again. */
	removed?: boolean;
}

/** What a whole sweep did, so a caller can report and audit it. */
export interface DebridLinkCacheSweep {
	results: DebridLinkCacheResult[];
	/** Ids the sweep created and then asked to remove. */
	removedIds: string[];
	/**
	 * Ids the sweep created, asked to remove, and still found in the account
	 * afterwards. Debrid-Link's delete answers success for anything, so this is
	 * the only way to know - it is read back off a fresh listing.
	 */
	leftBehindIds: string[];
	/** True when the sweep stopped early because the endpoint got locked out. */
	floodLockedOut: boolean;
}

export interface DebridLinkCacheOptions {
	/**
	 * How many probes may run at once. Debrid-Link took 1,020 bare-hash adds at
	 * up to 327 req/s without a refusal (measured 2026-09-17), so this is not
	 * about the burst - it is about leaving the account's budget for the user's
	 * real adds. See `maxProbes`.
	 */
	concurrency?: number;
	/**
	 * A ceiling on how many hashes one sweep will probe. Hashes past it come
	 * back `checked: false`.
	 *
	 * The endpoint's hour-long lockout tripped at roughly 3,600 adds inside a
	 * few minutes (measured 2026-09-17), and the lockout blocks *cached* adds
	 * too - so overrunning it does not merely stop the badges, it stops the
	 * user adding anything at all for an hour. A page of results is ~100.
	 */
	maxProbes?: number;
	signal?: AbortSignal;
}

const DEFAULT_CACHE_CONCURRENCY = 4;
const DEFAULT_MAX_PROBES = 150;

const normalizeHash = (hash: string) => hash.trim().toLowerCase();

/**
 * Whether Debrid-Link can serve these hashes right now.
 *
 * **There is no cache endpoint.** `GET /seedbox/cached` answers
 * `400 endpointDisabled` for every parameter shape and the vendor's own API
 * description no longer lists it. What replaces it is a property of the add:
 * `/seedbox/add` accepts a **bare info hash**, and the documented contract for
 * that form is "the hash is only added if it is already cached on our servers".
 * So the add is the probe, and it is a good one - measured 2026-09-17 against
 * the same uncached hash, back to back:
 *
 *  - bare hash    -> `400 notAddTorrent` in 117 ms, account untouched, no quota
 *  - full magnet  -> `200` accepted, and one of the 50 daily uncached adds plus
 *                    one of the 20 active transfer slots reserved on the spot
 *
 * A hit costs nothing either: adding, re-adding and duplicating a cached hash
 * all left the daily and monthly counters untouched.
 *
 * **The catch is that a hit mutates.** The torrent lands in the user's library,
 * because being added is exactly what "it was cached" means here. So the sweep
 * reads the library first and removes only what it created - anything the user
 * already had is left alone, and never probed in the first place.
 *
 * Removal cannot be trusted from its own response (`DELETE` on a nonexistent id
 * answers `success: true` echoing that id back), so the sweep re-lists
 * afterwards and reports anything still there as `leftBehindIds` rather than
 * claiming a clean-up it cannot see.
 *
 * Three ways a hash comes back `checked: false`, and none of them mean "not
 * cached": the hour-long lockout fired, the probe budget ran out, or the caller
 * aborted.
 */
export async function checkDebridLinkCache(
	token: string,
	hashes: string[],
	options: DebridLinkCacheOptions = {}
): Promise<DebridLinkCacheSweep> {
	const {
		concurrency = DEFAULT_CACHE_CONCURRENCY,
		maxProbes = DEFAULT_MAX_PROBES,
		signal,
	} = options;

	const wanted: string[] = [];
	const seen = new Set<string>();
	for (const raw of hashes) {
		const hash = normalizeHash(raw);
		if (!hash || seen.has(hash)) continue;
		seen.add(hash);
		wanted.push(hash);
	}
	if (wanted.length === 0) {
		return { results: [], removedIds: [], leftBehindIds: [], floodLockedOut: false };
	}

	// What the user already has. A torrent already in the library is an answer
	// on its own - and probing it would be worse than pointless, because the
	// clean-up afterwards could not tell its torrent apart from ours.
	const existing = new Map<string, DebridLinkTorrent>();
	for (const torrent of await listAllSeedboxTorrents(token)) {
		const hash = normalizeHash(torrent.hashString || '');
		if (hash) existing.set(hash, torrent);
	}

	const results = new Map<string, DebridLinkCacheResult>();
	const createdIds: string[] = [];
	const toProbe: string[] = [];

	for (const hash of wanted) {
		const held = existing.get(hash);
		if (!held) {
			toProbe.push(hash);
			continue;
		}
		results.set(hash, {
			hash,
			cached: isDlFinished(held.status) || held.downloadPercent >= 100,
			checked: true,
			torrentId: held.id,
			filesize: held.totalSize,
			files: held.files,
			alreadyInLibrary: true,
		});
	}

	const budgeted = toProbe.slice(0, Math.max(0, maxProbes));
	for (const hash of toProbe.slice(budgeted.length)) {
		results.set(hash, { hash, cached: false, checked: false });
	}

	let floodLockedOut = false;
	let cursor = 0;

	const worker = async () => {
		for (;;) {
			if (floodLockedOut || signal?.aborted) return;
			const index = cursor++;
			if (index >= budgeted.length) return;
			const hash = budgeted[index];

			try {
				const torrent = await addSeedboxTorrent(token, hash);
				createdIds.push(torrent.id);
				results.set(hash, {
					hash,
					// Admission is not completion: a bare-hash add has been seen
					// admitted at 97%. Only a torrent the account reports whole
					// is something the user can play now.
					cached: isDlFinished(torrent.status) || torrent.downloadPercent >= 100,
					checked: true,
					torrentId: torrent.id,
					filesize: torrent.totalSize,
					files: torrent.files,
				});
			} catch (error) {
				const code = error instanceof DebridLinkError ? error.code : '';
				if (code === FLOOD_DETECTED) {
					// Every further add is refused for the hour anyway, and the
					// lockout covers the user's real adds too. Stop immediately
					// rather than spending the rest of the batch on refusals.
					floodLockedOut = true;
					return;
				}
				// `notAddTorrent` is the miss this whole function is built on.
				// `badArguments` is a hash the API would never take. Both are
				// answers; anything else is not, so it is not recorded as one.
				if (code === 'notAddTorrent' || code === 'badArguments') {
					results.set(hash, { hash, cached: false, checked: true });
				}
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(concurrency, budgeted.length)) }, worker)
	);

	// Anything the sweep never reached - the lockout fired, or it was aborted.
	for (const hash of budgeted) {
		if (!results.has(hash)) results.set(hash, { hash, cached: false, checked: false });
	}

	// Put the library back exactly as it was found. Only ids this sweep created
	// are removed; the user's own torrents were never probed.
	let leftBehindIds: string[] = [];
	if (createdIds.length > 0) {
		try {
			await deleteSeedboxTorrents(token, createdIds);
			// The delete response is "attempted", never "found", so the only
			// honest check is a fresh listing.
			const remaining = new Set(
				(await listAllSeedboxTorrents(token)).map((torrent) => torrent.id)
			);
			leftBehindIds = createdIds.filter((id) => remaining.has(id));
		} catch {
			// A clean-up that could not run is reported, not swallowed: these
			// are torrents this sweep put in someone's library.
			leftBehindIds = [...createdIds];
		}
		for (const result of results.values()) {
			if (result.torrentId && createdIds.includes(result.torrentId)) {
				result.removed = !leftBehindIds.includes(result.torrentId);
			}
		}
	}

	return {
		results: wanted.map((hash) => results.get(hash) ?? { hash, cached: false, checked: false }),
		removedIds: createdIds,
		leftBehindIds,
		floodLockedOut,
	};
}

export const _testing = {
	resetFloodLockouts,
	floodLockoutRemainingMs,
	toFormBody,
	toQueryString,
	DL_API_BASE,
	MAX_PAGES,
};
