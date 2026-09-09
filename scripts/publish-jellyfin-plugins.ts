/**
 * Publishes built Jellyfin plugin ZIPs to the sponsor-gated catalog.
 *
 * The plugin repositories are private and this one is public, so the artifacts
 * live in the same B2 bucket the Newznab store uses and are served by
 * `/api/plugins/*` to sponsors only. Nothing is committed here.
 *
 *   npx tsx scripts/publish-jellyfin-plugins.ts path/to/rd-zurg_1.0.2.0.zip …
 *   npx tsx scripts/publish-jellyfin-plugins.ts --apply path/to/*.zip
 *
 * The plugin's `build.sh` leaves an unpacked directory beside every ZIP, so the
 * `meta.json` and `thumb.png` are read from there rather than by unpacking the
 * archive — which keeps this repository free of a zip dependency it would
 * otherwise carry for one script. The catalog's version, GUID, ABI and
 * description therefore always come from the artifact rather than being
 * restated here.
 *
 * Publishing replaces `catalog.json` wholesale, so pass every plugin you want
 * listed, not just the one that changed.
 */
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import {
	CATALOG_OBJECT_KEY,
	pluginObjectKey,
	type PublishedPlugin,
} from '../src/services/jellyfinPlugins/catalog';
import { putStoredObject } from '../src/services/newznab/store';

interface PluginMeta {
	category: string;
	changelog: string;
	description: string;
	guid: string;
	name: string;
	overview: string;
	owner: string;
	targetAbi: string;
	timestamp: string;
	version: string;
	imagePath?: string;
}

interface Prepared {
	plugin: PublishedPlugin;
	uploads: { key: string; body: Buffer; contentType: string }[];
}

async function prepare(file: string): Promise<Prepared> {
	if (!file.endsWith('.zip')) throw new Error(`${file} is not a .zip`);

	const bytes = await readFile(file);
	const zipName = path.basename(file);
	// build.sh writes `artifacts/<slug>_<version>/` beside `<slug>_<version>.zip`.
	const unpacked = file.slice(0, -'.zip'.length);

	let meta: PluginMeta;
	try {
		meta = JSON.parse(await readFile(path.join(unpacked, 'meta.json'), 'utf8')) as PluginMeta;
	} catch {
		throw new Error(
			`${zipName} has no unpacked ${path.basename(unpacked)}/meta.json beside it; run ./build.sh first`
		);
	}

	const uploads: Prepared['uploads'] = [
		{ key: pluginObjectKey(zipName), body: bytes, contentType: 'application/zip' },
	];

	// The card image is part of the package; taking the same file means the
	// catalog listing and the installed plugin can never show different art.
	let image: string | undefined;
	if (meta.imagePath) {
		image = `${zipName.replace(/\.zip$/, '')}.png`;
		uploads.push({
			key: pluginObjectKey(image),
			body: await readFile(path.join(unpacked, meta.imagePath)),
			contentType: 'image/png',
		});
	}

	return {
		plugin: {
			category: meta.category,
			description: meta.description,
			guid: meta.guid,
			name: meta.name,
			overview: meta.overview,
			owner: meta.owner,
			...(image ? { image } : {}),
			versions: [
				{
					version: meta.version,
					changelog: meta.changelog,
					targetAbi: meta.targetAbi,
					file: zipName,
					// MD5 is what Jellyfin's installer verifies, not SHA-256.
					checksum: createHash('md5').update(bytes).digest('hex'),
					timestamp: meta.timestamp,
				},
			],
		},
		uploads,
	};
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes('--apply');
	const files = args.filter((arg) => arg !== '--apply');

	if (files.length === 0) {
		console.error('Usage: publish-jellyfin-plugins.ts [--apply] <plugin.zip> …');
		process.exit(2);
	}

	const prepared = await Promise.all(files.map(prepare));
	const catalog = prepared.map((entry) => entry.plugin);

	for (const { plugin, uploads } of prepared) {
		const version = plugin.versions[0];
		console.log(
			`${plugin.name} ${version.version}  abi ${version.targetAbi}  md5 ${version.checksum}`
		);
		for (const upload of uploads) console.log(`   ${upload.key} (${upload.body.length} bytes)`);
	}

	const catalogBody = Buffer.from(JSON.stringify(catalog, null, 2) + '\n', 'utf8');
	console.log(`   ${CATALOG_OBJECT_KEY} (${catalogBody.length} bytes)`);

	if (!apply) {
		console.log('\nDry run. Re-run with --apply to publish.');
		return;
	}

	// Artifacts before the descriptor: a catalog that names a file nobody can
	// download is worse than one that has not been updated yet.
	for (const { uploads } of prepared) {
		for (const upload of uploads) {
			const ok = await putStoredObject(upload.key, upload.body, upload.contentType);
			if (!ok) throw new Error(`Failed to upload ${upload.key}`);
			console.log(`uploaded ${upload.key}`);
		}
	}

	if (!(await putStoredObject(CATALOG_OBJECT_KEY, catalogBody, 'application/json'))) {
		throw new Error('Uploaded the artifacts but failed to write the catalog');
	}
	console.log(`uploaded ${CATALOG_OBJECT_KEY}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
