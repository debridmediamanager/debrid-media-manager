import lzString from 'lz-string';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	HashlistNotPublishedError,
	hashlistDataUrl,
	hashlistPageHtml,
	readHashlistFragment,
	storedHashlistId,
	storedListText,
} from './hashlistSource';

const ID = '421ab9ff-ed7f-4c0b-9f66-ee91f12d57eb';
const LIST = JSON.stringify({ title: 't', torrents: [] });

describe('hashlistSource', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('tells a stored-list fragment from one carrying the list', () => {
		expect(storedHashlistId(`id=${ID}`)).toBe(ID);
		expect(storedHashlistId(lzString.compressToEncodedURIComponent(LIST))).toBeNull();
		expect(storedHashlistId('id=../../etc/passwd')).toBeNull();
		expect(storedHashlistId('')).toBeNull();
	});

	it('decodes a list carried in the fragment without fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await readHashlistFragment(lzString.compressToEncodedURIComponent(LIST))).toBe(LIST);
		expect(await readHashlistFragment('')).toBe('');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fetches a stored list from beside its page', async () => {
		const fetchMock = vi.fn(
			async () => new Response(`${lzString.compressToEncodedURIComponent(LIST)}\n`)
		);
		vi.stubGlobal('fetch', fetchMock);
		expect(await readHashlistFragment(`id=${ID}`)).toBe(LIST);
		expect(fetchMock).toHaveBeenCalledWith(
			`https://hashlists.debridmediamanager.com/lists/${ID}.txt`
		);
		expect(hashlistDataUrl(ID)).toBe(
			`https://hashlists.debridmediamanager.com/lists/${ID}.txt`
		);
	});

	// The backfill moved each old page to lists/<id>.txt unchanged.
	it('reads a stored list that is an old page moved whole', async () => {
		const page = hashlistPageHtml(
			`https://debridmediamanager.com/hashlist#${lzString.compressToEncodedURIComponent(LIST)}`
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(page))
		);
		expect(await readHashlistFragment(`id=${ID}`)).toBe(LIST);
		expect(storedListText('<html>no iframe</html>')).toBe('');
	});

	// Whatever reaches the page stays one attribute value: no tag, no other
	// attribute, and the browser reads back exactly the string written.
	it('writes the iframe URL as an inert attribute value', () => {
		for (const src of [
			'"><script>alert(1)</script>',
			'"></iframe><script>alert(1)</script>',
			'https://debridmediamanager.com/hashlist#abc" onload="alert(1)',
			"https://debridmediamanager.com/hashlist#abc' onload='alert(1)",
			'a&quot;b<c>d',
		]) {
			const doc = new DOMParser().parseFromString(hashlistPageHtml(src), 'text/html');
			expect(doc.querySelectorAll('script')).toHaveLength(0);
			expect(doc.body.children).toHaveLength(1);
			const iframe = doc.querySelector('iframe')!;
			expect(iframe.getAttributeNames()).toEqual(['src']);
			expect(iframe.getAttribute('src')).toBe(src);
		}
		// The forms the app writes are unchanged by it.
		expect(hashlistPageHtml('https://debridmediamanager.com/hashlist#id=' + ID)).toContain(
			`<iframe src="https://debridmediamanager.com/hashlist#id=${ID}"></iframe>`
		);
	});

	// GitHub Pages publishes a new file a minute or two after its commit.
	it('says so when the stored list is not published yet', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 404 }))
		);
		await expect(readHashlistFragment(`id=${ID}`)).rejects.toBeInstanceOf(
			HashlistNotPublishedError
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 502 }))
		);
		await expect(readHashlistFragment(`id=${ID}`)).rejects.toThrow('answered 502');
	});
});
