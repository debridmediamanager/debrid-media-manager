import { readEmbyCatalog } from '@/services/embyPlugins/catalog';
import {
	assemblyOwnedByAnother,
	readEmbyPublishRequest,
	toEmbyPublishedPlugin,
} from '@/services/embyPlugins/publish';
import { catalogObjectKey, pluginObjectKey } from '@/services/jellyfinPlugins/catalog';
import { withCatalogLock } from '@/services/jellyfinPlugins/catalogLock';
import { isAuthorizedPublisher, mergeIntoCatalog } from '@/services/jellyfinPlugins/publish';
import { putStoredObject } from '@/services/newznab/store';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Where an Emby plugin repository's release job puts a built DLL.
 *
 * The same publisher model as `/api/plugins/publish`: one writer for the Emby
 * catalog document, the B2 credentials stay on this deployment, and every
 * repository holds only `PLUGIN_PUBLISH_SECRET` as its `DMM_PUBLISH_TOKEN`. The
 * catalog is merged on the plugin id under the Emby catalog's own lock, so a
 * publish can neither drop another Emby plugin nor touch the Jellyfin catalog.
 *
 * Not the sponsor gate: that is `/api/emby-plugins/*`.
 */

// Base64 of a ~150 KB DLL. The default 1 MB would fail the first time one grew.
export const config = {
	api: {
		bodyParser: {
			sizeLimit: '16mb',
		},
	},
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'no-store');

	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const secret = process.env.PLUGIN_PUBLISH_SECRET;
	if (!secret) {
		console.error('Missing PLUGIN_PUBLISH_SECRET environment variable');
		return res.status(500).json({ error: 'Server misconfiguration' });
	}

	if (!isAuthorizedPublisher(req.headers['x-publish-token'], secret)) {
		console.warn('Rejected an Emby plugin publish with an invalid token');
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const parsed = readEmbyPublishRequest(req.body);
	if ('error' in parsed) return res.status(400).json({ error: parsed.error });

	const entry = toEmbyPublishedPlugin(parsed.payload);

	// The bytes before the descriptor, so the catalog never names an object that
	// is not there yet. The object name carries the content hash, so this never
	// overwrites the bytes behind an entry the live catalog still serves.
	if (
		!(await putStoredObject(
			pluginObjectKey(entry.object, 'emby'),
			parsed.payload.dll,
			'application/octet-stream'
		))
	) {
		return res.status(502).json({ error: 'Could not store the DLL' });
	}

	const locked = await withCatalogLock(async () => {
		const existing = await readEmbyCatalog();
		const owner = assemblyOwnedByAnother(existing, entry);
		if (owner) return { conflict: owner.name } as const;

		const merged = mergeIntoCatalog(existing, entry);
		const body = Buffer.from(JSON.stringify(merged, null, 2) + '\n', 'utf8');
		return {
			catalog: merged,
			stored: await putStoredObject(catalogObjectKey('emby'), body, 'application/json'),
		} as const;
	}, 'emby');

	if (!locked.acquired) {
		console.error(
			`Could not take the Emby plugin catalog lock for ${entry.name} after ${locked.waitedMs} ms`
		);
		return res
			.status(503)
			.json({ error: 'Stored the DLL but the catalog is busy; publish again' });
	}

	console.log(`Took the Emby plugin catalog lock for ${entry.name} after ${locked.waitedMs} ms`);
	const outcome = locked.value;
	if ('conflict' in outcome) {
		return res.status(409).json({
			error: `${entry.assembly} is already published by ${outcome.conflict}`,
		});
	}
	if (!outcome.stored) {
		return res.status(502).json({ error: 'Stored the DLL but could not update the catalog' });
	}

	console.log(`Published ${entry.name} ${entry.version} to the Emby catalog`);
	return res.status(200).json({
		published: entry.name,
		version: entry.version,
		sha256: entry.sha256,
		md5: entry.md5,
		plugins: outcome.catalog.map((plugin) => `${plugin.name} ${plugin.version}`),
	});
}
