/**
 * Why a DMM Cast addon request could not be answered from the provider.
 *
 * - `not-connected`: no cast profile stands behind this install's user id.
 * - `credential`: the provider refused the stored key or token. A retry cannot
 *   clear it; the member has to sign in again on DMM.
 * - `account`: the provider accepted the sign-in and refused the account
 *   itself - premium ran out, the account is locked or banned, or the plan
 *   has no API access. Signing in again changes nothing; the member has to
 *   sort it out on the provider's own site.
 * - `confirm`: the provider holds the sign-in until its owner confirms it.
 *   AllDebrid does this the first time a key is used from an address it has
 *   not seen for the account, which for every addon request is DMM's server,
 *   and emails the owner a link to confirm. Nothing on DMM's side clears it,
 *   and neither does waiting.
 * - `gone`: the provider answered, and the item is not in the account.
 * - `unplayable`: the item is there but has nothing a client can stream.
 * - `unavailable`: the provider did not answer usefully - a reset connection,
 *   a timeout, a 5xx, a rate limit, or our own database. The next request may
 *   well succeed.
 */
export type CastFailure =
	| 'not-connected'
	| 'credential'
	| 'account'
	| 'confirm'
	| 'gone'
	| 'unplayable'
	| 'unavailable';

/**
 * Error codes each provider uses for a key it will not accept, measured against
 * the live APIs 2026-10-04 (src/test/fixtures/castAddonFailures). Premiumize
 * and AllDebrid send theirs inside an HTTP 200, so the code is the only signal.
 */
const CREDENTIAL_CODES = new Set([
	// Premiumize: missing, wrong and revoked keys all answer this.
	'authentication_failed',
	// Offcloud
	'NOAUTH',
	// Debrid-Link
	'badToken',
	// AllDebrid. AUTH_BLOCKED is deliberately absent: signing in again on DMM
	// mints a key AllDebrid holds the same way. It is `confirm`.
	'AUTH_BAD_APIKEY',
	'AUTH_MISSING_APIKEY',
]);

/** Codes for an account the provider refuses whatever the sign-in. */
const ACCOUNT_CODES = new Set([
	// AllDebrid: "This account is banned".
	'AUTH_USER_BANNED',
]);

/** 403 bodies that are about the credential rather than the request. */
const FORBIDDEN_CREDENTIAL_ERRORS = new Set([
	// TorBox
	'AUTH_ERROR',
	'BAD_TOKEN',
	'NO_AUTH',
]);

/**
 * 403 bodies that are about the account. Real-Debrid documents its 403 as
 * "permission denied (account locked, not premium)", and a fresh sign-in
 * mints a token for the same locked or lapsed account. TorBox answers a plan
 * without API access with PLAN_RESTRICTED_FEATURE.
 */
const FORBIDDEN_ACCOUNT_ERRORS = new Set([
	'permission_denied',
	'account_locked',
	'PLAN_RESTRICTED_FEATURE',
]);

/**
 * Premiumize and Offcloud say "not in this account" only in prose. Premiumize
 * files it under `transient_error`, the code it uses for nearly everything, so
 * the message is the one thing that tells a deleted folder from an outage.
 */
const NOT_IN_ACCOUNT = /not found|not owned|not your/i;
const PROSE_ERRORS = new Set(['PremiumizeError', 'OffcloudError']);

type ErrorShape = {
	name?: unknown;
	code?: unknown;
	message?: unknown;
	response?: { status?: unknown; data?: { error?: unknown } | null };
};

/**
 * A connection the far end dropped before answering. `socket hang up` is
 * Node's ECONNRESET on a request that never got a response; undici's `fetch`
 * reports the same thing as `fetch failed` with the code on its cause.
 */
const DROPPED_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

export function isDroppedConnection(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const { code, response } = error as ErrorShape;
	if (response) return false;
	const causeCode = ((error as { cause?: { code?: unknown } }).cause ?? {}).code;
	return (
		(typeof code === 'string' && DROPPED_CONNECTION_CODES.has(code)) ||
		(typeof causeCode === 'string' && DROPPED_CONNECTION_CODES.has(causeCode))
	);
}

/**
 * Runs a read once more when the first attempt's connection was dropped.
 *
 * Only for calls that are safe to repeat, and only for a dropped connection:
 * a timeout already spent the caller's patience, and an HTTP error answer is
 * the provider's considered reply, not a blip.
 */
export async function retryDroppedConnection<T>(call: () => Promise<T>, delayMs = 250): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (!isDroppedConnection(error)) throw error;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		return call();
	}
}

/**
 * Thrown by a provider helper that looked and found the item is not there to
 * play: the provider no longer has it, or the file is missing from it.
 */
export class CastItemGoneError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CastItemGoneError';
	}
}

/**
 * Sorts a provider call's failure into what the addon can tell a client.
 *
 * Duck-typed rather than `instanceof`, so this module does not pull six
 * provider clients into every route that imports it.
 */
export function classifyCastError(error: unknown): CastFailure {
	if (!error || typeof error !== 'object') return 'unavailable';
	const { name, code, message, response } = error as ErrorShape;

	if (name === 'RdTokenExpiredError') return 'credential';
	if (name === 'CastItemGoneError') return 'gone';
	// AllDebrid holding the key for an email confirmation. Read as a temporary
	// failure, it gave the member an empty library and no reason.
	if (code === 'AUTH_BLOCKED') return 'confirm';
	if (typeof code === 'string' && CREDENTIAL_CODES.has(code)) return 'credential';
	if (typeof code === 'string' && ACCOUNT_CODES.has(code)) return 'account';
	if (typeof name === 'string' && PROSE_ERRORS.has(name) && typeof message === 'string') {
		if (NOT_IN_ACCOUNT.test(message)) return 'gone';
	}
	// AllDebrid's per-magnet answer for an id the account does not hold.
	if (code === 'MAGNET_INVALID_ID') return 'gone';

	const status = typeof response?.status === 'number' ? response.status : undefined;
	const vendorError = response?.data?.error;
	if (status === 401) return 'credential';
	if (status === 403 && typeof vendorError === 'string') {
		if (FORBIDDEN_CREDENTIAL_ERRORS.has(vendorError)) return 'credential';
		if (FORBIDDEN_ACCOUNT_ERRORS.has(vendorError)) return 'account';
	}
	// Real-Debrid `unknown_method` / `unknown_ressource`, TorBox `ITEM_NOT_FOUND`.
	if (status === 404) return 'gone';

	return 'unavailable';
}

/**
 * Why a play link could not be sent on to the file. A play is answered to a
 * video player rather than to an addon client, and the member reads the
 * answer from the screen, so it separates refusals the catalog and meta
 * routes have no use for:
 *
 * - `network`: Real-Debrid will not make a link for the player's address.
 * - `refused`: the provider will not serve this one file.
 */
export type CastPlayFailure = CastFailure | 'network' | 'refused';

type ProviderErrorShape = ErrorShape & {
	response?: { status?: unknown; data?: { error?: unknown; error_code?: unknown } | null };
};

const httpStatusOf = (error: unknown): number | undefined => {
	const status = (error as ProviderErrorShape | null)?.response?.status;
	return typeof status === 'number' ? status : undefined;
};

/** The provider's own error name and number from a failed call, when it sent them. */
export function providerErrorDetail(error: unknown): { error?: string; code?: number } {
	const data = (error as ProviderErrorShape | null)?.response?.data;
	if (!data || typeof data !== 'object') return {};
	return {
		error: typeof data.error === 'string' ? data.error : undefined,
		code: typeof data.error_code === 'number' ? data.error_code : undefined,
	};
}

/**
 * Sorts a failed Real-Debrid play.
 *
 * Every 403 is the account's, whatever its body names: Real-Debrid documents
 * 403 as "permission denied (account locked, not premium)", and its refusal of
 * an address (`ip_not_allowed`, error 22) arrives as a 403 too. Neither says
 * anything about the link, which is why only `gone` may ever delete one.
 */
export function classifyRdPlayError(error: unknown): CastPlayFailure {
	const status = httpStatusOf(error);
	const { error: rdError, code } = providerErrorDetail(error);
	if (status === 403) {
		if (code === 22 || rdError?.startsWith('ip_not_allowed')) return 'network';
		return 'account';
	}
	if (status === 401) return 'credential';
	if (rdError === 'hoster_unavailable' || rdError === 'unavailable_file') return 'gone';
	if (status === 451 || rdError === 'infringing_file') return 'refused';
	return classifyCastError(error);
}

/**
 * Sorts a failed TorBox play. TorBox answers a plan without API access with
 * the same 403 it uses for a bad key, and only the body tells them apart -
 * which {@link classifyCastError} reads for every route.
 */
export function classifyTorBoxPlayError(error: unknown): CastPlayFailure {
	return classifyCastError(error);
}

/** AllDebrid codes for an account that cannot unlock anything right now. */
const ALLDEBRID_ACCOUNT_CODES = new Set([
	'MUST_BE_PREMIUM',
	'MAGNET_MUST_BE_PREMIUM',
	'FREE_TRIAL_LIMIT_REACHED',
]);

/**
 * AllDebrid codes for a link it will not unlock. A premium key draws
 * LINK_HOST_NOT_SUPPORTED for a `/f/` token that does not unlock, and so does
 * a key without premium for every link - the play route asks which it is.
 */
const ALLDEBRID_LINK_REFUSED_CODES = new Set([
	'LINK_HOST_NOT_SUPPORTED',
	'LINK_NOT_SUPPORTED',
	'LINK_DOWN',
	'LINK_PASS_PROTECTED',
	'BAD_LINK',
]);

/**
 * Sorts a failed AllDebrid play. AllDebrid sends its refusals inside an HTTP
 * 200 and only the code tells them apart; a throttle is a bare 503.
 */
export function classifyAllDebridPlayError(error: unknown): CastPlayFailure {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === 'AUTH_BLOCKED') return 'confirm';
	if (typeof code === 'string' && ALLDEBRID_ACCOUNT_CODES.has(code)) return 'account';
	if (typeof code === 'string' && ALLDEBRID_LINK_REFUSED_CODES.has(code)) return 'gone';
	return classifyCastError(error);
}

/**
 * The outcome of `work` if it settles within `ms`, or `timedOut` if not. The
 * work is left running, and a late failure is swallowed rather than reported
 * as an unhandled rejection.
 */
export async function settleWithin<T>(
	work: Promise<T>,
	ms: number
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<{ timedOut: true }>((resolve) => {
		timer = setTimeout(() => resolve({ timedOut: true }), ms);
	});
	try {
		return await Promise.race([
			work.then((value) => ({ timedOut: false as const, value })),
			deadline,
		]);
	} finally {
		clearTimeout(timer);
		work.catch(() => undefined);
	}
}
