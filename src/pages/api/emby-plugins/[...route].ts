import {
	checksumFile,
	findByAssembly,
	parseRequestedFile,
	readEmbyCatalog,
	toListing,
} from '@/services/embyPlugins/catalog';
import { resolvePluginSponsor, setPluginNoStore } from '@/services/jellyfinPlugins/auth';
import { pluginObjectKey } from '@/services/jellyfinPlugins/catalog';
import { getStoredObject } from '@/services/newznab/store';
import { createHash } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The zurg Emby plugins, for sponsors to download.
 *
 * Emby has no third-party plugin repository, so this is not a manifest a server
 * reads: a sponsor downloads one DLL per plugin and drops it into Emby's
 * `plugins/` folder. Three shapes:
 *
 * - `GET /api/emby-plugins/catalog.json` — what is published: each plugin's
 *   version, size, sha256 and the two routes below.
 * - `GET /api/emby-plugins/Emby.Plugin.RdZurg.dll` — the latest build, saved
 *   under the name Emby expects.
 * - `GET /api/emby-plugins/Emby.Plugin.RdZurg.dll.sha256` — its digest, in the
 *   format `shasum -a 256 -c` reads.
 *
 * The key goes in an `X-Api-Key` header, which is what the /emby page and the
 * curl line it gives send, so it never reaches an access log. `?apikey=` is
 * accepted too, like every other sponsor route, and needs the same proxy
 * redaction they do.
 *
 * Every request resolves the key against `Sponsors.dmmApiKey`, nothing is signed
 * or cached, and every answer is `no-store`: revoking a key or a lapsed
 * sponsorship stops the very next download.
 */

function segments(req: NextApiRequest): string[] {
	const route = req.query.route;
	return Array.isArray(route) ? route : typeof route === 'string' ? [route] : [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	setPluginNoStore(res);

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('Allow', 'GET, HEAD');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const parts = segments(req);
	if (parts.length !== 1) return res.status(404).json({ error: 'No such plugin route' });
	const [file] = parts;

	if (file === 'catalog.json') {
		const auth = await resolvePluginSponsor(req);
		if ('status' in auth) return res.status(auth.status).json({ error: auth.error });

		const plugins = await readEmbyCatalog();
		if (!plugins) return res.status(503).json({ error: 'The plugin catalog is unavailable' });

		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		return res.status(200).send(JSON.stringify(toListing(plugins)));
	}

	// Checked before the key: an unpublishable filename is not a credential
	// problem, and answering 401 for it would say a real key had failed.
	const requested = parseRequestedFile(file);
	if (!requested) return res.status(404).json({ error: 'No such plugin file' });

	const auth = await resolvePluginSponsor(req);
	if ('status' in auth) return res.status(auth.status).json({ error: auth.error });

	const plugins = await readEmbyCatalog();
	if (!plugins) return res.status(503).json({ error: 'The plugin catalog is unavailable' });

	// Only what the catalog names, so the route cannot read arbitrary objects.
	const plugin = findByAssembly(plugins, requested.assembly);
	if (!plugin) return res.status(404).json({ error: 'No such plugin file' });

	res.setHeader('X-Plugin-Version', plugin.version);

	if (requested.kind === 'sha256') {
		const body = checksumFile(plugin);
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		res.setHeader('Content-Length', String(Buffer.byteLength(body)));
		if (req.method === 'HEAD') return res.status(200).end();
		return res.status(200).send(body);
	}

	const bytes = await getStoredObject(pluginObjectKey(plugin.object, 'emby'));
	if (!bytes) return res.status(502).json({ error: 'The plugin file could not be read' });

	// A DLL that does not match its catalog entry is never handed out: Emby would
	// load whatever it is, and the sponsor would check it against this digest.
	if (createHash('sha256').update(bytes).digest('hex') !== plugin.sha256) {
		console.error(`Stored ${plugin.object} does not match its catalog sha256`);
		return res.status(502).json({ error: 'The plugin file could not be read' });
	}

	res.setHeader('Content-Type', 'application/octet-stream');
	res.setHeader('Content-Disposition', `attachment; filename="${plugin.assembly}"`);
	res.setHeader('Content-Length', String(bytes.length));
	res.setHeader('X-Checksum-Sha256', plugin.sha256);
	res.setHeader('X-Content-Type-Options', 'nosniff');
	if (req.method === 'HEAD') return res.status(200).end();
	return res.status(200).send(bytes);
}
