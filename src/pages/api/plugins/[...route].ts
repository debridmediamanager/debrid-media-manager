import { resolvePluginSponsor } from '@/services/jellyfinPlugins/auth';
import {
	buildManifest,
	pluginObjectKey,
	readPublishedPlugins,
	servableContentType,
} from '@/services/jellyfinPlugins/catalog';
import { getStoredObject } from '@/services/newznab/store';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * DMM as a Jellyfin plugin repository, for sponsors' own Jellyfin servers.
 *
 * Two shapes, because Jellyfin can only carry a credential in two places:
 *
 * - `GET /api/plugins/manifest.json?apikey=KEY` — the repository URL a sponsor
 *   pastes into Dashboard → Plugins → Repositories. Jellyfin sends the query
 *   string back verbatim on every refresh.
 * - `GET /api/plugins/KEY/rd-zurg_1.0.2.0.zip` — the download. The key is a
 *   **path segment** because Jellyfin decides whether a `sourceUrl` is
 *   installable by looking at the end of the URL: with a query string it
 *   refuses the URL as "not a zip archive" without ever fetching it.
 *
 * Both resolve the key against `Sponsors.dmmApiKey` on every request, and both
 * answer `no-store`, so a revoked key or a lapsed sponsorship stops working on
 * the next request instead of when a cache or a signature expires. The manifest
 * mints download URLs carrying the caller's own key, so a manifest fetched by
 * one sponsor is worthless to anyone else and worthless to them once the key is
 * gone.
 *
 * Note the key appears in the request path, so it reaches the reverse proxy's
 * access log the way `apikey=` does on the Newznab routes; redact both.
 */

/**
 * The origin to mint download URLs against.
 *
 * Deliberately not the `Host` header, for the reason the Newznab endpoint gives:
 * DMM is reached through Cloudflare and a reverse proxy, so a spoofed Host would
 * mint URLs pointing at someone else's server. Shares `NEWZNAB_PUBLIC_BASE`,
 * which is already the answer to "where is this deployment publicly".
 */
function publicBase(): string {
	return (process.env.NEWZNAB_PUBLIC_BASE || 'https://debridmediamanager.com').replace(
		/\/+$/,
		''
	);
}

/** Nothing here may be cached: the URL contains the credential being checked. */
function noStore(res: NextApiResponse): void {
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Referrer-Policy', 'no-referrer');
}

function segments(req: NextApiRequest): string[] {
	const route = req.query.route;
	return Array.isArray(route) ? route : typeof route === 'string' ? [route] : [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	noStore(res);

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('Allow', 'GET, HEAD');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const parts = segments(req);

	// The repository URL. The key is in the query, which Jellyfin preserves.
	if (parts.length === 1 && parts[0] === 'manifest.json') {
		const auth = await resolvePluginSponsor(req);
		if ('status' in auth) return res.status(auth.status).json({ error: auth.error });

		const plugins = await readPublishedPlugins();
		if (!plugins) return res.status(503).json({ error: 'The plugin catalog is unavailable' });

		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		return res
			.status(200)
			.send(JSON.stringify(buildManifest(plugins, publicBase(), auth.apiKey)));
	}

	// A download. The key is the first segment so the URL still ends in `.zip`.
	if (parts.length === 2) {
		const [key, file] = parts;
		const contentType = servableContentType(file);
		// Checked before the key: an unpublishable filename is not a credential
		// problem, and answering 401 for it would say a real key had failed.
		if (!contentType) return res.status(404).json({ error: 'No such plugin file' });

		const auth = await resolvePluginSponsor(req, key);
		if ('status' in auth) return res.status(auth.status).json({ error: auth.error });

		const plugins = await readPublishedPlugins();
		// Only files this catalog actually published, so the route cannot be used
		// to read arbitrary objects out of the bucket.
		const published =
			plugins?.some(
				(plugin) =>
					plugin.image === file ||
					plugin.versions.some((version) => version.file === file)
			) ?? false;
		if (!published) return res.status(404).json({ error: 'No such plugin file' });

		const bytes = await getStoredObject(pluginObjectKey(file));
		if (!bytes) return res.status(502).json({ error: 'The plugin file could not be read' });

		res.setHeader('Content-Type', contentType);
		res.setHeader('Content-Length', String(bytes.length));
		if (req.method === 'HEAD') return res.status(200).end();
		return res.status(200).send(bytes);
	}

	return res.status(404).json({ error: 'No such plugin route' });
}
