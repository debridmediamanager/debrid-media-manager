import type { PublicRequest } from './contentRequest';

/**
 * Client side of the request board.
 *
 * Every call carries the Real-Debrid access token as a **header**, matching the
 * endpoints and for the same reason the Transfers client does it: nginx logs the
 * request line, so a key in the URL is a key written to disk permanently.
 */

export const RD_TOKEN_HEADER = 'x-rd-access-token';
export const TB_KEY_HEADER = 'x-tb-api-key';

function headers(rdKey: string | null, json = false): Record<string, string> {
	return {
		...(rdKey ? { [RD_TOKEN_HEADER]: rdKey } : {}),
		...(json ? { 'Content-Type': 'application/json' } : {}),
	};
}

/**
 * Read the body once, whatever the status.
 *
 * The endpoints answer failures with `{ error }`, and that message is the only
 * thing that tells a fulfiller *why* a claim was refused — "somebody else just
 * took this request" reads very differently from a bare 409.
 */
/** TorBox does not have the release, so no fulfiller can send it yet. */
export class UncachedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UncachedError';
	}
}

async function unwrap(response: Response): Promise<any> {
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		const message = data?.error || `Request failed with status ${response.status}`;
		throw data?.uncached === true ? new UncachedError(message) : new Error(message);
	}
	return data ?? {};
}

/**
 * One page of the board, oldest first. A signed-in caller's own open rows are
 * marked `mine` in place. `hasMore` says whether another page follows, which is
 * what the page's infinite scroll advances on.
 */
export async function fetchContentRequests(
	rdKey: string | null,
	opts: { offset?: number; limit?: number; tbKey?: string | null; servable?: boolean } = {}
): Promise<{ requests: PublicRequest[]; authenticated: boolean; hasMore: boolean }> {
	const params = new URLSearchParams();
	if (opts.offset) params.set('offset', String(opts.offset));
	if (opts.limit) params.set('limit', String(opts.limit));
	// Only what TorBox has cached, filtered across the whole board server-side.
	if (opts.servable && opts.tbKey) params.set('servable', '1');
	const qs = params.toString();
	const data = await unwrap(
		await fetch(`/api/requests${qs ? `?${qs}` : ''}`, {
			// The TorBox key lets the server mark which rows it can send.
			headers: { ...headers(rdKey), ...(opts.tbKey ? { [TB_KEY_HEADER]: opts.tbKey } : {}) },
		})
	);
	return {
		requests: Array.isArray(data.requests) ? (data.requests as PublicRequest[]) : [],
		authenticated: data.authenticated === true,
		hasMore: data.hasMore === true,
	};
}

/** The caller's own requests in every state, newest first. */
export async function fetchMyContentRequests(rdKey: string): Promise<PublicRequest[]> {
	const data = await unwrap(await fetch('/api/requests?mine=1', { headers: headers(rdKey) }));
	return Array.isArray(data.requests) ? (data.requests as PublicRequest[]) : [];
}

export interface NewContentRequest {
	hash: string;
	imdbId: string;
	title?: string | null;
	mediaType: 'movie' | 'show';
	/** The whole release in bytes, when known. */
	sizeBytes?: number;
	/** The page the request is made from. */
	returnPath?: string;
}

/**
 * File a request. Idempotent — asking twice returns the row already there.
 *
 * `delivered` instead of a row means nothing was filed: Real-Debrid already had
 * the release, and it has been added to the asker's library.
 */
export async function fileContentRequest(
	rdKey: string,
	input: NewContentRequest
): Promise<{ delivered: true } | { delivered: false; request: PublicRequest }> {
	const data = await unwrap(
		await fetch('/api/requests', {
			method: 'POST',
			headers: headers(rdKey, true),
			body: JSON.stringify(input),
		})
	);
	if (data.delivered === true) return { delivered: true };
	return { delivered: false, request: data.request as PublicRequest };
}

/**
 * Take somebody else's request and pay for it.
 *
 * The keys posted here are the fulfiller's own TorBox/AllDebrid credentials, and
 * the transfer they start spends the fulfiller's quota to land bytes in the
 * *asker's* Real-Debrid library. Nothing about the release comes back — the job
 * id is all there is to follow, and only the asker sees the result.
 */
export async function fulfillContentRequest(
	rdKey: string,
	id: string,
	keys: { tbKey?: string | null }
): Promise<{ jobId: string | null; delivered: boolean }> {
	const data = await unwrap(
		await fetch(`/api/requests/${encodeURIComponent(id)}/fulfill`, {
			method: 'POST',
			headers: headers(rdKey, true),
			body: JSON.stringify({
				...(keys.tbKey ? { tbKey: keys.tbKey } : {}),
			}),
		})
	);
	// `delivered`: the release was already on Real-Debrid, so it went straight
	// into the asker's library and no transfer was started.
	if (data.delivered === true) return { jobId: null, delivered: true };
	return { jobId: String(data.jobId ?? ''), delivered: false };
}

/** Withdraw one's own request. */
export async function cancelContentRequest(rdKey: string, id: string): Promise<void> {
	await unwrap(
		await fetch(`/api/requests/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: headers(rdKey),
		})
	);
}
