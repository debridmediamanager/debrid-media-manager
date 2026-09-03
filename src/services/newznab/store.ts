// Read-through NZB blob store on Backblaze B2.
//
// The indexers meter `t=get` against one shared account, and an NZB is immutable
// once posted — so the first fetch of a release is the only one that has to cost
// an API call. Everything after it is served from B2.
//
// B2's *native* API is used deliberately, not the S3-compatible one: native is
// plain JSON over HTTP with a bearer token, so it needs no SigV4 signer and no
// new dependency. bare `fetch` is the whole client.
//
// The store is a cache, never a source of truth. Every failure — missing config,
// timeout, 401, 500, a torn body — degrades to a miss so the caller falls
// through to the upstream indexer. Nothing here throws.

import { createHash } from 'crypto';

const AUTHORIZE_URL = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';

/**
 * B2 authorization tokens are documented as good for 24h. Refreshing an hour
 * early keeps a long-lived swarm instance from discovering the expiry as a 401
 * mid-request — the 401 path still exists, because a key rotated or revoked
 * out-of-band expires the token immediately whatever the clock says.
 */
const AUTH_TTL_MS = 23 * 60 * 60 * 1000;

/** Reads are on a page's critical path; a slow B2 must lose to the indexer. */
const READ_TIMEOUT_MS = 5000;
/** Writes carry the NZB body, which runs to a few MB on a large season pack. */
const WRITE_TIMEOUT_MS = 15000;
/** Control calls (authorize, list buckets, get upload url) carry no payload. */
const CONTROL_TIMEOUT_MS = 5000;

const CONTENT_TYPE = 'application/x-nzb';

interface StoreConfig {
	keyId: string;
	appKey: string;
	bucketName: string;
}

interface AuthState {
	token: string;
	apiUrl: string;
	downloadUrl: string;
	accountId: string;
	/** Present only when the application key is scoped to a single bucket. */
	allowedBucketId: string | null;
	expiresAt: number;
}

// Read per call rather than at import time: Next.js loads this module once per
// process, and the tests flip the env between cases.
function getConfig(): StoreConfig | null {
	const keyId = process.env.B2_KEY_ID;
	const appKey = process.env.B2_APP_KEY;
	const bucketName = process.env.B2_BUCKET;
	if (!keyId || !appKey || !bucketName) return null;
	return { keyId, appKey, bucketName };
}

export function isStoreConfigured(): boolean {
	return getConfig() !== null;
}

// The in-flight promise is cached, not just its result: a cold instance serving
// a burst would otherwise fire one b2_authorize_account per concurrent request.
let authPromise: Promise<AuthState> | null = null;
let cachedBucketId: string | null = null;

/** Test-only. Module state outlives a `vi.resetModules()`-free test file. */
export function _resetStoreForTest(): void {
	authPromise = null;
	cachedBucketId = null;
}

async function authorize(config: StoreConfig): Promise<AuthState> {
	const basic = Buffer.from(`${config.keyId}:${config.appKey}`).toString('base64');
	const res = await fetch(AUTHORIZE_URL, {
		headers: { Authorization: `Basic ${basic}` },
		signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`b2_authorize_account failed: ${res.status}`);

	const body = (await res.json()) as {
		authorizationToken?: string;
		apiUrl?: string;
		downloadUrl?: string;
		accountId?: string;
		allowed?: { bucketId?: string | null };
	};
	if (!body.authorizationToken || !body.apiUrl || !body.downloadUrl) {
		throw new Error('b2_authorize_account returned an incomplete response');
	}

	return {
		token: body.authorizationToken,
		apiUrl: body.apiUrl.replace(/\/+$/, ''),
		downloadUrl: body.downloadUrl.replace(/\/+$/, ''),
		accountId: body.accountId ?? '',
		allowedBucketId: body.allowed?.bucketId ?? null,
		expiresAt: Date.now() + AUTH_TTL_MS,
	};
}

async function getAuth(config: StoreConfig, force = false): Promise<AuthState> {
	if (force) {
		authPromise = null;
		// A fresh authorization may land on a different key scope, so the bucket
		// id resolved under the old one is no longer known to be right.
		cachedBucketId = null;
	}
	if (authPromise) {
		const state = await authPromise;
		if (Date.now() < state.expiresAt) return state;
		authPromise = null;
	}
	const pending = authorize(config);
	authPromise = pending;
	// A failed authorize must not be cached, or one blip disables the store for
	// the life of the process.
	pending.catch(() => {
		if (authPromise === pending) authPromise = null;
	});
	return pending;
}

/**
 * Runs a B2 call, and on a 401 re-authorizes once and retries it once.
 *
 * Exactly once: a 401 that survives a fresh token is a revoked key or a wrong
 * bucket, and retrying that in a loop turns a config error into a request storm.
 */
async function callWithAuth(
	config: StoreConfig,
	run: (state: AuthState) => Promise<Response>
): Promise<Response> {
	const res = await run(await getAuth(config));
	if (res.status !== 401) return res;
	return run(await getAuth(config, true));
}

/**
 * The B2 file name for a release.
 *
 * `nativeId` is indexer-supplied, so it is encoded before it becomes a path
 * segment. Both sides of the store build the key through here, so the put and
 * the get always agree on the name.
 */
export function nzbObjectKey(prefix: string, nativeId: string): string {
	return `nzb/${prefix}/${encodeURIComponent(nativeId)}.nzb`;
}

// B2 wants the file name percent-encoded in both the download URL and the
// X-Bz-File-Name header, with the `/` separators left literal. Encoding
// per-segment does that; it re-encodes the `%` that nzbObjectKey may have
// introduced, which is correct — B2 stores the *decoded* name, so the two paths
// still round-trip to one object.
function encodeObjectKey(key: string): string {
	return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * The write path runs three calls under one token, so each has to be able to say
 * "the token is the problem" rather than just "this failed" — otherwise a stale
 * token on the first of them ends the put with no retry.
 */
const UNAUTHORIZED = 'unauthorized';
type MaybeUnauthorized<T> = T | typeof UNAUTHORIZED;

async function resolveBucketId(
	config: StoreConfig,
	state: AuthState
): Promise<MaybeUnauthorized<string | null>> {
	if (state.allowedBucketId) return state.allowedBucketId;
	if (cachedBucketId) return cachedBucketId;

	const res = await fetch(`${state.apiUrl}/b2api/v2/b2_list_buckets`, {
		method: 'POST',
		headers: { Authorization: state.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ accountId: state.accountId, bucketName: config.bucketName }),
		signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
	});
	if (res.status === 401) return UNAUTHORIZED;
	if (!res.ok) return null;

	const body = (await res.json()) as { buckets?: { bucketId?: string; bucketName?: string }[] };
	const match = body.buckets?.find((bucket) => bucket.bucketName === config.bucketName);
	if (!match?.bucketId) return null;

	cachedBucketId = match.bucketId;
	return cachedBucketId;
}

interface UploadTarget {
	uploadUrl: string;
	token: string;
}

async function getUploadTarget(
	bucketId: string,
	state: AuthState
): Promise<MaybeUnauthorized<UploadTarget | null>> {
	const res = await fetch(`${state.apiUrl}/b2api/v2/b2_get_upload_url`, {
		method: 'POST',
		headers: { Authorization: state.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ bucketId }),
		signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
	});
	if (res.status === 401) return UNAUTHORIZED;
	if (!res.ok) return null;

	const body = (await res.json()) as { uploadUrl?: string; authorizationToken?: string };
	if (!body.uploadUrl || !body.authorizationToken) return null;
	return { uploadUrl: body.uploadUrl, token: body.authorizationToken };
}

/**
 * The stored NZB XML, or null for a miss — where "miss" covers every failure
 * mode: unconfigured, 404, 401 after a retry, 5xx, timeout, network error.
 * The caller's fallback is the indexer, so a B2 outage costs API calls, not
 * errors.
 */
export async function getStoredNzb(prefix: string, nativeId: string): Promise<string | null> {
	const config = getConfig();
	if (!config) return null;

	const key = encodeObjectKey(nzbObjectKey(prefix, nativeId));
	try {
		const res = await callWithAuth(config, (state) =>
			fetch(`${state.downloadUrl}/file/${config.bucketName}/${key}`, {
				headers: { Authorization: state.token },
				signal: AbortSignal.timeout(READ_TIMEOUT_MS),
			})
		);
		if (!res.ok) return null;

		const xml = await res.text();
		return xml.length > 0 ? xml : null;
	} catch (error) {
		console.error('Error reading NZB from B2:', error);
		return null;
	}
}

/**
 * Stores an NZB. `false` on any failure, and never throws — a write that did not
 * land only means the next reader pays for another indexer call.
 */
export async function putStoredNzb(
	prefix: string,
	nativeId: string,
	xml: string
): Promise<boolean> {
	const config = getConfig();
	if (!config) return false;

	const key = encodeObjectKey(nzbObjectKey(prefix, nativeId));
	const sha1 = createHash('sha1').update(xml, 'utf8').digest('hex');

	// A fresh upload URL per put. B2 hands out per-endpoint URLs that expire on
	// their own schedule and are not safe to hold across requests; one extra
	// control call is cheaper than a retry loop around a cached one.
	const attempt = async (state: AuthState): Promise<MaybeUnauthorized<boolean>> => {
		const bucketId = await resolveBucketId(config, state);
		if (bucketId === UNAUTHORIZED) return UNAUTHORIZED;
		if (!bucketId) return false;

		const target = await getUploadTarget(bucketId, state);
		if (target === UNAUTHORIZED) return UNAUTHORIZED;
		if (!target) return false;

		const res = await fetch(target.uploadUrl, {
			method: 'POST',
			headers: {
				Authorization: target.token,
				'X-Bz-File-Name': key,
				'Content-Type': CONTENT_TYPE,
				'X-Bz-Content-Sha1': sha1,
			},
			body: xml,
			signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
		});
		// An upload URL carries its own token, which expires separately from the
		// account one — but a fresh authorization yields a fresh upload URL too,
		// so one re-auth covers both.
		if (res.status === 401) return UNAUTHORIZED;
		return res.ok;
	};

	try {
		const outcome = await attempt(await getAuth(config));
		if (outcome !== UNAUTHORIZED) return outcome;
		return (await attempt(await getAuth(config, true))) === true;
	} catch (error) {
		console.error('Error writing NZB to B2:', error);
		return false;
	}
}
