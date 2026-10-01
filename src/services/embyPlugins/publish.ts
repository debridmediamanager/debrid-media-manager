// Taking a built Emby plugin into the catalog.
//
// Same model as the Jellyfin publish: the plugin repositories are private and
// build their own DLLs, DMM is the only writer of the catalog document, and the
// digests the catalog advertises are computed here from the bytes it stores.
// The build's own sha256 is required as well and must match, so a DLL corrupted
// between `./build.sh` and this server is refused rather than published.

import { decodeBase64Payload } from '@/services/jellyfinPlugins/publish';
import { createHash } from 'crypto';
import { ASSEMBLY, embyObjectName, type EmbyPublishedPlugin } from './catalog';

/** Four numbers, which is what the plugin csproj `<Version>` and build.sh allow. */
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** The plugin `Id`, with dashes. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHA256 = /^[0-9a-f]{64}$/;

const MAX_CHANGELOG = 8000;

export interface EmbyPublishRequest {
	/** The assembly's filename, e.g. `Emby.Plugin.RdZurg.dll`. */
	file: string;
	/** The DLL, base64. */
	dll: string;
	/** The digest `./build.sh` wrote into the `.sha256` beside the DLL. */
	sha256: string;
	meta: {
		guid: string;
		name: string;
		description: string;
		version: string;
		changelog?: string;
	};
}

export interface EmbyPublishPayload {
	request: EmbyPublishRequest;
	dll: Buffer;
	sha256: string;
}

/** A .NET assembly is a PE file, which starts `MZ`. */
function looksLikeAssembly(bytes: Buffer): boolean {
	return bytes.length > 64 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

const text = (value: unknown, max: number): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/**
 * Reads a publish request, or says why it is not one.
 *
 * @param body The parsed request body.
 * @param maxBytes The largest DLL to accept.
 * @returns The payload, or an error to answer with.
 */
export function readEmbyPublishRequest(
	body: unknown,
	maxBytes = 32 * 1024 * 1024
): { payload: EmbyPublishPayload } | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Expected a JSON body' };
	const request = body as EmbyPublishRequest;

	if (typeof request.file !== 'string' || !ASSEMBLY.test(request.file)) {
		return { error: 'file must be an Emby.Plugin.<Name>.dll filename' };
	}

	const meta = request.meta;
	if (!meta || typeof meta !== 'object') return { error: 'meta is required' };
	if (!text(meta.name, 64)) return { error: 'meta.name is required' };
	if (!text(meta.description, 500)) return { error: 'meta.description is required' };
	if (typeof meta.version !== 'string' || !VERSION.test(meta.version)) {
		return { error: 'meta.version must be four numbers' };
	}
	if (typeof meta.guid !== 'string' || !GUID.test(meta.guid)) {
		return { error: 'meta.guid is not a plugin GUID' };
	}
	if (meta.changelog !== undefined && typeof meta.changelog !== 'string') {
		return { error: 'meta.changelog must be text' };
	}

	if (typeof request.sha256 !== 'string' || !SHA256.test(request.sha256.toLowerCase())) {
		return { error: "sha256 must be the build's hex digest" };
	}

	const dll = decodeBase64Payload(request.dll, maxBytes);
	if (!dll) return { error: 'dll must be base64 and within the size limit' };
	if (!looksLikeAssembly(dll)) return { error: 'dll does not begin like a .NET assembly' };

	const sha256 = createHash('sha256').update(dll).digest('hex');
	if (sha256 !== request.sha256.toLowerCase()) {
		return { error: 'The DLL does not match the sha256 the build recorded' };
	}

	return { payload: { request, dll, sha256 } };
}

/**
 * The catalog entry a payload describes.
 *
 * @param payload The validated payload.
 * @param now When it is being stored.
 * @returns The entry to merge into the Emby catalog.
 */
export function toEmbyPublishedPlugin(
	payload: EmbyPublishPayload,
	now: Date = new Date()
): EmbyPublishedPlugin {
	const { request, dll, sha256 } = payload;
	return {
		guid: request.meta.guid.toLowerCase(),
		name: request.meta.name.trim(),
		description: request.meta.description.trim(),
		assembly: request.file,
		version: request.meta.version,
		changelog: (request.meta.changelog ?? '').trim().slice(0, MAX_CHANGELOG),
		timestamp: now.toISOString(),
		object: embyObjectName(request.file, request.meta.version, sha256),
		sha256,
		md5: createHash('md5').update(dll).digest('hex'),
		size: dll.length,
	};
}

/**
 * Another plugin that already ships under this entry's assembly name.
 *
 * Downloads are addressed by assembly name, so two plugins sharing one would
 * make one of them unreachable. Refused rather than merged.
 *
 * @param existing The catalog as it stands.
 * @param entry The entry being published.
 * @returns The plugin already holding the name, or undefined.
 */
export function assemblyOwnedByAnother(
	existing: EmbyPublishedPlugin[] | null,
	entry: EmbyPublishedPlugin
): EmbyPublishedPlugin | undefined {
	return (existing ?? []).find(
		(plugin) =>
			plugin.assembly === entry.assembly &&
			plugin.guid.toLowerCase() !== entry.guid.toLowerCase()
	);
}
