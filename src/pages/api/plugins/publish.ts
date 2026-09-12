import {
	CATALOG_OBJECT_KEY,
	pluginObjectKey,
	readPublishedPlugins,
} from '@/services/jellyfinPlugins/catalog';
import { withCatalogLock } from '@/services/jellyfinPlugins/catalogLock';
import {
	isAuthorizedPublisher,
	mergeIntoCatalog,
	readPublishRequest,
	toPublishedPlugin,
} from '@/services/jellyfinPlugins/publish';
import { putStoredObject } from '@/services/newznab/store';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Where a plugin repository's release job puts a built plugin.
 *
 * The four repositories are private and build their own ZIPs, but they share one
 * catalog document, so none of them can write it alone. Posting the package here
 * keeps a single writer: the merge happens server-side, the B2 credentials stay
 * on this deployment, and each repository holds only a publish token that can be
 * rotated in one place.
 *
 * Not the sponsor gate. `PLUGIN_PUBLISH_SECRET` is a publisher credential and
 * has nothing to do with `Sponsors.dmmApiKey`, which is what `/api/plugins/*`
 * checks when a Jellyfin server reads the catalog.
 */

// Base64 of a ~100 KB ZIP plus its card image. The default 1 MB would be enough
// today and would fail the first time a plugin grew.
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
		console.warn('Rejected a plugin publish with an invalid token');
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const parsed = readPublishRequest(req.body);
	if ('error' in parsed) return res.status(400).json({ error: parsed.error });

	const { payload } = parsed;
	const entry = toPublishedPlugin(payload);

	// Artifacts before the descriptor. A catalog naming a file that is not there
	// yet would offer sponsors an update that cannot install.
	if (
		!(await putStoredObject(
			pluginObjectKey(payload.request.file),
			payload.zip,
			'application/zip'
		))
	) {
		return res.status(502).json({ error: 'Could not store the package' });
	}

	if (payload.image && payload.imageFile) {
		if (
			!(await putStoredObject(pluginObjectKey(payload.imageFile), payload.image, 'image/png'))
		) {
			return res.status(502).json({ error: 'Could not store the image' });
		}
	}

	// Read, merge and write under a lock every replica shares. Without it two publishes
	// arriving together each merge into the catalog as it was before the other wrote,
	// and the later write drops the earlier plugin.
	const locked = await withCatalogLock(async () => {
		const merged = mergeIntoCatalog(await readPublishedPlugins(), entry);
		const body = Buffer.from(JSON.stringify(merged, null, 2) + '\n', 'utf8');
		return {
			catalog: merged,
			stored: await putStoredObject(CATALOG_OBJECT_KEY, body, 'application/json'),
		};
	});

	if (!locked.acquired) {
		console.error(
			`Could not take the plugin catalog lock for ${entry.name} after ${locked.waitedMs} ms`
		);
		return res
			.status(503)
			.json({ error: 'Stored the package but the catalog is busy; publish again' });
	}

	console.log(`Took the plugin catalog lock for ${entry.name} after ${locked.waitedMs} ms`);
	const { catalog, stored } = locked.value;
	if (!stored) {
		return res
			.status(502)
			.json({ error: 'Stored the package but could not update the catalog' });
	}

	console.log(`Published ${entry.name} ${entry.versions[0].version} to the Jellyfin catalog`);
	return res.status(200).json({
		published: entry.name,
		version: entry.versions[0].version,
		checksum: entry.versions[0].checksum,
		plugins: catalog.map((plugin) => `${plugin.name} ${plugin.versions[0].version}`),
	});
}
