/**
 * The rules a content request obeys, kept away from Prisma and HTTP.
 *
 * A request pairs two people who each hold half of what the uploader needs: the
 * asker's Real-Debrid account for where the release lands, and a fulfiller's
 * TorBox or AllDebrid account for where the bytes come from. Everything here is
 * pure so the pairing rules — who may act, and when — are assertable without a
 * database or a debrid host.
 */

export const REQUEST_STATUSES = ['open', 'claimed', 'fulfilled', 'failed', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const MEDIA_TYPES = ['movie', 'show'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Longer than any real release name, short enough that the column stays sane. */
const MAX_TITLE = 500;

export interface ContentRequestInput {
	hash: string;
	imdbId: string;
	title?: string | null;
	mediaType: string;
}

export interface ValidRequest {
	hash: string;
	imdbId: string;
	title: string | null;
	mediaType: MediaType;
}

export class RequestValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RequestValidationError';
	}
}

/**
 * A 40-character info hash, lowercased.
 *
 * Lowercasing is what makes `@@unique([hash, requesterId])` mean anything —
 * trackers and the DMM UI hand back the same hash in either case, and two
 * casings of one release would otherwise be two rows nothing could reconcile.
 */
export function normalizeHash(raw: unknown): string {
	if (typeof raw !== 'string') throw new RequestValidationError('hash is required');
	const hash = raw.trim().toLowerCase();
	if (!/^[0-9a-f]{40}$/.test(hash)) {
		throw new RequestValidationError('hash must be a 40-character info hash');
	}
	return hash;
}

export function normalizeImdbId(raw: unknown): string {
	if (typeof raw !== 'string') throw new RequestValidationError('imdbId is required');
	const id = raw.trim().toLowerCase();
	if (!/^tt\d{7,10}$/.test(id)) {
		throw new RequestValidationError('imdbId must look like tt1234567');
	}
	return id;
}

export function normalizeMediaType(raw: unknown): MediaType {
	const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
	if ((MEDIA_TYPES as readonly string[]).includes(value)) return value as MediaType;
	throw new RequestValidationError(`mediaType must be one of: ${MEDIA_TYPES.join(', ')}`);
}

/** Cosmetic only — the uploader re-derives the real name from the torrent. */
export function normalizeTitle(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const title = raw.trim().replace(/\s+/g, ' ');
	if (title === '') return null;
	return title.length > MAX_TITLE ? title.slice(0, MAX_TITLE) : title;
}

export function parseRequestInput(body: unknown): ValidRequest {
	const input = (body ?? {}) as Partial<ContentRequestInput>;
	return {
		hash: normalizeHash(input.hash),
		imdbId: normalizeImdbId(input.imdbId),
		title: normalizeTitle(input.title),
		mediaType: normalizeMediaType(input.mediaType),
	};
}

/**
 * Which statuses a fulfiller may act on.
 *
 * `claimed` is absent on purpose: a second fulfiller arriving mid-transfer
 * would spend their own TorBox quota re-fetching a release already on its way,
 * and the loser of that race has no way to get it back.
 *
 * `failed` is present, because a failed attempt says the *fulfiller* could not
 * serve it, not that nobody can — a different account may well have it cached.
 */
const CLAIMABLE: ReadonlySet<string> = new Set<RequestStatus>(['open', 'failed']);

export function isClaimable(status: string): boolean {
	return CLAIMABLE.has(status);
}

export interface ClaimSubject {
	status: string;
	requesterId: string;
}

export type ClaimVerdict = { ok: true } | { ok: false; code: number; reason: string };

/**
 * May this fulfiller take this request?
 *
 * Self-fulfilment is refused rather than allowed-but-pointless. Someone holding
 * both halves never needed the board — they can submit to the uploader directly
 * — and letting them claim their own row turns a queue other people can serve
 * into a private one, while making the board look busier than it is.
 */
export function canClaim(request: ClaimSubject, fulfillerId: string): ClaimVerdict {
	if (!isClaimable(request.status)) {
		return { ok: false, code: 409, reason: `request is ${request.status}` };
	}
	if (request.requesterId === fulfillerId) {
		return {
			ok: false,
			code: 400,
			reason: 'you already hold both halves — submit it directly instead',
		};
	}
	return { ok: true };
}

export interface SourceKeys {
	torboxApiKey?: string | null;
	alldebridApiKey?: string | null;
}

/**
 * The fulfiller's half of the pair.
 *
 * Mirrors the uploader's own rule — it refuses a job carrying no cache source —
 * so the failure is a 400 here rather than a job that dies on arrival.
 */
export function pickSourceKeys(keys: SourceKeys): { tb_api_key?: string; ad_api_key?: string } {
	const torbox = typeof keys.torboxApiKey === 'string' ? keys.torboxApiKey.trim() : '';
	const alldebrid = typeof keys.alldebridApiKey === 'string' ? keys.alldebridApiKey.trim() : '';
	if (!torbox && !alldebrid) {
		throw new RequestValidationError('a TorBox or AllDebrid key is required to fulfil');
	}
	return {
		...(torbox ? { tb_api_key: torbox } : {}),
		...(alldebrid ? { ad_api_key: alldebrid } : {}),
	};
}

/** What the board shows. Never the ids of the people involved, nor any key. */
export interface PublicRequest {
	id: string;
	hash: string;
	imdbId: string;
	title: string | null;
	mediaType: string;
	status: string;
	createdAt: string;
	/** True only for the caller's own rows, so the UI can offer a cancel. */
	mine: boolean;
	/** Present once a transfer exists, so the asker can follow it. */
	jobId: string | null;
}

export interface StoredRequest {
	id: string;
	hash: string;
	imdbId: string;
	title: string | null;
	mediaType: string;
	status: string;
	requesterId: string;
	fulfillerId: string | null;
	jobId: string | null;
	createdAt: Date | string;
}

/**
 * Strip a row down to what a stranger may see.
 *
 * `requesterId` and `fulfillerId` never cross the wire. They are stable HMACs
 * of a Real-Debrid username, so publishing them would let anyone watching the
 * board follow one person's entire request history across releases.
 */
export function toPublicRequest(row: StoredRequest, viewerId: string | null): PublicRequest {
	return {
		id: row.id,
		hash: row.hash,
		imdbId: row.imdbId,
		title: row.title,
		mediaType: row.mediaType,
		status: row.status,
		createdAt: new Date(row.createdAt).toISOString(),
		mine: viewerId !== null && row.requesterId === viewerId,
		jobId: row.jobId,
	};
}
