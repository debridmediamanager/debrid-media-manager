import { safeNzbName } from './nzbName';

export interface CleanNzbDownload {
	/** What the file was saved as. */
	name: string;
	/** What the server stripped, already phrased for a person. */
	removed: string[];
}

/**
 * Filename the server asked for. `filename*` is preferred because it survives
 * non-ASCII release names; the quoted `filename` is the fallback for clients
 * that never learned RFC 5987.
 */
export function filenameFromDisposition(header: string | null): string | null {
	if (!header) return null;
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
	if (encoded) {
		try {
			return decodeURIComponent(encoded[1]);
		} catch {
			// A malformed value is not worth failing a download over.
		}
	}
	return /filename="([^"]*)"/i.exec(header)?.[1] || null;
}

/** `X-Nzb-Removed`, which is `-` when there was nothing to take off. */
export function parseRemoved(header: string | null): string[] {
	if (!header || header === '-') return [];
	return header
		.split(';')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Saves a release as an NZB with the indexer's fingerprints off it.
 *
 * The cleaning happens server-side — that is where the indexer key lives, and
 * where the file is fetched — so this only has to hand the bytes to the browser.
 */
export async function downloadCleanNzb(id: string, title: string): Promise<CleanNzbDownload> {
	const params = new URLSearchParams({ id });
	if (title) params.set('title', title);

	const response = await fetch(`/api/nzb2rd/download?${params}`);
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(failure?.error || `Download failed (${response.status})`);
	}

	const blob = await response.blob();
	const name =
		filenameFromDisposition(response.headers.get('Content-Disposition')) ??
		safeNzbName(title || id);

	saveBlob(blob, name);

	return { name, removed: parseRemoved(response.headers.get('X-Nzb-Removed')) };
}

/** Same anchor dance as downloadMagnetFile, which is what the rest of the app does. */
function saveBlob(blob: Blob, name: string): void {
	const url = window.URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	window.URL.revokeObjectURL(url);
}
