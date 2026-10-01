/**
 * The takedown blocklist, for pages that decode hashes in the browser and so
 * never pass through a server-side filter - a shared hash list lives entirely
 * in the URL fragment. An unreachable list hides nothing rather than the page.
 */
let pending: Promise<Set<string>> | null = null;

export const fetchBlockedHashes = (): Promise<Set<string>> => {
	pending ??= fetch('/api/takedown/blocklist')
		.then((res) => (res.ok ? res.json() : { hashes: [] }))
		.then((body) => new Set<string>(Array.isArray(body?.hashes) ? body.hashes : []))
		.catch(() => {
			pending = null;
			return new Set<string>();
		});
	return pending;
};
