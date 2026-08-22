import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CACHE_CHECK_CHUNK_SIZE,
	PremiumizeError,
	checkPremiumizeCache,
	createPremiumizeTransfer,
	deletePremiumizeTransfer,
	directDownloadPremiumize,
	getPremiumizeAccountInfo,
	isEnergyCdnLink,
	isPremiumizePremium,
	listAllPremiumizeItems,
	listPremiumizeTransfers,
	resolvePremiumizeTransferHashes,
	toMagnetUri,
} from './premiumize';

const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/704233992/1/tok/sig';

const jsonResponse = (body: unknown, status = 200) =>
	({
		status,
		headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** In jsdom the client takes the same-origin proxy path, never the vendor host. */
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];

describe('premiumize transport', () => {
	it('posts through the same-origin proxy with the key in a header, never the URL', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success', customer_id: '704233992' }));

		await getPremiumizeAccountInfo('secretkey');

		const [url, init] = lastCall();
		expect(url).toBe('/api/premiumize/account/info');
		expect(url).not.toContain('secretkey');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer secretkey');
	});

	it('rejects a missing key without touching the network', async () => {
		await expect(getPremiumizeAccountInfo('')).rejects.toMatchObject({
			code: 'authentication_failed',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('turns an error envelope into a PremiumizeError carrying the code', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'error',
				code: 'authentication_failed',
				message: 'Not logged in.',
			})
		);

		await expect(getPremiumizeAccountInfo('bad')).rejects.toBeInstanceOf(PremiumizeError);
		await expect(getPremiumizeAccountInfo('bad')).rejects.toMatchObject({
			code: 'authentication_failed',
			message: 'Not logged in.',
		});
	});

	it('reports a non-JSON body as an error rather than throwing on the parse', async () => {
		fetchMock.mockResolvedValue({
			status: 404,
			headers: { get: () => 'text/html; charset=UTF-8' },
			json: async () => {
				throw new SyntaxError('Unexpected token <');
			},
		} as unknown as Response);

		await expect(getPremiumizeAccountInfo('key')).rejects.toMatchObject({
			code: 'non_json_response',
		});
	});
});

describe('isPremiumizePremium', () => {
	it('reads premium_until as unix seconds', () => {
		expect(isPremiumizePremium({ premium_until: Math.floor(Date.now() / 1000) + 3600 })).toBe(
			true
		);
		expect(isPremiumizePremium({ premium_until: Math.floor(Date.now() / 1000) - 1 })).toBe(
			false
		);
		expect(isPremiumizePremium({ premium_until: null })).toBe(false);
	});
});

describe('toMagnetUri / isEnergyCdnLink', () => {
	it('expands a bare hash, because only cache/check accepts one', () => {
		expect(toMagnetUri('dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c')).toBe(
			'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'
		);
		expect(toMagnetUri('magnet:?xt=urn:btih:abc')).toBe('magnet:?xt=urn:btih:abc');
	});

	it('recognises only energycdn hosts', () => {
		expect(isEnergyCdnLink(`${CDN}/file.mp4`)).toBe(true);
		expect(isEnergyCdnLink('https://littlemouse-sto.energycdn.com/dl/a/b/c/d/file.mp4')).toBe(
			true
		);
		expect(isEnergyCdnLink('https://proof.ovh.net/files/1Mb.dat')).toBe(false);
		expect(isEnergyCdnLink('https://evil-energycdn.com.example.net/x')).toBe(false);
		expect(isEnergyCdnLink('not a url')).toBe(false);
	});
});

describe('checkPremiumizeCache', () => {
	it('zips the four parallel arrays and normalises filesize', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				response: [true, false],
				transcoded: [true, null],
				filename: ['Big Buck Bunny', null],
				// string on a hit, integer 0 on a miss - the one field that flips type
				filesize: ['276445467', 0],
			})
		);

		const results = await checkPremiumizeCache('key', ['aaa', 'bbb']);

		expect(results).toEqual([
			{ hash: 'aaa', cached: true, filename: 'Big Buck Bunny', filesize: 276445467 },
			{ hash: 'bbb', cached: false, filename: null, filesize: null },
		]);
	});

	it('drops empty and whitespace-only items before sending them', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				response: [true, true],
				filename: ['A', 'B'],
				filesize: ['1', '2'],
			})
		);

		const results = await checkPremiumizeCache('key', ['aaa', '', '   ', 'bbb']);

		const sent = JSON.parse(lastCall()[1].body);
		expect(sent['items[]']).toEqual(['aaa', 'bbb']);
		expect(results.map((r) => r.hash)).toEqual(['aaa', 'bbb']);
	});

	it('refuses a misaligned response instead of shifting every answer left', async () => {
		// What Premiumize does when an empty item slips through: two answers for
		// three items, so a positional zip blames the wrong torrent.
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				response: [true, true],
				filename: ['A', 'B'],
				filesize: ['1', '2'],
			})
		);

		await expect(checkPremiumizeCache('key', ['aaa', 'bbb', 'ccc'])).rejects.toMatchObject({
			code: 'misaligned_response',
		});
	});

	it('chunks large batches to stay clear of the ~30s request budget', async () => {
		fetchMock.mockImplementation(async (_url: string, init: any) => {
			const items = JSON.parse(init.body)['items[]'] as string[];
			return jsonResponse({
				status: 'success',
				response: items.map(() => false),
				filename: items.map(() => null),
				filesize: items.map(() => 0),
			});
		});

		const hashes = Array.from({ length: CACHE_CHECK_CHUNK_SIZE + 5 }, (_, i) => `h${i}`);
		const results = await checkPremiumizeCache('key', hashes);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(results).toHaveLength(CACHE_CHECK_CHUNK_SIZE + 5);
	});

	it('makes no request for an empty list', async () => {
		expect(await checkPremiumizeCache('key', [])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('directDownloadPremiumize', () => {
	it('returns every resolved file, not the arbitrary top-level one', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				content: [
					{
						path: 'BBB/poster.jpg',
						size: 310380,
						link: `${CDN}/poster.jpg`,
						stream_link: null,
					},
					{
						path: 'BBB/BBB.mp4',
						size: 276134947,
						link: `${CDN}/BBB.mp4`,
						stream_link: `${CDN}/BBB.mp4`,
					},
				],
				// mirrors content[0] - the poster, not the video
				location: `${CDN}/poster.jpg`,
				filename: 'BBB/poster.jpg',
				filesize: 310380,
			})
		);

		const files = await directDownloadPremiumize('key', 'dd8255ec');

		expect(files).toHaveLength(2);
		expect(files[1].path).toBe('BBB/BBB.mp4');
		expect(JSON.parse(lastCall()[1].body).src).toBe('magnet:?xt=urn:btih:dd8255ec');
	});

	it('treats an echoed-back input URL as a failure, not a success', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				content: [
					{
						path: '1Mb.dat',
						size: null,
						link: 'https://proof.ovh.net/files/1Mb.dat',
						stream_link: null,
					},
				],
			})
		);

		await expect(
			directDownloadPremiumize('key', 'https://proof.ovh.net/files/1Mb.dat')
		).rejects.toMatchObject({ code: 'service_unsupported' });
	});

	it('passes an http source through untouched', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success', content: [] }));

		await directDownloadPremiumize('key', 'https://example.com/a.rar');

		expect(JSON.parse(lastCall()[1].body).src).toBe('https://example.com/a.rar');
	});
});

describe('transfers', () => {
	it('lists transfers, tolerating a missing array', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success' }));
		expect(await listPremiumizeTransfers('key')).toEqual([]);
	});

	it('creates a transfer from a bare hash as a magnet URI', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success', id: 'abc', name: 'X' }));

		await createPremiumizeTransfer('key', toMagnetUri('dd8255ec'));

		expect(JSON.parse(lastCall()[1].body).src).toBe('magnet:?xt=urn:btih:dd8255ec');
	});

	it('deletes by transfer id', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success' }));
		await deletePremiumizeTransfer('key', 'abc');
		expect(lastCall()[0]).toBe('/api/premiumize/transfer/delete');
		expect(JSON.parse(lastCall()[1].body)).toEqual({ id: 'abc' });
	});

	it('resolves transfer hashes through the proxy virtual endpoint', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success', hashes: { abc: 'ff00' } }));

		const hashes = await resolvePremiumizeTransferHashes('key', ['abc']);

		expect(lastCall()[0]).toBe('/api/premiumize/transfer/hashes');
		expect(hashes).toEqual({ abc: 'ff00' });
	});

	it('skips the hash lookup entirely for an empty id list', async () => {
		expect(await resolvePremiumizeTransferHashes('key', [])).toEqual({});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('item/listall', () => {
	it('returns the flat file list', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: 'success',
				files: [{ id: 'f1', name: 'a.mkv', created_at: 1, size: 2, path: 'Show/a.mkv' }],
			})
		);
		expect(await listAllPremiumizeItems('key')).toHaveLength(1);
	});

	it('tolerates a missing files array', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success' }));
		expect(await listAllPremiumizeItems('key')).toEqual([]);
	});
});
