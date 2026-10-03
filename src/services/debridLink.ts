import { toMagnetUri } from '@/utils/extractHashes';

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
	formData?: FormData;
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
	const body: BodyInit | undefined =
		options.formData ?? (options.body ? toFormBody(options.body) : undefined);

	return withTimeout(async (signal) => {
		const response = await fetch(`${DL_API_BASE}/${path}${toQueryString(options.query)}`, {
			method,
			headers: {
				// Header only. `?access_token=<token>` authenticates upstream and
				// is a live log-leak path - query strings land in access logs,
				// which is exactly how ten Real-Debrid keys got there.
				Authorization: `Bearer ${token}`,
				...(body === undefined || options.formData
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
 * How long a complete reading of the seedbox may stand in for a fresh one when
 * the cache check decides which torrents it created and may therefore remove.
 *
 * The check needs to know everything the account holds before it probes,
 * because a bare-hash add of a hash the user already has answers with *their*
 * torrent, and the clean-up would then delete it. Reading that from scratch
 * for every check cost a 52,685-torrent library 527 requests before each probe
 * and 527 more after it. So a complete reading is kept and reused, but never on
 * trust: before every probe run a library of more than one page is checked
 * against a current page 0 (`revalidateAgainstPageZero`), and anything this tab
 * adds or removes outside the check throws the reading away.
 *
 * This age is the backstop for what page 0 cannot see. It is counted from when
 * the reading *began*, matches the five minutes the library view already
 * treats a Debrid-Link listing as current for, and a page-0 check never
 * extends it - only a new full reading does.
 */
export const LIBRARY_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

/** What the cache check needs to remember about a torrent the account holds. */
interface HeldTorrent {
	id: string;
	status: number;
	downloadPercent: number;
	totalSize: number;
}

/** A complete reading of one account's seedbox. */
interface LibrarySnapshot {
	/** `Date.now()` when the walk that produced it began. */
	takenAt: number;
	/** Pages that walk read. One page is cheaper to re-read than to revalidate. */
	pages: number;
	/** The newest `created` (server seconds) among the torrents it holds. */
	newestCreated: number;
	ids: Set<string>;
	byHash: Map<string, HeldTorrent>;
	/**
	 * A couple of ids from the oldest end of the listing, which a filtered read
	 * carries alongside the ids it is asking about - see `confirmRemoved`.
	 */
	anchorIds: string[];
	/** `libraryGeneration` when the walk began. */
	generation: number;
}

/** Keyed by token. Module-level for the same reason the flood lockouts are. */
const librarySnapshots = new Map<string, LibrarySnapshot>();

/**
 * Bumped whenever this module changes a library outside the cache check. A
 * walk that began before the change cannot have seen it, so its reading is
 * never kept - it may lack the very torrent the change added.
 *
 * One counter for every account rather than one per token: a browser tab holds
 * one Debrid-Link token, and the server - whose Cast routes add torrents for
 * any number of users but never walk a library - must not accumulate a map
 * entry per user it has ever added for.
 */
let libraryGenerationCounter = 0;

const libraryGeneration = () => libraryGenerationCounter;

/** Something outside the cache check added to or removed from this library. */
const libraryChanged = (token: string) => {
	libraryGenerationCounter++;
	librarySnapshots.delete(token);
};

const resetLibrarySnapshots = () => {
	librarySnapshots.clear();
	libraryGenerationCounter = 0;
};

const normalizeHash = (hash: string) => hash.trim().toLowerCase();

const heldTorrent = (torrent: DebridLinkTorrent): HeldTorrent => ({
	id: torrent.id,
	status: torrent.status,
	downloadPercent: torrent.downloadPercent,
	totalSize: torrent.totalSize,
});

const rememberHeld = (snapshot: LibrarySnapshot, torrent: DebridLinkTorrent) => {
	if (!torrent.id) return;
	snapshot.ids.add(torrent.id);
	const hash = normalizeHash(torrent.hashString || '');
	if (hash && !snapshot.byHash.has(hash)) snapshot.byHash.set(hash, heldTorrent(torrent));
	if (typeof torrent.created === 'number' && torrent.created > snapshot.newestCreated) {
		snapshot.newestCreated = torrent.created;
	}
};

/** How many ids `anchorIds` keeps. One is enough; two survive a deletion. */
const VERIFY_ANCHORS = 2;

const buildSnapshot = (
	torrents: DebridLinkTorrent[],
	pages: number,
	takenAt: number,
	generation: number
): LibrarySnapshot => {
	const snapshot: LibrarySnapshot = {
		takenAt,
		pages,
		newestCreated: 0,
		ids: new Set(),
		byHash: new Map(),
		anchorIds: [],
		generation,
	};
	for (const torrent of torrents) rememberHeld(snapshot, torrent);
	snapshot.anchorIds = torrents
		.map((torrent) => torrent.id)
		.filter(Boolean)
		.slice(-VERIFY_ANCHORS);
	return snapshot;
};

/** Keeps a reading unless a change since its walk began could be missing from it. */
const storeSnapshot = (token: string, snapshot: LibrarySnapshot) => {
	const now = Date.now();
	for (const [key, held] of librarySnapshots) {
		if (now - held.takenAt > LIBRARY_SNAPSHOT_MAX_AGE_MS) librarySnapshots.delete(key);
	}
	if (snapshot.generation !== libraryGeneration()) return;
	const current = librarySnapshots.get(token);
	if (current && current.takenAt > snapshot.takenAt) return;
	librarySnapshots.set(token, snapshot);
};

/**
 * A kept reading young enough to reuse. A change made through this module has
 * already removed the token's reading (`libraryChanged`).
 */
const usableSnapshot = (token: string): LibrarySnapshot | null => {
	const snapshot = librarySnapshots.get(token);
	if (!snapshot) return null;
	if (Date.now() - snapshot.takenAt > LIBRARY_SNAPSHOT_MAX_AGE_MS) {
		librarySnapshots.delete(token);
		return null;
	}
	return snapshot;
};

interface SeedboxWalk {
	torrents: DebridLinkTorrent[];
	/**
	 * True only when the last page read said `next: -1`. A walk that stopped
	 * for any other reason - no pagination, a cursor that did not advance, the
	 * page cap - read part of the library, and absence from part of a library
	 * proves nothing.
	 */
	complete: boolean;
	snapshot: LibrarySnapshot;
}

/** Reads every page, and keeps the reading when it is complete. */
async function walkSeedbox(
	token: string,
	perPage: number = SEEDBOX_PAGE_SIZE
): Promise<SeedboxWalk> {
	const takenAt = Date.now();
	const generation = libraryGeneration();
	const all: DebridLinkTorrent[] = [];
	let page = 0;
	let pages = 0;
	let complete = false;

	for (let fetched = 0; fetched < MAX_PAGES; fetched++) {
		const { torrents, pagination } = await listSeedboxTorrents(token, { page, perPage });
		pages++;
		all.push(...torrents);

		const next = pagination?.next;
		if (next === -1) {
			complete = true;
			break;
		}
		if (typeof next !== 'number' || next <= page) break;
		page = next;
	}

	const snapshot = buildSnapshot(all, pages, takenAt, generation);
	if (complete) storeSnapshot(token, snapshot);
	return { torrents: all, complete, snapshot };
}

/**
 * Every torrent in the account, paged at the documented maximum.
 *
 * The list ends when `pagination.next` comes back as **-1**. A cursor that
 * fails to advance also ends it: without that guard a server repeating page 0
 * would spin forever, and Debrid-Link's punishment for a request loop is an
 * hour without the endpoint.
 *
 * A walk that reaches the end is also kept as the library reading the cache
 * check starts from, so a check soon after the library view loads does not
 * read all of it again.
 */
export async function listAllSeedboxTorrents(
	token: string,
	perPage: number = SEEDBOX_PAGE_SIZE
): Promise<DebridLinkTorrent[]> {
	return (await walkSeedbox(token, perPage)).torrents;
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
 * A bare hash is cached-only; a full magnet deliberately requests a download.
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
	try {
		return await postSeedboxAdd(token, source, options);
	} finally {
		// Even a failed add may have landed - a timeout says nothing about
		// what the server did - so any add outside the cache check retires
		// the library reading the check would otherwise trust.
		libraryChanged(token);
	}
}

/** The add itself, without retiring the library reading. The cache check probes with this. */
async function postSeedboxAdd(
	token: string,
	source: string,
	options: { wait?: boolean; structureType?: 'list' | 'tree'; ip?: string } = {}
): Promise<DebridLinkTorrent> {
	const url = source.trim();
	if (!url) throw new DebridLinkError('Nothing to add to Debrid-Link.', 'badArguments');

	const { value } = await dlRequest<DebridLinkTorrent>(token, 'seedbox/add', {
		method: 'POST',
		body: {
			url: /^magnet:/i.test(url) ? toMagnetUri(url) : url,
			wait: options.wait,
			structureType: options.structureType,
			ip: options.ip,
		},
	});
	return value;
}

/** Uploads the original .torrent file instead of converting it to a cached-only hash. */
export async function addSeedboxTorrentFile(token: string, file: File): Promise<DebridLinkTorrent> {
	const formData = new FormData();
	formData.append('file', file);
	try {
		const { value } = await dlRequest<DebridLinkTorrent>(token, 'seedbox/add', {
			method: 'POST',
			formData,
		});
		return value;
	} finally {
		libraryChanged(token);
	}
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
	try {
		return await removeSeedboxTorrents(token, ids);
	} finally {
		// The library reading would still list what was just removed. That
		// errs safe - the check would only skip a probe - but it would also
		// answer from a torrent that is gone.
		if (ids.some((id) => id.trim())) libraryChanged(token);
	}
}

/** The removal itself, without retiring the library reading. The cache check cleans up with this. */
async function removeSeedboxTorrents(token: string, ids: string[]): Promise<string[]> {
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
	/**
	 * The file list a probe answered with. A hash answered from the library
	 * reading has none: that reading is reused across checks, and keeping every
	 * file of a 50,000-torrent library alive for it is not worth the memory.
	 */
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
	 * afterwards - or could not confirm gone. Debrid-Link's delete answers
	 * success for anything, so this is read back off the account itself (see
	 * `confirmRemoved`).
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

/**
 * How many probes this tab will spend on `/seedbox/add` in any rolling hour.
 *
 * The per-sweep cap bounds one page; this bounds a session. `floodDetected`
 * tripped at roughly **3,640 adds inside about three minutes** (measured
 * 2026-09-17), and it is not a probing-only penalty - the lockout refuses
 * *cached* adds too, so overrunning it stops the user adding anything at all
 * for the next hour.
 *
 * At the per-sweep cap of 150 a reader would reach that ceiling in about
 * 24 pages, which is a plausible evening of browsing rather than an abusive
 * one. This sits at roughly a third of the observed ceiling, so a session can
 * fill it and still leave the account's own adds working.
 */
const PROBE_BUDGET_PER_HOUR = 1200;
const PROBE_BUDGET_WINDOW_MS = 60 * 60 * 1000;

/** Timestamps of probes this tab has spent, newest last. */
let probeSpend: number[] = [];

const probesLeftThisHour = (now = Date.now()) => {
	probeSpend = probeSpend.filter((at) => now - at < PROBE_BUDGET_WINDOW_MS);
	return Math.max(0, PROBE_BUDGET_PER_HOUR - probeSpend.length);
};

const recordProbes = (count: number, now = Date.now()) => {
	for (let i = 0; i < count; i++) probeSpend.push(now);
};

/**
 * Checks a kept library reading against a current page 0, folding in anything
 * added since. Returns null when page 0 cannot vouch for the reading.
 *
 * Every way a torrent enters the list puts it at the top: Debrid-Link lists
 * newest `created` first, and a new add, a re-add after removal (2026-09-12)
 * and a duplicate add of a torrent already held (2026-09-17) all came back
 * with a fresh `created` - 306-, 5- and 7-torrent listings recorded 2026-09-06,
 * -09-12 and -10-03. So once page 0 reaches back past the newest torrent the
 * reading holds, everything added since the reading is on it, and folding
 * those rows in makes the reading current again. Page 0 is never used to
 * conclude that something is *absent* - only the complete reading does that.
 *
 * If page 0 is all newer than the reading - a hundred adds since, or a burst in
 * the same second - it cannot say what lies beyond it, and the caller walks the
 * library again.
 */
function revalidateAgainstPageZero(
	snapshot: LibrarySnapshot,
	pageZero: DebridLinkTorrent[]
): LibrarySnapshot | null {
	const reachesBack = pageZero.some(
		(torrent) => typeof torrent.created === 'number' && torrent.created < snapshot.newestCreated
	);
	if (!reachesBack) return null;
	for (const torrent of pageZero) {
		if (torrent.id && !snapshot.ids.has(torrent.id)) rememberHeld(snapshot, torrent);
	}
	return snapshot;
}

/**
 * Everything the account holds, as the cache check needs it before probing.
 *
 * Reuses a kept reading when one is young enough and nothing in this tab has
 * changed the library since, and otherwise walks the library once. Either way
 * a library of more than one page is checked against a current page 0 last:
 * a walk of 527 pages takes minutes, and an add made meanwhile lands on the
 * page the walk read first. A one-page library is simply read again - that is
 * one request, the same as checking it.
 *
 * Returns null when the library could not be read to its end. Absence from a
 * partial listing proves nothing, and a probe of a hash the user holds answers
 * with their torrent, which the clean-up would then remove.
 */
async function libraryBeforeProbing(token: string): Promise<LibrarySnapshot | null> {
	let snapshot = usableSnapshot(token);
	if (!snapshot || snapshot.pages <= 1) {
		const walk = await walkSeedbox(token);
		if (!walk.complete) return null;
		snapshot = walk.snapshot;
		if (snapshot.pages <= 1) return snapshot;
	}

	const generation = libraryGeneration();
	const takenAt = Date.now();
	const { torrents, pagination } = await listSeedboxTorrents(token, { page: 0 });
	if (pagination?.next === -1) {
		// The whole library fits on page 0 now: that is a complete reading.
		const fresh = buildSnapshot(torrents, 1, takenAt, generation);
		storeSnapshot(token, fresh);
		return fresh;
	}
	const current = revalidateAgainstPageZero(snapshot, torrents);
	if (current) return current;

	const walk = await walkSeedbox(token);
	return walk.complete ? walk.snapshot : null;
}

/** The documented `ids=` maximum. */
const IDS_PER_FILTERED_READ = 100;

/**
 * Which of the torrents this sweep created are still in the account, read
 * without walking the library.
 *
 * Removal cannot be trusted from its own response (`DELETE` on a nonexistent id
 * answers `success: true` echoing it back), so this asks the account by id. A
 * filtered read is only an answer when the API says it is the only page -
 * `next: -1` on page 0. Then it is complete for what was asked: either the
 * filter held and every requested torrent that exists is on it, or the filter
 * was dropped and the whole account is on it. A dropped filter on a library
 * bigger than a page is page 0 of everything, which proves nothing about the
 * rest, so that falls back to one full walk.
 *
 * Each read also carries a couple of ids the account is known to hold. On
 * 2026-10-03 the filter held for ids that were well-formed but absent -
 * a removed torrent's id answered an empty list - and was dropped only for a
 * malformed one (`ids=notarealid` answered all seven torrents), while the
 * 2026-09-02 notes read it as dropped for any unknown id. The anchors keep the
 * filter in force under either reading, and a read that does not return one of
 * them is not taken as an answer either: something changed under it.
 *
 * Returns null when nothing could confirm the removal.
 */
async function confirmRemoved(
	token: string,
	createdIds: string[],
	snapshot: LibrarySnapshot
): Promise<Set<string> | null> {
	const created = new Set(createdIds);
	const anchors = snapshot.anchorIds.filter((id) => !created.has(id)).slice(0, VERIFY_ANCHORS);
	const anchorSet = new Set(anchors);
	const room = IDS_PER_FILTERED_READ - anchors.length;
	const remaining = new Set<string>();

	for (let i = 0; i < createdIds.length; i += room) {
		const chunk = createdIds.slice(i, i + room);
		const { torrents, pagination } = await listSeedboxTorrents(token, {
			page: 0,
			ids: [...anchors, ...chunk],
		});
		const answered =
			pagination?.next === -1 &&
			(anchors.length === 0 || torrents.some((torrent) => anchorSet.has(torrent.id)));
		if (!answered) {
			const walk = await walkSeedbox(token);
			if (!walk.complete) return null;
			const present = new Set(walk.torrents.map((torrent) => torrent.id));
			return new Set(createdIds.filter((id) => present.has(id)));
		}
		for (const torrent of torrents) {
			if (created.has(torrent.id)) remaining.add(torrent.id);
		}
	}
	return remaining;
}

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
 * knows the library first and removes only what it created - anything the user
 * already had is left alone, and never probed in the first place. Knowing the
 * library used to mean walking all of it before every check and again after
 * (`libraryBeforeProbing` and `confirmRemoved` say what replaced that), which
 * on a 52,685-torrent library was 1,054 listing requests for one hit.
 *
 * Removal cannot be trusted from its own response (`DELETE` on a nonexistent id
 * answers `success: true` echoing that id back), so the sweep reads the account
 * afterwards and reports anything still there as `leftBehindIds` rather than
 * claiming a clean-up it cannot see.
 *
 * Four ways a hash comes back `checked: false`, and none of them mean "not
 * cached": the hour-long lockout fired, the probe budget ran out, the caller
 * aborted, or the library could not be read to its end.
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
	const unanswered = (): DebridLinkCacheSweep => ({
		results: wanted.map((hash) => ({ hash, cached: false, checked: false })),
		removedIds: [],
		leftBehindIds: [],
		floodLockedOut: false,
	});
	if (wanted.length === 0) return unanswered();

	// What the user already has. A torrent already in the library is an answer
	// on its own - and probing it would be worse than pointless, because the
	// clean-up afterwards could not tell its torrent apart from ours.
	const library = await libraryBeforeProbing(token);
	if (!library) return unanswered();

	const results = new Map<string, DebridLinkCacheResult>();
	const createdIds: string[] = [];
	const createdHashes = new Map<string, string>();
	const toProbe: string[] = [];

	for (const hash of wanted) {
		const held = library.byHash.get(hash);
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
			alreadyInLibrary: true,
		});
	}

	// Two ceilings: what one sweep may spend, and what this tab may spend in an
	// hour. Whatever is left over is reported unanswered rather than uncached.
	const allowance = Math.min(Math.max(0, maxProbes), probesLeftThisHour());
	const budgeted = toProbe.slice(0, allowance);
	recordProbes(budgeted.length);
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
				const torrent = await postSeedboxAdd(token, hash);
				// Admission is not completion: a bare-hash add has been seen
				// admitted at 97%. Only a torrent the account reports whole is
				// something the user can play now.
				const cached = isDlFinished(torrent.status) || torrent.downloadPercent >= 100;
				// Ids are a stable function of the account and the hash, so an
				// add answering with an id the library already held answered
				// with the user's own torrent - one whose listing row did not
				// carry this hash. It is theirs, and it stays.
				const alreadyInLibrary = library.ids.has(torrent.id);
				if (!alreadyInLibrary) {
					createdIds.push(torrent.id);
					createdHashes.set(torrent.id, hash);
				}
				results.set(hash, {
					hash,
					cached,
					checked: true,
					torrentId: torrent.id,
					filesize: torrent.totalSize,
					files: torrent.files,
					...(alreadyInLibrary ? { alreadyInLibrary } : {}),
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
			await removeSeedboxTorrents(token, createdIds);
			// The delete response is "attempted", never "found", so the
			// account itself is asked what is still there.
			const remaining = await confirmRemoved(token, createdIds, library);
			// A removal nothing could confirm is reported as left behind.
			leftBehindIds = remaining
				? createdIds.filter((id) => remaining.has(id))
				: [...createdIds];
		} catch {
			// A clean-up that could not run is reported, not swallowed: these
			// are torrents this sweep put in someone's library.
			leftBehindIds = [...createdIds];
		}
		for (const result of results.values()) {
			if (result.torrentId && createdHashes.has(result.torrentId)) {
				result.removed = !leftBehindIds.includes(result.torrentId);
			}
		}

		// A concurrent check may have folded one of these probe torrents into
		// the kept reading off page 0 while it existed. What is confirmed gone
		// comes back out, so the next check probes it rather than answering
		// from a torrent that is not there. What stayed behind needs nothing:
		// it sits at the top of page 0, where the next check folds it in.
		const kept = librarySnapshots.get(token);
		if (kept) {
			for (const id of createdIds) {
				if (leftBehindIds.includes(id)) continue;
				const hash = createdHashes.get(id)!;
				kept.ids.delete(id);
				if (kept.byHash.get(hash)?.id === id) kept.byHash.delete(hash);
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
	resetLibrarySnapshots,
	resetProbeBudget: () => {
		probeSpend = [];
	},
	probesLeftThisHour,
	spendProbeBudget: recordProbes,
	PROBE_BUDGET_PER_HOUR,
	floodLockoutRemainingMs,
	toFormBody,
	toQueryString,
	DL_API_BASE,
	MAX_PAGES,
};
