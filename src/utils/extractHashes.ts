// Shared regex for SHA1 hash validation
export const SHA1_REGEX = /^[a-fA-F0-9]{40}$/;

export function isValidHash(hash: string): boolean {
	return SHA1_REGEX.test(hash);
}

export function normalizeHash(hash: string | undefined | null): string {
	if (!hash || typeof hash !== 'string') return '';
	return isValidHash(hash) ? hash.toLowerCase() : '';
}

export interface TorrentInput {
	kind: 'magnet' | 'hash';
	/** The exact magnet URI the user supplied, or the normalized standalone hash. */
	source: string;
	/** The v1 info hash, normalized to 40 lowercase hexadecimal characters. */
	hash: string;
}

const MAGNET_REGEX = /magnet:\?[^\s"'<>]*/gi;
const BTIH_REGEX = /^urn:btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})$/i;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32BtihToHex(value: string): string | null {
	let bits = 0;
	let bitCount = 0;
	const bytes: number[] = [];
	for (const character of value.toUpperCase()) {
		const digit = BASE32_ALPHABET.indexOf(character);
		if (digit < 0) return null;
		bits = bits * 32 + digit;
		bitCount += 5;
		while (bitCount >= 8) {
			bitCount -= 8;
			bytes.push(Math.floor(bits / 2 ** bitCount) & 0xff);
			bits %= 2 ** bitCount;
		}
	}
	if (bytes.length !== 20) return null;
	return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeBtih(value: string): string | null {
	if (SHA1_REGEX.test(value)) return value.toLowerCase();
	if (value.length !== 32) return null;
	return base32BtihToHex(value);
}

/**
 * Builds a provider-compatible magnet while retaining every other query parameter.
 * Some providers reject encoded or base32 exact topics despite accepting the same
 * hash in literal hexadecimal BTIH form.
 */
export function toMagnetUri(hashOrMagnet: string): string {
	const source = hashOrMagnet.trim();
	if (!/^magnet:/i.test(source)) {
		return `magnet:?xt=urn:btih:${normalizeBtih(source) ?? source}`;
	}
	return source
		.replace(/^magnet:/i, 'magnet:')
		.replace(/([?&])([^&]*)/g, (pair: string, separator: string, query: string) => {
			for (const [key, value] of new URLSearchParams(query)) {
				if (key.toLowerCase() !== 'xt') continue;
				const topic = BTIH_REGEX.exec(value);
				if (topic) return `${separator}xt=urn:btih:${normalizeBtih(topic[1])}`;
			}
			return pair;
		});
}

/**
 * Parses pasted torrent sources without throwing away magnet metadata.
 *
 * Magnets keep their original `dn`, repeated `tr`, `ws`, and any other query
 * parameters. Standalone hashes stay distinguishable so callers such as
 * Debrid-Link can deliberately retain cached-only semantics for hash lists.
 */
export function extractTorrentInputs(input: string): TorrentInput[] {
	const results: TorrentInput[] = [];
	const seen = new Set<string>();
	const withoutMagnets = input.replace(MAGNET_REGEX, (source) => {
		let hash: string | null = null;
		for (const [key, value] of new URLSearchParams(source.slice('magnet:?'.length))) {
			if (key.toLowerCase() !== 'xt') continue;
			const match = BTIH_REGEX.exec(value);
			if (match) {
				hash = normalizeBtih(match[1]);
				break;
			}
		}
		if (hash && !seen.has(hash)) {
			seen.add(hash);
			results.push({ kind: 'magnet', source, hash });
		}
		return ' ';
	});

	for (const hash of withoutMagnets.match(/\b[a-fA-F0-9]{40}\b/g) ?? []) {
		const normalized = hash.toLowerCase();
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		results.push({ kind: 'hash', source: normalized, hash: normalized });
	}

	return results;
}

export function extractHashes(hashesStr: string): string[] {
	return extractTorrentInputs(hashesStr).map(({ hash }) => hash);
}

// Direct/hoster download links, one per line or whitespace separated. Magnets
// are left out on purpose: those belong to the torrent path, not the web
// download one.
export function extractDownloadLinks(linksStr: string): string[] {
	const results = new Set<string>();
	for (const token of linksStr.split(/\s+/)) {
		const link = token.trim().replace(/[.,;]+$/, '');
		if (/^https?:\/\/\S+$/i.test(link)) results.add(link);
	}
	return Array.from(results);
}

export function extractMagnets(hashesStr: string): string[] {
	return extractTorrentInputs(hashesStr).map(({ source }) => toMagnetUri(source));
}
