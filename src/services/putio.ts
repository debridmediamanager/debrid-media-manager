import { extractTorrentInputs, isValidHash } from '@/utils/extractHashes';

/**
 * put.io API client, called straight from the browser.
 *
 * Written to put.io's published TypeScript client schemas and API docs
 * (devs.put.io), then checked against answers recorded on 2026-11-15 from an
 * account without a plan and then with one (`src/test/fixtures/putio/README.md`
 * says what each shows). Fields are read tolerantly, so one that turns out
 * missing or null degrades a row instead of throwing.
 *
 * What is load-bearing:
 *
 *  - **CORS is open and allows `authorization`**, so there is no DMM proxy. The
 *    token travels as `Authorization: Bearer`, never in a query string.
 *  - **Bodies are form-urlencoded**, ids comma-joined, per the docs.
 *  - **Errors are `{status: "ERROR", error_type, status_code}`.** Branch on the
 *    HTTP status and `error_type`; `error_message` is prose and can change, and
 *    the docs ask apps not to show it raw.
 *  - **A 429's `X-RateLimit-*` headers are not exposed to the browser**, so the
 *    reset time is unreadable. Every call backs off blindly for a fixed window
 *    after one, without touching the network.
 *  - **Only a 401 means signed out.** Network errors, 429 and 5xx keep the token.
 *  - **Never log tokens, file names or URLs** (put.io's app checklist). Errors
 *    here carry an endpoint and a code, nothing from the account.
 */

const PT_API_BASE = 'https://api.put.io/v2';
/** Uploads must use this host (docs). Its CORS has not been measured. */
const PT_UPLOAD_BASE = 'https://upload.put.io/v2';

const REQUEST_TIMEOUT_MS = 30_000;

/** How long every call stands down after a 429 whose reset time we cannot read. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/**
 * Without `per_page` the list is the 1000 *oldest* transfers; with it, pages run
 * newest first over the newest 10,000. The page size cap is unpublished.
 */
export const TRANSFERS_PAGE_SIZE = 1000;
/** A stop for the page walk: far past 10,000 rows at any sane page size. */
const MAX_TRANSFER_PAGES = 50;

/** `/files/list` documents up to 1000 per page. */
export const FILES_PAGE_SIZE = 1000;
/** Bounds for walking a transfer's folder tree when a modal opens. */
export const MAX_FOLDER_DEPTH = 5;
export const MAX_FOLDER_LISTINGS = 50;
export const MAX_LISTED_FILES = 2000;

/**
 * URLs per `/transfers/add-multi` call. Above an unpublished limit it answers
 * `403 TOO_MANY_URLS`, so this stays small.
 */
export const ADD_MULTI_CHUNK_SIZE = 20;

/** DMM's registered put.io OAuth app (public). Self-hosters may set their own. */
export const DMM_PUTIO_APP_ID = '10085';

/** The device-link page, with the code filled in (measured 2026-11-15). */
export const putioLinkUrl = (code: string) =>
	`https://app.put.io/link?code=${encodeURIComponent(code)}`;

/** Every status in the SDK's `TransferStatusSchema`. */
export const PUTIO_TRANSFER_STATUSES = [
	'WAITING',
	'PREPARING_DOWNLOAD',
	'IN_QUEUE',
	'DOWNLOADING',
	'WAITING_FOR_COMPLETE_QUEUE',
	'WAITING_FOR_DOWNLOADER',
	'COMPLETING',
	'STOPPING',
	'SEEDING',
	'COMPLETED',
	'ERROR',
	'PREPARING_SEED',
] as const;

export type PutioTransferStatus = (typeof PUTIO_TRANSFER_STATUSES)[number];

/** The fields DMM reads. All but `id` may be null or missing on the wire. */
export interface PutioTransfer {
	id: number;
	name?: string | null;
	status?: string | null;
	hash?: string | null;
	source?: string | null;
	size?: number | null;
	percent_done?: number | null;
	file_id?: number | null;
	created_at?: string | null;
	down_speed?: number | null;
	peers_sending_to_us?: number | null;
	error_message?: string | null;
}

export interface PutioFile {
	id: number;
	name: string;
	size?: number | null;
	file_type?: string | null;
	parent_id?: number | null;
}

export interface PutioAccountInfo {
	user_id: number;
	username: string;
	mail?: string;
	account_status?: string;
	account_active?: boolean | null;
	disk?: { avail: number; size: number; used: number };
}

export interface PutioAddMultiResult {
	transfers: PutioTransfer[];
	errors: { error_type?: string; status_code?: number; url?: string }[];
}

export class PutioError extends Error {
	/** `error_type` when put.io sent one, else `http_<status>` or a local code. */
	readonly code: string;
	/** HTTP status, 0 when none was received. */
	readonly status: number;

	constructor(message: string, code: string, status = 0) {
		super(message);
		this.name = 'PutioError';
		this.code = code;
		this.status = status;
	}
}

export const isPutioAuthError = (error: unknown): boolean =>
	error instanceof PutioError && error.status === 401;

export const isPutioRateLimited = (error: unknown): boolean =>
	error instanceof PutioError && error.code === 'rate_limited';

/** What a person reads. put.io asks apps never to show its raw error text. */
const readable = (status: number, code: string): string => {
	if (status === 401) return 'put.io sign-in is no longer valid. Sign in again.';
	if (status === 402) return 'Your put.io account has no active plan.';
	if (status === 429)
		return 'put.io is limiting requests. Wait a minute; if it keeps happening, open put.io in this browser to clear it.';
	if (status === 404) return 'put.io no longer has that item.';
	if (status >= 500) return `put.io had a server error (${status}). Try again later.`;
	return `put.io refused the request (${code}).`;
};

let rateLimitedUntil = 0;

interface RequestOptions {
	method?: 'GET' | 'POST';
	query?: Record<string, string | number | undefined>;
	form?: Record<string, string>;
	multipart?: FormData;
	base?: string;
}

async function ptRequest<T>(
	token: string | null,
	path: string,
	{ method = 'GET', query, form, multipart, base = PT_API_BASE }: RequestOptions = {}
): Promise<T> {
	if (Date.now() < rateLimitedUntil) {
		throw new PutioError(readable(429, 'rate_limited'), 'rate_limited', 429);
	}

	const url = new URL(`${base}${path}`);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(url.toString(), {
			method,
			headers: {
				Accept: 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			...(multipart || form ? { body: multipart ?? new URLSearchParams(form) } : {}),
			signal: controller.signal,
		});
	} catch {
		throw new PutioError('Could not reach put.io.', 'network_error');
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 429) {
		rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
		throw new PutioError(readable(429, 'rate_limited'), 'rate_limited', 429);
	}

	let body: Record<string, unknown> | null = null;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		// Not JSON: judged by the status alone below.
	}

	if (!response.ok || body === null || body.status === 'ERROR') {
		const code =
			typeof body?.error_type === 'string'
				? body.error_type
				: response.ok
					? 'non_json_response'
					: `http_${response.status}`;
		throw new PutioError(readable(response.status, code), code, response.status);
	}
	return body as T;
}

export const getPutioAccountInfo = async (token: string): Promise<PutioAccountInfo> =>
	(await ptRequest<{ info: PutioAccountInfo }>(token, '/account/info')).info;

/**
 * Whether the account has a plan. Recorded 2026-11-15: an account without one
 * reads `account_status: "stranger"` with zero disk, signs in fine, and answers
 * every add and link with 402 PaymentRequired.
 */
export const isPutioActive = (info: Pick<PutioAccountInfo, 'account_status'>): boolean =>
	info.account_status === 'active';

/**
 * Name and size of each magnet without adding it (`/transfers/info`, recorded
 * non-mutating). An unknown hash answers `file_size: 0`, so a size says only
 * what the add would need, never whether it would be instant.
 */
export async function getPutioTransferInfo(
	token: string,
	magnets: string[]
): Promise<{ diskAvail: number; sizes: number[] }> {
	const body = await ptRequest<{
		disk_avail?: number;
		ret?: { file_size?: number | null }[];
	}>(token, '/transfers/info', { method: 'POST', form: { urls: magnets.join('\n') } });
	return {
		diskAvail: body.disk_avail ?? 0,
		sizes: magnets.map((_, i) => body.ret?.[i]?.file_size ?? 0),
	};
}

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * Refuses an add that cannot fit, before anything is added. Only known sizes
 * count. Zero free space is what a full account and one without a plan both
 * report, so that message names both.
 */
async function ensurePutioSpace(token: string, magnets: string[]): Promise<void> {
	const { diskAvail, sizes } = await getPutioTransferInfo(token, magnets);
	const needed = sizes.reduce((sum, size) => sum + size, 0);
	if (needed <= diskAvail) return;
	throw new PutioError(
		diskAvail > 0
			? `Not enough space on put.io: this needs ${gib(needed)} and ${gib(diskAvail)} is free.`
			: 'put.io has no free space, or your put.io account has no active plan.',
		'not_enough_space'
	);
}

/**
 * Every transfer, newest first, paged by cursor. Throws on any failed page
 * rather than returning a partial list, which a caller could not tell from a
 * library that really shrank.
 */
export async function listPutioTransfers(token: string): Promise<PutioTransfer[]> {
	const query = { per_page: TRANSFERS_PAGE_SIZE };
	let page = await ptRequest<{ transfers?: PutioTransfer[]; cursor?: string | null }>(
		token,
		'/transfers/list',
		{ query }
	);
	const transfers = [...(page.transfers ?? [])];
	for (let pages = 1; page.cursor; pages++) {
		if (pages >= MAX_TRANSFER_PAGES) {
			throw new PutioError('put.io kept returning more transfer pages.', 'too_many_pages');
		}
		page = await ptRequest(token, '/transfers/list/continue', {
			method: 'POST',
			query,
			form: { cursor: page.cursor },
		});
		transfers.push(...(page.transfers ?? []));
	}
	return transfers;
}

export const getPutioTransfer = async (token: string, id: number): Promise<PutioTransfer> =>
	(await ptRequest<{ transfer: PutioTransfer }>(token, `/transfers/${id}`)).transfer;

/** The v1 info hash of a magnet or bare hash, or null. Only 40-hex is accepted. */
const btihOf = (source: string): string | null => {
	const hash = extractTorrentInputs(source.trim())[0]?.hash ?? null;
	return hash && isValidHash(hash) ? hash : null;
};

const requireBtih = (source: string): string => {
	const hash = btihOf(source);
	if (!hash) throw new PutioError('That is not a valid info hash.', 'invalid_info_hash');
	return hash;
};

/**
 * Adds one magnet, after validating its info hash and checking it fits. Every
 * add spends the account's storage: put.io has no cache check to ask first.
 */
export async function addPutioTransfer(token: string, magnet: string): Promise<PutioTransfer> {
	requireBtih(magnet);
	await ensurePutioSpace(token, [magnet.trim()]);
	const { transfer } = await ptRequest<{ transfer: PutioTransfer }>(token, '/transfers/add', {
		method: 'POST',
		form: { url: magnet.trim() },
	});
	if (!transfer || typeof transfer.id !== 'number') {
		throw new PutioError('put.io added it without a transfer id.', 'invalid_response');
	}
	return transfer;
}

/**
 * One `add-multi` call, after the same checks as `addPutioTransfer` for the
 * whole chunk at once. put.io lists per-URL refusals in `errors`.
 */
export async function addPutioTransfers(
	token: string,
	magnets: string[]
): Promise<PutioAddMultiResult> {
	if (magnets.length === 0 || magnets.length > ADD_MULTI_CHUNK_SIZE) {
		throw new PutioError('Wrong number of links for one put.io request.', 'too_many_urls');
	}
	magnets.forEach(requireBtih);
	const urls = magnets.map((url) => url.trim());
	await ensurePutioSpace(token, urls);
	const body = await ptRequest<Partial<PutioAddMultiResult>>(token, '/transfers/add-multi', {
		method: 'POST',
		form: { urls: JSON.stringify(urls.map((url) => ({ url }))) },
	});
	return { transfers: body.transfers ?? [], errors: body.errors ?? [] };
}

/**
 * Uploads a `.torrent`, which put.io starts as a transfer. `torrent=true` makes
 * it refuse anything that is not a torrent instead of storing it as a file.
 */
export async function uploadPutioTorrentFile(
	token: string,
	file: Blob
): Promise<PutioTransfer | null> {
	const form = new FormData();
	form.append('file', file);
	form.append('torrent', 'true');
	const body = await ptRequest<{ transfer?: PutioTransfer }>(token, '/files/upload', {
		method: 'POST',
		multipart: form,
		base: PT_UPLOAD_BASE,
	});
	return body.transfer ?? null;
}

const positiveIds = (ids: number[]): string => {
	if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
		throw new PutioError('Refusing an empty or non-positive put.io id.', 'invalid_id');
	}
	return ids.join(',');
};

/**
 * Stops and removes transfer entries; files stay. A SEEDING transfer only stops
 * seeding and becomes COMPLETED, keeping its entry (docs).
 */
export const cancelPutioTransfers = async (token: string, ids: number[]) =>
	ptRequest(token, '/transfers/cancel', {
		method: 'POST',
		form: { transfer_ids: positiveIds(ids) },
	});

/** Removes transfer entries without touching files or stopping them first. */
export const removePutioTransfers = async (token: string, ids: number[]) =>
	ptRequest(token, '/transfers/remove', {
		method: 'POST',
		form: { transfer_ids: positiveIds(ids) },
	});

/**
 * Deletes files or folders. Id 0 is the root folder, so non-positive ids are
 * refused here. Trash follows the account setting (no `skip_trash`), and ids
 * that are already gone are skipped, as the SDK does.
 */
export const deletePutioFiles = async (token: string, fileIds: number[]) =>
	ptRequest(token, '/files/delete', {
		method: 'POST',
		query: { skip_nonexistents: 'true' },
		form: { file_ids: positiveIds(fileIds) },
	});

/** One folder's children, every page. A file id lists as `files: []` with itself as `parent`. */
async function listPutioFolder(
	token: string,
	parentId: number
): Promise<{ files: PutioFile[]; parent: PutioFile | null }> {
	const query = { parent_id: parentId, per_page: FILES_PAGE_SIZE };
	let page = await ptRequest<{
		files?: PutioFile[];
		parent?: PutioFile | null;
		cursor?: string | null;
	}>(token, '/files/list', { query });
	const parent = page.parent ?? null;
	const files = [...(page.files ?? [])];
	while (page.cursor && files.length < MAX_LISTED_FILES) {
		page = await ptRequest(token, '/files/list/continue', {
			method: 'POST',
			query: { per_page: FILES_PAGE_SIZE },
			form: { cursor: page.cursor },
		});
		files.push(...(page.files ?? []));
	}
	return { files, parent };
}

const isFolder = (file: Pick<PutioFile, 'file_type'>) => file.file_type === 'FOLDER';

/**
 * The files under a transfer's `file_id`, which is either one file or a folder.
 * Folders are walked breadth-first within the bounds above; `truncated` says a
 * bound was hit, so the modal can say the listing is incomplete.
 */
export async function listPutioTransferFiles(
	token: string,
	fileId: number
): Promise<{ files: (PutioFile & { path: string })[]; truncated: boolean }> {
	const files: (PutioFile & { path: string })[] = [];
	const queue: { id: number; path: string; depth: number }[] = [
		{ id: fileId, path: '', depth: 0 },
	];
	let listings = 0;
	let truncated = false;
	while (queue.length > 0) {
		if (listings >= MAX_FOLDER_LISTINGS || files.length >= MAX_LISTED_FILES) {
			truncated = true;
			break;
		}
		const folder = queue.shift()!;
		const { files: children, parent } = await listPutioFolder(token, folder.id);
		listings++;
		if (listings === 1 && parent && !isFolder(parent)) {
			return { files: [{ ...parent, path: parent.name }], truncated: false };
		}
		for (const child of children) {
			const path = folder.path ? `${folder.path}/${child.name}` : child.name;
			if (!isFolder(child)) files.push({ ...child, path });
			else if (folder.depth + 1 <= MAX_FOLDER_DEPTH)
				queue.push({ id: child.id, path, depth: folder.depth + 1 });
			else truncated = true;
		}
	}
	return { files: files.slice(0, MAX_LISTED_FILES), truncated };
}

/**
 * A download URL for one file. It carries a credential (`oauth_token` and a
 * signed `u=`, recorded), so it is minted on click and never logged or kept.
 * The docs bind it to the asking IP; it also served from a second IP when tried.
 */
export async function getPutioDownloadUrl(token: string, fileId: number): Promise<string> {
	const { url } = await ptRequest<{ url?: string }>(token, `/files/${fileId}/url`);
	if (!url) throw new PutioError('put.io returned no download link.', 'invalid_response');
	return url;
}

/** Device link, step one. Unauthenticated; `appId` is the registered OAuth app id. */
export async function requestPutioDeviceCode(appId: string): Promise<{ code: string }> {
	const body = await ptRequest<{ code?: string }>(null, '/oauth2/oob/code', {
		query: { app_id: appId, client_name: 'Debrid Media Manager' },
	});
	if (!body.code) throw new PutioError('put.io returned no code.', 'invalid_response');
	return { code: body.code };
}

/**
 * Device link, step two: null until the person links the code. A used or
 * expired code answers 404, surfaced as a `PutioError` with that status.
 */
export async function checkPutioDeviceCode(code: string): Promise<string | null> {
	const body = await ptRequest<{ oauth_token?: string | null }>(
		null,
		`/oauth2/oob/code/${encodeURIComponent(code)}`
	);
	return body.oauth_token || null;
}

/**
 * A transfer's info hash: `hash` when put.io filled it, else the btih of a
 * magnet `source`, else '' (a URL or upload transfer may have none).
 */
export const putioTransferHash = (transfer: Pick<PutioTransfer, 'hash' | 'source'>): string => {
	if (transfer.hash && isValidHash(transfer.hash)) return transfer.hash.toLowerCase();
	const source = transfer.source ?? '';
	return (/^magnet:\?/i.test(source.trim()) && btihOf(source)) || '';
};

export const isValidPutioBtih = (source: string): boolean => btihOf(source) !== null;

export const _testing = {
	PT_API_BASE,
	PT_UPLOAD_BASE,
	resetRateLimit: () => {
		rateLimitedUntil = 0;
	},
};
