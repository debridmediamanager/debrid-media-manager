/**
 * Trakt and Simkl linking for the DMM Kodi addon. Kodi starts the tracker's device
 * flow, polls and refreshes through these calls, keeps the tokens itself and reads
 * watched history straight from the tracker. DMM holds Trakt's client secret, which
 * the device poll and refresh need; DMM's Simkl app is a public client with no secret.
 * Nothing is stored here.
 */

export type Tracker = 'trakt' | 'simkl';

export const TRACKER_NAMES: Record<Tracker, string> = { trakt: 'Trakt', simkl: 'Simkl' };

export const isTracker = (value: unknown): value is Tracker =>
	value === 'trakt' || value === 'simkl';

/** Device codes and refresh tokens are opaque printable strings; anything else is a bad body. */
export const isTrackerCode = (value: unknown): value is string =>
	typeof value === 'string' && /^[!-~]{8,2048}$/.test(value);

export interface TrackerTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
}

export interface TrackerUser {
	name: string;
	slug: string;
}

const USER_AGENT = 'debridmediamanager/1.0';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

class NotSetUpError extends Error {}

/** What Kodi is told when a call fails: missing env vars, or the tracker not answering. */
export function unavailableMessage(service: Tracker, error: unknown): string {
	return error instanceof NotSetUpError
		? `${TRACKER_NAMES[service]} linking is not set up on this DMM`
		: `Could not reach ${TRACKER_NAMES[service]} right now. Try again in a minute.`;
}

type Client = { id: string; secret: string };

/** The app DMM links as. Both client ids are public; only Trakt has a secret. */
function client(service: Tracker): Client {
	const id = process.env[service === 'trakt' ? 'TRAKT_CLIENT_ID' : 'SIMKL_V2_CLIENT_ID']?.trim();
	const secret = process.env.TRAKT_CLIENT_SECRET?.trim() ?? '';
	if (!id || (service === 'trakt' && !secret)) {
		throw new NotSetUpError(`${TRACKER_NAMES[service]} is not configured`);
	}
	return { id, secret };
}

/**
 * One call to the tracker, POST when `body` is given. Errors carry only the tracker and
 * status: a Trakt request body holds the client secret and must never reach a log.
 */
async function call(
	service: Tracker,
	{ id }: Client,
	path: string,
	body?: Record<string, string>,
	accessToken?: string
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
	if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
	let url: string;
	let payload: string | URLSearchParams | undefined;
	if (service === 'trakt') {
		url = `https://api.trakt.tv${path}`;
		Object.assign(headers, {
			'Content-Type': 'application/json',
			'trakt-api-version': '2',
			'trakt-api-key': id,
		});
		payload = body && JSON.stringify(body);
	} else {
		// Simkl wants these three on every call, the OAuth ones included.
		const query = new URLSearchParams({
			client_id: id,
			'app-name': 'debridmediamanager',
			'app-version': '1.0',
		});
		url = `https://api.simkl.com${path}?${query}`;
		// Simkl's /oauth2/* endpoints take a form body (RFC 6749); fetch sets the type.
		payload = body && new URLSearchParams(body);
	}

	const res = await fetch(url, {
		method: payload ? 'POST' : 'GET',
		headers,
		body: payload,
		signal: AbortSignal.timeout(10_000),
	});
	const text = await res.text();
	try {
		return { status: res.status, data: JSON.parse(text) };
	} catch {
		// Trakt answers its device-poll states with an empty body.
		return { status: res.status, data: null };
	}
}

const refused = (service: Tracker, status: number) =>
	new Error(`${TRACKER_NAMES[service]} answered ${status}`);

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function toTokens(service: Tracker, data: any): TrackerTokens {
	if (
		!isText(data?.access_token) ||
		!isText(data?.refresh_token) ||
		typeof data?.expires_in !== 'number'
	) {
		throw new Error(`${TRACKER_NAMES[service]} sent no usable token`);
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
	};
}

/** The tracker's code, its approve page with the code filled in, and the device code to poll with. */
export async function startDeviceLink(service: Tracker) {
	const c = client(service);
	const { status, data } =
		service === 'trakt'
			? await call(service, c, '/oauth/device/code', { client_id: c.id })
			: // Read-only on purpose: DMM reads history; scrobbling stays with Simkl's own Kodi addon.
				// Simkl's auth.md says every V2 flow needs PKCE; the device page documents none and a live
				// start on 2026-11-09 needed none. If polls fail with invalid_grant "PKCE verification
				// failed", add code_challenge here.
				await call(service, c, '/oauth2/device', { client_id: c.id, scope: 'media:read' });
	// Trakt's page takes the code as a path segment (auth.trakt.tv/activate/<code>).
	const verifyUrl =
		service === 'trakt'
			? isText(data?.verification_url) &&
				`${data.verification_url.replace(/\/+$/, '')}/${encodeURIComponent(data.user_code)}`
			: data?.verification_uri_complete;
	if (
		status !== 200 ||
		!isText(data?.device_code) ||
		!isText(data?.user_code) ||
		!isText(verifyUrl) ||
		typeof data?.interval !== 'number' ||
		typeof data?.expires_in !== 'number'
	) {
		throw refused(service, status);
	}
	return {
		userCode: data.user_code as string,
		deviceCode: data.device_code as string,
		verifyUrl,
		interval: data.interval as number,
		expiresIn: data.expires_in as number,
	};
}

/** Who linked, for Kodi to show. Best effort: the token is what matters. */
async function fetchUser(
	service: Tracker,
	c: Client,
	accessToken: string
): Promise<TrackerUser | null> {
	try {
		const { status, data } = await call(service, c, '/users/settings', undefined, accessToken);
		const name = service === 'trakt' ? data?.user?.username : data?.user?.name;
		if (status !== 200 || !isText(name)) return null;
		const slug = service === 'trakt' ? data.user.ids?.slug : data.account?.id;
		return { name, slug: isText(slug) || typeof slug === 'number' ? String(slug) : name };
	} catch {
		return null;
	}
}

/**
 * One poll of the device code: still waiting, dead, or the tokens, who approved, and the
 * client id Kodi sends on its own reads (`trakt-api-key`, Simkl's `client_id`).
 */
export async function pollDeviceLink(
	service: Tracker,
	deviceCode: string
): Promise<
	'pending' | 'expired' | (TrackerTokens & { clientId: string; user: TrackerUser | null })
> {
	const c = client(service);
	const { status, data } =
		service === 'trakt'
			? await call(service, c, '/oauth/device/token', {
					code: deviceCode,
					client_id: c.id,
					client_secret: c.secret,
				})
			: await call(service, c, '/oauth2/token', {
					grant_type: DEVICE_GRANT,
					client_id: c.id,
					device_code: deviceCode,
				});
	if (status === 200) {
		const tokens = toTokens(service, data);
		return {
			...tokens,
			clientId: c.id,
			user: await fetchUser(service, c, tokens.accessToken),
		};
	}
	if (service === 'trakt') {
		// 400 waiting, 429 slow down; 404 unknown, 409 used, 410 expired, 418 denied.
		if (status === 400 || status === 429) return 'pending';
		if ([404, 409, 410, 418].includes(status)) return 'expired';
	} else if (status === 400) {
		// Simkl records no denial: a declined code stays authorization_pending until it expires.
		if (data?.error === 'authorization_pending' || data?.error === 'slow_down')
			return 'pending';
		if (data?.error === 'expired_token') return 'expired';
	}
	throw refused(service, status);
}

/** A fresh access token, or 'relink' when the tracker no longer honours the grant. */
export async function refreshLink(
	service: Tracker,
	refreshToken: string
): Promise<TrackerTokens | 'relink'> {
	const c = client(service);
	const { status, data } =
		service === 'trakt'
			? await call(service, c, '/oauth/token', {
					refresh_token: refreshToken,
					client_id: c.id,
					client_secret: c.secret,
					redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
					grant_type: 'refresh_token',
				})
			: await call(service, c, '/oauth2/token', {
					grant_type: 'refresh_token',
					client_id: c.id,
					refresh_token: refreshToken,
				});
	if (status === 200) return toTokens(service, data);
	// A refused client is DMM's to fix; making the member link again would not help.
	if ((status === 400 || status === 401) && data?.error !== 'invalid_client') return 'relink';
	throw refused(service, status);
}
