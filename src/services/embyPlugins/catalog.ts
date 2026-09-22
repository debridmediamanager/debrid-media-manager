// The Emby plugin catalog DMM serves to sponsors.
//
// Emby has no third-party plugin repository, so unlike the Jellyfin catalog
// there is no manifest for Emby itself to read. A plugin is one DLL a sponsor
// downloads and drops into Emby's `plugins/` folder. What this catalog holds is
// the latest published build of each plugin, and the routes serve exactly those
// bytes to a key that resolves to an active sponsorship on that request.
//
// Stored beside the Jellyfin catalog in the same private bucket, under its own
// prefix and its own `catalog.json`, so neither platform's publishes can touch
// the other's entries. The sponsor gate and the catalog lock are the Jellyfin
// ones, keyed by platform.

import { readCatalogDocument } from '@/services/jellyfinPlugins/catalog';

/**
 * The only filenames a plugin ships as. Emby loads every assembly in its
 * plugins folder, so the name a sponsor saves is the name the build produced.
 */
export const ASSEMBLY = /^Emby\.Plugin\.[A-Za-z0-9]{1,64}\.dll$/;

const CHECKSUM_SUFFIX = '.sha256';

export interface EmbyPublishedPlugin {
	/** The plugin's `Id`, which is what Emby knows it by. */
	guid: string;
	/** The plugin's `Name`, e.g. `RD zurg`. */
	name: string;
	description: string;
	/** What the file is saved as, e.g. `Emby.Plugin.RdZurg.dll`. */
	assembly: string;
	version: string;
	changelog: string;
	/** When DMM stored this build, not when it was compiled. */
	timestamp: string;
	/** The bucket object inside the Emby prefix holding these exact bytes. */
	object: string;
	/** Computed by DMM from the stored bytes, and checked against the build's own. */
	sha256: string;
	md5: string;
	size: number;
}

/** What a sponsor's catalog request answers with: no bucket names, only routes. */
export interface EmbyCatalogListing {
	guid: string;
	name: string;
	description: string;
	assembly: string;
	version: string;
	changelog: string;
	timestamp: string;
	sha256: string;
	size: number;
	/** Relative, because the key travels in a header rather than in the URL. */
	download: string;
	checksum: string;
}

/**
 * The published Emby descriptor, or null when nothing has been published yet or
 * the bucket could not be read.
 */
export async function readEmbyCatalog(): Promise<EmbyPublishedPlugin[] | null> {
	return readCatalogDocument<EmbyPublishedPlugin>('emby');
}

/**
 * The bucket object for one build. Carries the content hash so a republish of
 * the same version writes a new object rather than changing the bytes behind an
 * entry the live catalog still points at.
 */
export function embyObjectName(assembly: string, version: string, sha256: string): string {
	return `${assembly.slice(0, -'.dll'.length)}_${version}_${sha256.slice(0, 16)}.dll`;
}

/**
 * Parses a requested filename: the DLL itself, or its `.sha256` beside it.
 *
 * Checked before anything else, because the name arrives from the URL.
 *
 * @param file The last path segment.
 * @returns The assembly it names and which form was asked for, or null.
 */
export function parseRequestedFile(
	file: string
): { assembly: string; kind: 'dll' | 'sha256' } | null {
	if (typeof file !== 'string') return null;
	if (file.endsWith(CHECKSUM_SUFFIX)) {
		const assembly = file.slice(0, -CHECKSUM_SUFFIX.length);
		return ASSEMBLY.test(assembly) ? { assembly, kind: 'sha256' } : null;
	}
	return ASSEMBLY.test(file) ? { assembly: file, kind: 'dll' } : null;
}

/** The published entry for an assembly name, or undefined. */
export function findByAssembly(
	plugins: EmbyPublishedPlugin[],
	assembly: string
): EmbyPublishedPlugin | undefined {
	return plugins.find((plugin) => plugin.assembly === assembly);
}

/** The `.sha256` beside a DLL, in the `shasum -a 256` format `shasum -c` reads. */
export function checksumFile(plugin: EmbyPublishedPlugin): string {
	return `${plugin.sha256}  ${plugin.assembly}\n`;
}

/**
 * The catalog as a sponsor sees it.
 *
 * @param plugins The published entries.
 * @returns One listing per plugin, ordered by name.
 */
export function toListing(plugins: EmbyPublishedPlugin[]): EmbyCatalogListing[] {
	return [...plugins]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((plugin) => ({
			guid: plugin.guid,
			name: plugin.name,
			description: plugin.description,
			assembly: plugin.assembly,
			version: plugin.version,
			changelog: plugin.changelog,
			timestamp: plugin.timestamp,
			sha256: plugin.sha256,
			size: plugin.size,
			download: `/api/emby-plugins/${plugin.assembly}`,
			checksum: `/api/emby-plugins/${plugin.assembly}${CHECKSUM_SUFFIX}`,
		}));
}
