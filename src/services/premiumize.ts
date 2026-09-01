/**
 * Premiumize API client.
 *
 * Premiumize is not shaped like the other three services and the differences
 * are load-bearing, so they are encoded here rather than left to callers:
 *
 *  - **Everything goes through a server-side proxy in the browser.** Premiumize's
 *    CORS preflight approves no headers, so a cross-origin `Authorization` header
 *    is blocked and the only browser-usable transports put the API key in the
 *    URL. `/api/premiumize/*` keeps it in a header. Server-side callers talk to
 *    Premiumize directly.
 *  - **The HTTP status is not the result.** Business errors arrive as HTTP 200
 *    with `{"status":"error"}`, and three failure modes are not JSON at all.
 *  - **`transient_error` carries no retry information.** A deleted file, a
 *    foreign folder and a missing parameter all report it, so nothing here
 *    retries on it.
 *  - **`cache/check` is the only cache oracle.** A `transfer/directdl` error code
 *    never means "cache miss" - the same miss reports as both `transient_error`
 *    and `service_unsupported`.
 */

const PM_API_BASE = 'https://www.premiumize.me/api';
const PM_PROXY_BASE = '/api/premiumize';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The real ceiling on `cache/check` is a ~30 second request budget, not an item
 * count: 5,466 items succeeded on one day and failed on another. Chunking here
 * keeps every batch an order of magnitude away from it.
 */
export const CACHE_CHECK_CHUNK_SIZE = 1000;

/** Premiumize CDN links all live under this host. */
const ENERGY_CDN_SUFFIX = '.energycdn.com';

/** Virtual proxy endpoint that resolves transfer ids to info hashes. */
const HASHES_ENDPOINT = 'transfer/hashes';

// `job/src` is one request per transfer. Premiumize absorbed 640 req/s without
// throttling, so this cap is politeness rather than a measured limit.
const HASH_LOOKUP_CONCURRENCY = 8;

export type PremiumizeEnvelope = Record<string, any> & {
	status: 'success' | 'error';
	message?: string;
	code?: string;
};

export type PremiumizeTransferStatus =
	| 'queued'
	| 'running'
	| 'finished'
	| 'seeding'
	| 'error'
	| (string & {});

export interface PremiumizeAccountInfo {
	customer_id: string;
	/** Unix seconds, or null on a free account. */
	premium_until: number | null;
	/** Fraction of the rolling 1000-point fair-use pool. 1 point = 1 GiB. */
	limit_used: number;
	space_used: number;
	booster_points: number;
}

export interface PremiumizeTransfer {
	id: string;
	name: string;
	/** Documented as an empty string, `null` in production. */
	message: string | null;
	status: PremiumizeTransferStatus;
	/** Documented as 0.0-1.0, `null` in production. */
	progress: number | null;
	/** Set for a multi-file source; null for a single file or an external cloud. */
	folder_id: string | null;
	/** Set for a single-file source; null for a folder or an external cloud. */
	file_id: string | null;
	other_cloud_id?: string | null;
	src?: string;
}

export interface PremiumizeFolderEntry {
	id: string;
	name: string;
	type: 'file' | 'folder';
	size?: number;
	created_at?: number;
	mime_type?: string;
	crc32?: string;
	link?: string | null;
	directlink?: string | null;
	stream_link?: string | null;
	unpackable?: boolean;
}

export interface PremiumizeFolderListing {
	content: PremiumizeFolderEntry[];
	name: string;
	parent_id: string | null;
	folder_id: string;
}

export interface PremiumizeItem {
	id: string;
	name: string;
	created_at: number;
	size: number;
	mime_type?: string;
	virus_scan?: string;
	/** `Folder/file.mkv` for a foldered item, bare `file.mkv` at the root. */
	path: string;
}

export interface PremiumizeDirectDownloadFile {
	path: string;
	/** `null` when Premiumize handed your own URL back instead of resolving it. */
	size: number | null;
	link: string;
	stream_link: string | null;
	transcode_status?: string;
}

export interface PremiumizeCacheResult {
	hash: string;
	cached: boolean;
	filename: string | null;
	/** Bytes. Premiumize reports this as a string on a hit and `0` on a miss. */
	filesize: number | null;
}

export class PremiumizeError extends Error {
	readonly code: string;

	constructor(message: string, code: string = 'unknown_error') {
		super(message);
		this.name = 'PremiumizeError';
		this.code = code;
	}
}

const isServer = () => typeof window === 'undefined';

/**
 * Premiumize takes repeated `items[]` keys, so requests cannot be JSON. Arrays
 * go out in wire order because `items[N]` subscripts are ignored server-side -
 * the order values are sent is the order answers come back in.
 */
function toFormBody(params: Record<string, unknown>): string {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			for (const entry of value) {
				if (entry === undefined || entry === null) continue;
				body.append(key, String(entry));
			}
		} else {
			body.append(key, String(value));
		}
	}
	return body.toString();
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
 * One upstream Premiumize call, with the envelope guarantees the API does not
 * give: a non-JSON body (marketing HTML on 404, nginx HTML on 414, Cloudflare
 * HTML on 400) becomes an error envelope rather than a parse exception.
 */
export async function callPremiumizeDirect(
	apiKey: string,
	endpoint: string,
	params: Record<string, unknown> = {}
): Promise<{ httpStatus: number; body: PremiumizeEnvelope }> {
	return withTimeout(async (signal) => {
		const upstream = await fetch(`${PM_API_BASE}/${endpoint}`, {
			method: 'POST',
			headers: {
				// Capital B, exactly one space, exactly one header: Premiumize
				// rejects `bearer` and Cloudflare 400s a duplicate.
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: toFormBody(params),
			signal,
		});

		const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
		if (!contentType.includes('application/json')) {
			return {
				httpStatus: upstream.status >= 400 ? upstream.status : 502,
				body: {
					status: 'error' as const,
					code: 'non_json_response',
					message: `Premiumize answered ${upstream.status} with ${
						contentType || 'no content type'
					}`,
				},
			};
		}

		const body = (await upstream.json()) as PremiumizeEnvelope;
		return { httpStatus: upstream.status >= 400 ? upstream.status : 200, body };
	});
}

async function callPremiumizeProxy(
	apiKey: string,
	endpoint: string,
	params: Record<string, unknown>
): Promise<{ httpStatus: number; body: PremiumizeEnvelope }> {
	const response = await fetch(`${PM_PROXY_BASE}/${endpoint}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(params),
	});
	const body = (await response.json().catch(() => ({
		status: 'error' as const,
		code: 'non_json_response',
		message: `Proxy answered ${response.status}`,
	}))) as PremiumizeEnvelope;
	return { httpStatus: response.status, body };
}

/**
 * Runs one Premiumize call and unwraps the envelope, throwing `PremiumizeError`
 * on anything that is not a success. Nothing retries: `transient_error` is the
 * service's null value and covers permanent failures too.
 */
export async function pmRequest<T = PremiumizeEnvelope>(
	apiKey: string,
	endpoint: string,
	params: Record<string, unknown> = {}
): Promise<T> {
	if (!apiKey) throw new PremiumizeError('Missing Premiumize API key.', 'authentication_failed');

	const { body } = isServer()
		? await callPremiumizeDirect(apiKey, endpoint, params)
		: await callPremiumizeProxy(apiKey, endpoint, params);

	if (body?.status !== 'success') {
		throw new PremiumizeError(
			body?.message || `Premiumize ${endpoint} failed`,
			body?.code || 'unknown_error'
		);
	}
	return body as T;
}

/** `transfer/directdl` and `transfer/create` reject a bare hash; only `cache/check` takes one. */
export const toMagnetUri = (hashOrMagnet: string): string =>
	hashOrMagnet.startsWith('magnet:') ? hashOrMagnet : `magnet:?xt=urn:btih:${hashOrMagnet}`;

/**
 * An unrecognised URL comes back from `transfer/directdl` as a `success` whose
 * `link` is the input verbatim, with a null size. The host is the only reliable
 * way to tell a real resolution from a pass-through.
 */
export const isEnergyCdnLink = (link: string): boolean => {
	try {
		return new URL(link).hostname.endsWith(ENERGY_CDN_SUFFIX);
	} catch {
		return false;
	}
};

/** Premiumize reports `filesize` as a string on a cache hit and the integer 0 on a miss. */
const toBytes = (value: unknown): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

export const getPremiumizeAccountInfo = (apiKey: string): Promise<PremiumizeAccountInfo> =>
	pmRequest<PremiumizeAccountInfo & PremiumizeEnvelope>(apiKey, 'account/info');

export const isPremiumizePremium = (info: Pick<PremiumizeAccountInfo, 'premium_until'>): boolean =>
	typeof info.premium_until === 'number' && info.premium_until * 1000 > Date.now();

/**
 * Cache probe. Non-destructive - unlike AllDebrid, nothing is added to the
 * account - and it answers 1,000 hashes in a single request.
 *
 * The alignment guard is not defensive coding. Premiumize silently drops empty
 * and whitespace-only items server-side, so every answer after a gap shifts
 * left and a naive `items[i] -> response[i]` zip attributes one torrent's cache
 * state to a different torrent, confidently and without any error.
 */
export async function checkPremiumizeCache(
	apiKey: string,
	hashes: string[]
): Promise<PremiumizeCacheResult[]> {
	const items = hashes.map((hash) => hash.trim()).filter((hash) => hash.length > 0);
	if (items.length === 0) return [];

	const results: PremiumizeCacheResult[] = [];
	for (let start = 0; start < items.length; start += CACHE_CHECK_CHUNK_SIZE) {
		const chunk = items.slice(start, start + CACHE_CHECK_CHUNK_SIZE);
		const body = await pmRequest<
			PremiumizeEnvelope & {
				response: boolean[];
				filename: (string | null)[];
				filesize: (string | number | null)[];
			}
		>(apiKey, 'cache/check', { 'items[]': chunk });

		const response = Array.isArray(body.response) ? body.response : [];
		if (response.length !== chunk.length) {
			throw new PremiumizeError(
				`cache/check returned ${response.length} answers for ${chunk.length} items`,
				'misaligned_response'
			);
		}

		for (let i = 0; i < chunk.length; i++) {
			const cached = response[i] === true;
			results.push({
				hash: chunk[i],
				cached,
				filename: body.filename?.[i] ?? null,
				filesize: cached ? toBytes(body.filesize?.[i]) : null,
			});
		}
	}
	return results;
}

export const listPremiumizeTransfers = async (apiKey: string): Promise<PremiumizeTransfer[]> => {
	const body = await pmRequest<PremiumizeEnvelope & { transfers?: PremiumizeTransfer[] }>(
		apiKey,
		'transfer/list'
	);
	return Array.isArray(body.transfers) ? body.transfers : [];
};

/**
 * Adds a magnet or a plain HTTP URL to the user's cloud.
 *
 * Idempotent by source while the transfer is alive: re-adding a live hash
 * returns the existing id and creates nothing, where Real-Debrid duplicates.
 * Once the transfer is deleted the same magnet gets a fresh id.
 */
export const createPremiumizeTransfer = (
	apiKey: string,
	src: string
): Promise<PremiumizeEnvelope & { id: string; name: string; type?: string }> =>
	pmRequest(apiKey, 'transfer/create', { src });

/**
 * Deletes a transfer **and the files it produced**. That is not what the vendor
 * documentation says ("Deletes a transfer record") but it is what happens, so
 * this is the right call for "remove from my library" and the wrong one for
 * tidying the transfer list - use `clearFinishedPremiumizeTransfers` for that.
 */
export const deletePremiumizeTransfer = (apiKey: string, id: string): Promise<PremiumizeEnvelope> =>
	pmRequest(apiKey, 'transfer/delete', { id });

/** Removes finished transfer records only; the files stay in the cloud. */
export const clearFinishedPremiumizeTransfers = (apiKey: string): Promise<PremiumizeEnvelope> =>
	pmRequest(apiKey, 'transfer/clearfinished');

/**
 * Resolves a cached source straight to signed CDN links, leaving nothing behind:
 * no transfer, no folder, no storage. This is the path that lets every user
 * resolve a hash with their own key, so DMM stores hashes and never links.
 *
 * The top-level `location`/`filename`/`filesize` fields are deliberately ignored
 * - they mirror `content[0]`, which for a torrent is whatever sorts first (a
 * poster JPEG, in the reference case).
 */
export async function directDownloadPremiumize(
	apiKey: string,
	hashOrUrl: string
): Promise<PremiumizeDirectDownloadFile[]> {
	const src = hashOrUrl.startsWith('http') ? hashOrUrl : toMagnetUri(hashOrUrl);
	const body = await pmRequest<PremiumizeEnvelope & { content?: PremiumizeDirectDownloadFile[] }>(
		apiKey,
		'transfer/directdl',
		{ src }
	);

	const content = Array.isArray(body.content) ? body.content : [];
	const resolved = content.filter((file) => file.link && isEnergyCdnLink(file.link));
	if (content.length > 0 && resolved.length === 0) {
		// Premiumize echoed the input back as a "success" without resolving it.
		throw new PremiumizeError(
			'Premiumize did not resolve this source to a CDN link.',
			'service_unsupported'
		);
	}
	return resolved;
}

export const listPremiumizeFolder = (
	apiKey: string,
	folderId?: string
): Promise<PremiumizeFolderListing & PremiumizeEnvelope> =>
	pmRequest(apiKey, 'folder/list', folderId ? { id: folderId } : {});

export const listAllPremiumizeItems = async (apiKey: string): Promise<PremiumizeItem[]> => {
	const body = await pmRequest<PremiumizeEnvelope & { files?: PremiumizeItem[] }>(
		apiKey,
		'item/listall'
	);
	return Array.isArray(body.files) ? body.files : [];
};

export const getPremiumizeItemDetails = (
	apiKey: string,
	id: string
): Promise<PremiumizeEnvelope & PremiumizeFolderEntry> => pmRequest(apiKey, 'item/details', { id });

export const deletePremiumizeFolder = (apiKey: string, id: string): Promise<PremiumizeEnvelope> =>
	pmRequest(apiKey, 'folder/delete', { id });

export const deletePremiumizeItem = (apiKey: string, id: string): Promise<PremiumizeEnvelope> =>
	pmRequest(apiKey, 'item/delete', { id });

/**
 * `transfer/list` does not report an info hash. `job/src` 302-redirects to the
 * source a transfer was created from, and for a magnet that redirect is the only
 * place the hash survives. Server-side only - reading a redirect without
 * following it is not something a browser fetch will do - so the browser goes
 * through the proxy's virtual endpoint.
 */
/**
 * The info hash of a .torrent file: sha1 over the bencoded `info` dictionary,
 * re-encoded rather than sliced out of the original bytes so a non-canonical
 * ordering cannot shift the boundaries.
 *
 * `bencode` and node's `crypto` are imported lazily because this module is also
 * bundled for the browser, where neither belongs and only the proxy path runs.
 */
export async function infoHashFromTorrentFile(body: Uint8Array): Promise<string | null> {
	try {
		const [{ default: bencode }, { createHash }] = await Promise.all([
			import('bencode'),
			import('crypto'),
		]);
		const decoded = bencode.decode(body as Buffer) as { info?: unknown };
		if (!decoded?.info) return null;
		return createHash('sha1').update(bencode.encode(decoded.info)).digest('hex');
	} catch {
		return null;
	}
}

export async function resolvePremiumizeTransferHash(
	apiKey: string,
	id: string
): Promise<string | null> {
	try {
		return await withTimeout(async (signal) => {
			const response = await fetch(`${PM_API_BASE}/job/src?id=${encodeURIComponent(id)}`, {
				method: 'GET',
				headers: { Authorization: `Bearer ${apiKey}` },
				redirect: 'manual',
				signal,
			});

			// A transfer created from a magnet 302s back to that magnet.
			const location = response.headers.get('location');
			if (location) {
				const match = /urn:btih:([a-fA-F0-9]{40})/.exec(location);
				return match ? match[1].toLowerCase() : null;
			}

			// A transfer created from a .torrent file answers 200 with the torrent
			// itself - mislabelled `application/json`, so the content type is no
			// help. The hash is still there, as the sha1 of the bencoded `info`
			// dict. Measured 2026-09-01: 2 of 3 transfers on the probe account
			// take this branch, and reading only the redirect reported them as
			// having no info hash at all.
			if (!response.ok) return null;
			return await infoHashFromTorrentFile(new Uint8Array(await response.arrayBuffer()));
		});
	} catch {
		return null;
	}
}

export async function resolvePremiumizeTransferHashesDirect(
	apiKey: string,
	ids: string[]
): Promise<Record<string, string>> {
	const hashes: Record<string, string> = {};
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(HASH_LOOKUP_CONCURRENCY, ids.length) }, async () => {
			while (cursor < ids.length) {
				const id = ids[cursor++];
				const hash = await resolvePremiumizeTransferHash(apiKey, id);
				if (hash) hashes[id] = hash;
			}
		})
	);
	return hashes;
}

export async function resolvePremiumizeTransferHashes(
	apiKey: string,
	ids: string[]
): Promise<Record<string, string>> {
	if (ids.length === 0) return {};
	if (isServer()) return resolvePremiumizeTransferHashesDirect(apiKey, ids);
	const body = await pmRequest<PremiumizeEnvelope & { hashes?: Record<string, string> }>(
		apiKey,
		HASHES_ENDPOINT,
		{ ids }
	);
	return body.hashes ?? {};
}

export const _testing = { toFormBody, toBytes, HASHES_ENDPOINT };
