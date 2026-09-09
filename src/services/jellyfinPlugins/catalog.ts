// The Jellyfin plugin catalog DMM serves to sponsors.
//
// Jellyfin's plugin installer is anonymous — it has no session and cannot be
// told to send a header — so the caller's own API key is threaded through every
// URL the manifest hands back. That is the same trick the Newznab endpoint uses
// for enclosure URLs, and for the same reason.
//
// The key rides in a **path segment** on the download, never the query string:
// Jellyfin decides whether a `sourceUrl` is installable by looking at the end of
// the URL, so `…/plugin.zip?apikey=…` is rejected as "not a zip archive" before
// it makes any request. Measured on Jellyfin 12.0.
//
// Nothing here is signed or time-limited. A URL is only ever as good as the key
// inside it, and that key is resolved against the database on every request, so
// revocation takes effect immediately rather than when something expires.

import { getStoredObject } from '@/services/newznab/store';

/** Where the published artifacts live inside the shared B2 bucket. */
const PREFIX = 'jellyfin-plugins';

/** The descriptor the publish script writes beside the artifacts. */
export const CATALOG_OBJECT_KEY = `${PREFIX}/catalog.json`;

/** A file the catalog is allowed to serve, and the type it is served as. */
const SERVABLE: Record<string, string> = {
	'.zip': 'application/zip',
	'.png': 'image/png',
};

export interface PublishedVersion {
	version: string;
	changelog: string;
	targetAbi: string;
	/** Bare filename inside the prefix, e.g. `rd-zurg_1.0.2.0.zip`. */
	file: string;
	/** MD5, which is the digest Jellyfin's installer verifies. */
	checksum: string;
	timestamp: string;
}

export interface PublishedPlugin {
	category: string;
	description: string;
	guid: string;
	name: string;
	overview: string;
	owner: string;
	/** Bare filename of the card image inside the prefix. */
	image?: string;
	versions: PublishedVersion[];
}

/** What Jellyfin's repository format actually expects. */
interface ManifestVersion {
	version: string;
	changelog: string;
	targetAbi: string;
	sourceUrl: string;
	checksum: string;
	timestamp: string;
}

interface ManifestEntry {
	category: string;
	description: string;
	guid: string;
	name: string;
	overview: string;
	owner: string;
	imageUrl?: string;
	versions: ManifestVersion[];
}

/**
 * Rejects anything that is not a plain filename we published.
 *
 * The filename arrives from the URL, so it is checked rather than trusted: no
 * separators, no traversal, and an extension the catalog serves.
 *
 * @param file The candidate filename.
 * @returns The content type to serve it as, or null.
 */
export function servableContentType(file: string): string | null {
	if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) return null;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file)) return null;

	const dot = file.lastIndexOf('.');
	if (dot <= 0) return null;
	return SERVABLE[file.slice(dot).toLowerCase()] ?? null;
}

/** The B2 object key for a published file. */
export function pluginObjectKey(file: string): string {
	return `${PREFIX}/${file}`;
}

/**
 * The published descriptor, or null when nothing has been published yet.
 *
 * @returns The plugins as the publish script recorded them.
 */
export async function readPublishedPlugins(): Promise<PublishedPlugin[] | null> {
	const bytes = await getStoredObject(CATALOG_OBJECT_KEY);
	if (!bytes) return null;

	try {
		const parsed = JSON.parse(bytes.toString('utf8'));
		return Array.isArray(parsed) ? (parsed as PublishedPlugin[]) : null;
	} catch (error) {
		console.error('Error parsing the Jellyfin plugin catalog:', error);
		return null;
	}
}

/**
 * Turns the published descriptor into the manifest Jellyfin reads, with every
 * URL carrying the caller's own key.
 *
 * @param plugins The published plugins.
 * @param baseUrl Absolute origin this server is reached at, no trailing slash.
 * @param apiKey The caller's DMM API key.
 * @returns The manifest body.
 */
export function buildManifest(
	plugins: PublishedPlugin[],
	baseUrl: string,
	apiKey: string
): ManifestEntry[] {
	const keyed = (file: string) =>
		`${baseUrl}/api/plugins/${encodeURIComponent(apiKey)}/${encodeURIComponent(file)}`;

	return plugins.map((plugin) => ({
		category: plugin.category,
		description: plugin.description,
		guid: plugin.guid,
		name: plugin.name,
		overview: plugin.overview,
		owner: plugin.owner,
		...(plugin.image ? { imageUrl: keyed(plugin.image) } : {}),
		versions: plugin.versions.map((version) => ({
			version: version.version,
			changelog: version.changelog,
			targetAbi: version.targetAbi,
			sourceUrl: keyed(version.file),
			checksum: version.checksum,
			timestamp: version.timestamp,
		})),
	}));
}
