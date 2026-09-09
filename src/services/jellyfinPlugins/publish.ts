// Taking a built plugin into the catalog.
//
// The four plugin repositories are private and build their own ZIPs, but the
// catalog is one document covering all of them. So a repository cannot simply
// write its own file: it has to replace its entry and leave the other three
// alone. That merge lives here, on the server, so there is exactly one writer
// and the B2 credentials never leave this deployment.

import { createHash, timingSafeEqual } from 'crypto';
import type { PublishedPlugin, PublishedVersion } from './catalog';

/** A version string Jellyfin will accept, and that our packaging produces. */
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** The lowercase-hex GUID shape Jellyfin plugins use, with dashes. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A published filename: no separators, no traversal, and one known extension. */
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(zip|png)$/;

export interface PublishRequest {
	/** The ZIP's filename, which becomes its object key and its `sourceUrl`. */
	file: string;
	/** The ZIP itself, base64. */
	zip: string;
	/** The plugin's own `meta.json`, as the build wrote it. */
	meta: {
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
	};
	/** The card image, base64, when the package carries one. */
	image?: string | null;
}

export interface PublishPayload {
	request: PublishRequest;
	zip: Buffer;
	image: Buffer | null;
	imageFile: string | null;
}

/**
 * Whether a caller presented the publish secret.
 *
 * Compared in constant time, and a deployment with no secret configured refuses
 * everything rather than accepting anything.
 *
 * @param presented The token from the request.
 * @param expected The configured secret.
 * @returns Whether they match.
 */
export function isAuthorizedPublisher(presented: unknown, expected: string | undefined): boolean {
	if (!expected || typeof presented !== 'string' || presented.length === 0) return false;
	const a = Buffer.from(presented, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function decode(value: unknown, limit: number): Buffer | null {
	if (typeof value !== 'string' || value.length === 0) return null;
	const bytes = Buffer.from(value, 'base64');
	if (bytes.length === 0 || bytes.length > limit) return null;
	return bytes;
}

/** A ZIP starts `PK\x03\x04`, and a PNG with its own 8-byte signature. */
function looksLikeZip(bytes: Buffer): boolean {
	return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function looksLikePng(bytes: Buffer): boolean {
	return bytes.length > 8 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
}

/**
 * Reads a publish request, or says why it is not one.
 *
 * Everything the catalog will later hand to a Jellyfin server is checked here:
 * a filename that cannot escape the prefix, a version and GUID of the right
 * shape, and payloads that really are the file types they claim.
 *
 * @param body The parsed request body.
 * @param maxBytes The largest payload to accept, per file.
 * @returns The payload, or an error to answer with.
 */
export function readPublishRequest(
	body: unknown,
	maxBytes = 32 * 1024 * 1024
): { payload: PublishPayload } | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Expected a JSON body' };
	const request = body as PublishRequest;

	if (
		typeof request.file !== 'string' ||
		!FILE.test(request.file) ||
		!request.file.endsWith('.zip')
	) {
		return { error: 'file must be a plain .zip filename' };
	}

	const meta = request.meta;
	if (!meta || typeof meta !== 'object') return { error: 'meta is required' };
	for (const key of [
		'category',
		'changelog',
		'description',
		'guid',
		'name',
		'overview',
		'owner',
		'targetAbi',
		'timestamp',
		'version',
	] as const) {
		if (typeof meta[key] !== 'string' || meta[key].length === 0) {
			return { error: `meta.${key} is required` };
		}
	}
	if (!VERSION.test(meta.version)) return { error: 'meta.version must be four numbers' };
	if (!GUID.test(meta.guid)) return { error: 'meta.guid is not a plugin GUID' };

	const zip = decode(request.zip, maxBytes);
	if (!zip) return { error: 'zip must be base64 and within the size limit' };
	if (!looksLikeZip(zip)) return { error: 'zip does not begin like a ZIP archive' };

	let image: Buffer | null = null;
	let imageFile: string | null = null;
	if (request.image) {
		image = decode(request.image, maxBytes);
		if (!image) return { error: 'image must be base64 and within the size limit' };
		if (!looksLikePng(image)) return { error: 'image does not begin like a PNG' };
		imageFile = request.file.replace(/\.zip$/, '.png');
		if (!FILE.test(imageFile)) return { error: 'the image filename is not usable' };
	}

	return { payload: { request, zip, image, imageFile } };
}

/**
 * The catalog entry a payload describes.
 *
 * The checksum is computed here rather than taken from the caller, so the
 * catalog can never advertise a digest that does not match the bytes it stores.
 *
 * @param payload The validated payload.
 * @returns The entry to merge into the catalog.
 */
export function toPublishedPlugin(payload: PublishPayload): PublishedPlugin {
	const { request, zip, imageFile } = payload;
	const version: PublishedVersion = {
		version: request.meta.version,
		changelog: request.meta.changelog,
		targetAbi: request.meta.targetAbi,
		file: request.file,
		checksum: createHash('md5').update(zip).digest('hex'),
		timestamp: request.meta.timestamp,
	};

	return {
		category: request.meta.category,
		description: request.meta.description,
		guid: request.meta.guid,
		name: request.meta.name,
		overview: request.meta.overview,
		owner: request.meta.owner,
		...(imageFile ? { image: imageFile } : {}),
		versions: [version],
	};
}

/**
 * Replaces one plugin's entry, leaving every other plugin untouched.
 *
 * Matched on GUID rather than name, because the GUID is what Jellyfin installs
 * against and a plugin could be renamed without becoming a different plugin.
 *
 * @param existing The catalog as it stands, or null when nothing is published.
 * @param entry The entry to put in.
 * @returns The catalog to store.
 */
export function mergeIntoCatalog(
	existing: PublishedPlugin[] | null,
	entry: PublishedPlugin
): PublishedPlugin[] {
	const others = (existing ?? []).filter(
		(plugin) => plugin.guid.toLowerCase() !== entry.guid.toLowerCase()
	);
	return [...others, entry].sort((a, b) => a.name.localeCompare(b.name));
}
