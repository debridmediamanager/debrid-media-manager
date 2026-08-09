// The SABnzbd download-client surface, forwarded to nzb2rd.
//
// nzb2rd already speaks the whole SABnzbd protocol (its own `src/sabnzbd.ts`),
// so none of it is reimplemented here. This exists because of where the two
// services sit: nzb2rd's API answers on the Tailscale address only, and a
// Radarr/Sonarr instance runs on someone else's machine. DMM is already public
// and already holds the Tailscale link (`getNzb2rdUrl`), so it is the door.
//
// Nothing is interpreted on the way through. The SABnzbd `apikey` is the user's
// Real-Debrid key — it is both their credential and their identity over there,
// and it must never be logged or stored here.

/** Everything under this path is proxied; the rest of DMM is untouched. */
export const SAB_PREFIX = '/api/sabnzbd';

/** Refuse a body larger than this rather than buffering it. An NZB for a big
 *  release runs to a few MB, so this is generous. */
export const MAX_NZB_BYTES = 32 * 1024 * 1024;

/**
 * SABnzbd's own error envelope, which it returns with **HTTP 200**.
 *
 * *arr shows `error` to the user verbatim, so a real sentence gets read. A 502
 * carrying Next.js's HTML error page surfaces instead as an unreadable transport
 * fault, which is the wrong story when the answer is "nzb2rd is down".
 */
export function sabError(message: string): { status: false; error: string } {
	return { status: false, error: message };
}

function splitQuery(url: string): [string, string] {
	const at = url.indexOf('?');
	return at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at + 1)];
}

/**
 * The nzb2rd path to forward to, or null to refuse the request.
 *
 * **Only paths ending in `/api` are forwarded, and that is the whole reason
 * this proxy is safe to expose.** nzb2rd claims exactly those for its SABnzbd
 * surface and serves an unauthenticated management API on everything else —
 * `GET /jobs` lists every user's jobs, `DELETE /jobs/:id` removes any of them.
 * Forwarding anything but `/api` would republish that API to the internet.
 *
 * Whatever precedes the `/api` is nzb2rd's mount root, carried as *arr's URL
 * Base. So a Radarr with URL Base `api/sabnzbd/mnt/zurg/__all__` arrives here as
 * `/api/sabnzbd/mnt/zurg/__all__/api` and reaches nzb2rd as
 * `/mnt/zurg/__all__/api`, which is what makes the `storage` path in history
 * point at the user's own zurg mount. A Windows path cannot survive in a URL, so
 * those users put the mount root in `ma_username` instead and the prefix here is
 * empty — nzb2rd accepts both.
 */
export function sabTargetPath(reqUrl: string | undefined): string | null {
	if (!reqUrl) return null;
	const [rawPath, query] = splitQuery(reqUrl);
	if (rawPath !== SAB_PREFIX && !rawPath.startsWith(`${SAB_PREFIX}/`)) return null;

	const path = rawPath.slice(SAB_PREFIX.length) || '/';
	// A `..` segment would climb back out from under the `/api` suffix check
	// below and reach an arbitrary nzb2rd route.
	if (path.includes('..')) return null;
	// nzb2rd excludes this first for the same reason: a release can contain a
	// file literally named `api`, and swallowing it would break RD's fetch.
	if (path.startsWith('/webseed/')) return null;
	if (!/\/api\/?$/.test(path)) return null;

	return query ? `${path}?${query}` : path;
}

/**
 * The `mode` of a SABnzbd call, for the one log line this proxy writes.
 *
 * Parsed out rather than logging the URL, because the query string also carries
 * the caller's Real-Debrid key and *arr polls `mode=queue` every few seconds —
 * logging the URL would write that key to disk thousands of times a day.
 */
export function sabMode(reqUrl: string | undefined): string {
	const query = splitQuery(reqUrl ?? '')[1];
	const mode = new URLSearchParams(query).get('mode') ?? '';
	return /^[a-z_]{1,32}$/.test(mode) ? mode : '-';
}

/**
 * Whether a mount root has to travel in *arr's **Username** field rather than
 * its URL Base — which is the setup question users get wrong.
 *
 * nzb2rd reads the URL-Base form straight off the raw request path and never
 * percent-decodes it, so `/mnt/my mount` arrives as `/mnt/my%20mount` and every
 * import path it then reports is wrong. A Windows root cannot survive in a URL
 * path at all. `ma_username` is a query parameter, so it decodes normally and
 * both cases work there.
 */
export function needsUsernameSlot(mountRoot: string): boolean {
	const value = mountRoot.trim();
	if (!value) return false;
	return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\') || /[\s%?#]/.test(value);
}

/**
 * The value to paste into *arr's "URL Base" for a given zurg/rclone mount root.
 *
 * The mount root rides in the URL because that is the only field SABnzbd offers
 * that nzb2rd can read as a path — see `sabTargetPath`. A root that cannot make
 * the trip yields the bare prefix, and the caller sends it via the Username
 * field instead.
 */
export function sabUrlBase(mountRoot: string): string {
	const base = SAB_PREFIX.replace(/^\//, '');
	const value = mountRoot.trim();
	if (!value || needsUsernameSlot(value)) return base;
	const cleaned = value.replace(/^\/+/, '').replace(/\/+$/, '');
	return cleaned ? `${base}/${cleaned}` : base;
}
