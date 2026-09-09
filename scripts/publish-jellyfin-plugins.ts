/**
 * Publishes built Jellyfin plugin ZIPs to the sponsor-gated catalog.
 *
 * The plugin repositories are private and this one is public, so the artifacts
 * live in a B2 bucket and are served by `/api/plugins/*` to sponsors only.
 * Nothing is committed here.
 *
 *   npx tsx scripts/publish-jellyfin-plugins.ts path/to/rd-zurg_1.0.2.0.zip …
 *   npx tsx scripts/publish-jellyfin-plugins.ts --apply path/to/*.zip
 *
 * It posts to `/api/plugins/publish` rather than writing the bucket directly, so
 * a publish from a laptop and a publish from a plugin repository's release job
 * take the same path: one writer, the same merge, and the bucket credentials
 * only ever on the server. Set `DMM_PUBLISH_TOKEN`, and `DMM_PUBLISH_URL` when
 * targeting something other than production.
 *
 * The plugin's `build.sh` leaves an unpacked directory beside every ZIP, so the
 * `meta.json` and card image are read from there rather than by unpacking the
 * archive, which keeps this repository free of a zip dependency.
 *
 * Each plugin is published on its own. Publishing one leaves the others in the
 * catalog untouched, so there is no need to pass all four.
 */
import { readFile } from 'fs/promises';
import path from 'path';

const DEFAULT_URL = 'https://debridmediamanager.com';

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
	file: string;
	meta: PluginMeta;
	zip: Buffer;
	image: Buffer | null;
}

async function prepare(file: string): Promise<Prepared> {
	if (!file.endsWith('.zip')) throw new Error(`${file} is not a .zip`);

	const zip = await readFile(file);
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

	const image = meta.imagePath ? await readFile(path.join(unpacked, meta.imagePath)) : null;

	return { file: zipName, meta, zip, image };
}

async function publish(prepared: Prepared, base: string, token: string): Promise<void> {
	const response = await fetch(`${base.replace(/\/+$/, '')}/api/plugins/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-publish-token': token },
		body: JSON.stringify({
			file: prepared.file,
			zip: prepared.zip.toString('base64'),
			meta: prepared.meta,
			image: prepared.image ? prepared.image.toString('base64') : null,
		}),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${prepared.file}: HTTP ${response.status} ${text.slice(0, 300)}`);
	}
	console.log(`published ${prepared.file}  ${text.slice(0, 300)}`);
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

	for (const { file, meta, zip, image } of prepared) {
		console.log(
			`${meta.name} ${meta.version}  abi ${meta.targetAbi}  ${zip.length} bytes` +
				(image ? ` + ${image.length} byte image` : '')
		);
		console.log(`   -> ${file}`);
	}

	if (!apply) {
		console.log('\nDry run. Re-run with --apply to publish.');
		return;
	}

	const token = process.env.DMM_PUBLISH_TOKEN;
	if (!token) throw new Error('DMM_PUBLISH_TOKEN is not set');
	const base = process.env.DMM_PUBLISH_URL || DEFAULT_URL;

	// One at a time. The endpoint merges each publish into the catalog, so two
	// at once could read the same catalog and one would lose its entry.
	for (const entry of prepared) {
		await publish(entry, base, token);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
