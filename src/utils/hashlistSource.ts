import lzString from 'lz-string';

/**
 * Where a shared hash list's data lives.
 *
 * A shared list used to travel whole in the iframe URL's #fragment. Chrome
 * refuses a URL over 2 MB and leaves the iframe at `about:blank#blocked`, a
 * white page: on 2026-09-30, 149 of the 14,930 lists in the hashlists repo
 * were over it, the largest at 11.6 MB. A list is now stored beside its page
 * as `lists/<id>.txt` (the same lz-string text the fragment carried) and the
 * fragment carries `id=<id>`. `=` is outside lz-string's URI-safe alphabet,
 * so the two forms cannot be mistaken for each other, and old links keep
 * working unchanged.
 */
export const HASHLIST_HOST = 'https://hashlists.debridmediamanager.com';
export const HASHLIST_APP_URL = 'https://debridmediamanager.com/hashlist';

const ID_PREFIX = 'id=';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// lz-string's compressToEncodedURIComponent alphabet
const LZ_URI_SAFE = /^[A-Za-z0-9+\-$]+$/;

export const isHashlistId = (id: string) => UUID.test(id);
export const isLzUriSafe = (text: string) => LZ_URI_SAFE.test(text);
export const hashlistDataPath = (id: string) => `lists/${id}.txt`;
export const hashlistDataUrl = (id: string) => `${HASHLIST_HOST}/${hashlistDataPath(id)}`;
export const hashlistFragmentForId = (id: string) => `${ID_PREFIX}${id}`;

/** The stored list's id, when the fragment (without `#`) names one. */
export function storedHashlistId(fragment: string): string | null {
	if (!fragment.startsWith(ID_PREFIX)) return null;
	const id = fragment.slice(ID_PREFIX.length);
	return isHashlistId(id) ? id : null;
}

/** GitHub Pages publishes a new file a minute or two after its commit. */
export class HashlistNotPublishedError extends Error {
	constructor(id: string) {
		super(`Hash list ${id} is not published yet`);
		this.name = 'HashlistNotPublishedError';
	}
}

/**
 * The JSON text of the list a fragment (without `#`) points at: fetched when
 * it names a stored list, decompressed in place when it carries the list.
 */
export async function readHashlistFragment(fragment: string): Promise<string> {
	if (!fragment) return '';
	const id = storedHashlistId(fragment);
	if (!id) return lzString.decompressFromEncodedURIComponent(fragment) ?? '';
	const response = await fetch(hashlistDataUrl(id));
	if (response.status === 404) throw new HashlistNotPublishedError(id);
	if (!response.ok) throw new Error(`Hash list ${id} answered ${response.status}`);
	return lzString.decompressFromEncodedURIComponent((await response.text()).trim()) ?? '';
}

/** The page hashlists.debridmediamanager.com serves for a list. */
export const hashlistPageHtml = (iframeSrc: string) => `<!doctype html>
<html>
<head>
<meta charset=UTF-8>
<title>Debrid Media Manager Hash List</title>
<style>iframe{border:none;position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head>
<body>
<iframe src="${iframeSrc}"></iframe>
</body>
</html>`;
