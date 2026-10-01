import handler from '@/pages/api/emby-plugins/[...route]';
import type { EmbyPublishedPlugin } from '@/services/embyPlugins/catalog';
import { getStoredObject } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/newznab/store', () => ({ getStoredObject: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockStore = vi.mocked(getStoredObject);

const KEY = 'a'.repeat(64);
const REVOKED = 'b'.repeat(64);
const DLL = 'Emby.Plugin.RdZurg.dll';

/** A PE header's first two bytes and padding, spelled as numbers (see the Jellyfin test). */
const DLL_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(126, 0x90)]);
const SHA256 = createHash('sha256').update(DLL_BYTES).digest('hex');
const OBJECT = `Emby.Plugin.RdZurg_1.0.0.0_${SHA256.slice(0, 16)}.dll`;

const ACTIVE = {
	isSponsor: true,
	sources: ['github'],
	shortId: '4GKO',
	githubUsername: 'yowmamasita',
	keyVersion: 3,
};

const CATALOG: EmbyPublishedPlugin[] = [
	{
		guid: '43175d8f-3984-445c-a4cb-e4d2e1aa0fce',
		name: 'RD zurg',
		description: 'Your Real-Debrid library in Emby, without a mount.',
		assembly: DLL,
		version: '1.0.0.0',
		changelog: 'First build.',
		timestamp: '2026-09-23T00:00:00.000Z',
		object: OBJECT,
		sha256: SHA256,
		md5: createHash('md5').update(DLL_BYTES).digest('hex'),
		size: DLL_BYTES.length,
	},
];

/** The store holds the Emby catalog and the DLL, and nothing under the Jellyfin prefix. */
function storeServes(dll: Buffer | null = DLL_BYTES) {
	mockStore.mockImplementation(async (objectKey: string) => {
		if (objectKey === 'emby-plugins/catalog.json') {
			return Buffer.from(JSON.stringify(CATALOG), 'utf8');
		}
		if (objectKey === `emby-plugins/${OBJECT}`) return dll;
		return null;
	});
}

async function call(
	route: string[],
	{
		key,
		query = {},
		method = 'GET',
	}: { key?: string; query?: Record<string, string>; method?: string } = {}
): Promise<MockResponse> {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method,
			query: { route, ...query },
			headers: key === undefined ? {} : { 'x-api-key': key },
		}) as never,
		res
	);
	return res;
}

const lapsed = () => {
	mockRepo.getSponsorByDmmApiKey = vi.fn(async () => ({
		...ACTIVE,
		isSponsor: false,
	})) as never;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.getSponsorByDmmApiKey = vi.fn(async (key: string) =>
		key === KEY ? ACTIVE : null
	) as never;
	storeServes();
});

describe('the catalog', () => {
	it('lists what is published, with routes rather than bucket names', async () => {
		const res = await call(['catalog.json'], { key: KEY });
		expect(res._getStatusCode()).toBe(200);

		const [entry] = JSON.parse(res._getData() as string);
		expect(entry).toMatchObject({
			name: 'RD zurg',
			version: '1.0.0.0',
			assembly: DLL,
			sha256: SHA256,
			download: `/api/emby-plugins/${DLL}`,
			checksum: `/api/emby-plugins/${DLL}.sha256`,
		});
		expect(entry).not.toHaveProperty('object');
	});

	it('reads the Emby document, never the Jellyfin one', async () => {
		await call(['catalog.json'], { key: KEY });
		expect(mockStore.mock.calls.map((c) => c[0])).toEqual(['emby-plugins/catalog.json']);
	});

	it('refuses a missing key', async () => {
		const res = await call(['catalog.json']);
		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({ error: 'Invalid API key' });
	});

	it('refuses a lapsed sponsorship, and says so', async () => {
		lapsed();
		const res = await call(['catalog.json'], { key: KEY });
		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({ error: 'Sponsorship is no longer active' });
	});

	it('answers 503 when nothing can be read from the bucket', async () => {
		mockStore.mockResolvedValue(null);
		const res = await call(['catalog.json'], { key: KEY });
		expect(res._getStatusCode()).toBe(503);
	});

	it('is never cached', async () => {
		const res = await call(['catalog.json'], { key: KEY });
		expect(res._getHeaders()['Cache-Control']).toBe(
			'no-store, no-cache, must-revalidate, private'
		);
	});
});

describe('a download', () => {
	it('serves the published bytes under the name Emby loads', async () => {
		const res = await call([DLL], { key: KEY });
		expect(res._getStatusCode()).toBe(200);

		const headers = res._getHeaders();
		expect(headers['Content-Type']).toBe('application/octet-stream');
		expect(headers['Content-Disposition']).toBe(`attachment; filename="${DLL}"`);
		expect(headers['X-Checksum-Sha256']).toBe(SHA256);
		expect(headers['X-Plugin-Version']).toBe('1.0.0.0');
		expect(headers['Cache-Control']).toContain('no-store');
		expect(Buffer.from(res._getData() as Buffer).toString('hex')).toBe(
			DLL_BYTES.toString('hex')
		);
		expect(mockStore).toHaveBeenCalledWith(`emby-plugins/${OBJECT}`);
	});

	it('also takes the key from the query, like the other sponsor routes', async () => {
		const res = await call([DLL], { query: { apikey: KEY } });
		expect(res._getStatusCode()).toBe(200);
	});

	it('stops working the moment the key stops resolving', async () => {
		expect((await call([DLL], { key: KEY }))._getStatusCode()).toBe(200);

		// gatekeeper reset the key, so `Sponsors.dmmApiKey` is NULL and nothing matches.
		mockRepo.getSponsorByDmmApiKey = vi.fn(async () => null) as never;

		const after = await call([DLL], { key: KEY });
		expect(after._getStatusCode()).toBe(401);
		expect(after._getData()).toEqual({ error: 'Invalid API key' });
	});

	it('stops working the moment the sponsorship lapses', async () => {
		expect((await call([DLL], { key: KEY }))._getStatusCode()).toBe(200);

		lapsed();

		const after = await call([DLL], { key: KEY });
		expect(after._getStatusCode()).toBe(401);
		expect(after._getData()).toEqual({ error: 'Sponsorship is no longer active' });
	});

	it('looks the key up again on every request rather than remembering it', async () => {
		await call([DLL], { key: KEY });
		await call([DLL], { key: KEY });
		expect(mockRepo.getSponsorByDmmApiKey).toHaveBeenCalledTimes(2);
	});

	it('reads nothing from the bucket for a refused key', async () => {
		const res = await call([DLL], { key: REVOKED });
		expect(res._getStatusCode()).toBe(401);
		expect(mockStore).not.toHaveBeenCalled();
	});

	it('will not serve an assembly the catalog never published', async () => {
		const res = await call(['Emby.Plugin.NzbZurg.dll'], { key: KEY });
		expect(res._getStatusCode()).toBe(404);
	});

	it('refuses names that are not a plugin assembly, before looking at the key', async () => {
		for (const file of [
			'../catalog.json',
			'catalog.dll',
			'Emby.Plugin.RdZurg.zip',
			'Emby.Plugin.Rd/Zurg.dll',
			OBJECT,
		]) {
			const res = await call([file], { key: REVOKED });
			expect(res._getStatusCode()).toBe(404);
		}
		expect(mockRepo.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});

	it('refuses a nested path', async () => {
		expect((await call(['x', DLL], { key: KEY }))._getStatusCode()).toBe(404);
	});

	it('answers 502 rather than an empty file when the bucket read fails', async () => {
		storeServes(null);
		expect((await call([DLL], { key: KEY }))._getStatusCode()).toBe(502);
	});

	it('will not hand out bytes that do not match the catalog digest', async () => {
		storeServes(Buffer.concat([DLL_BYTES, Buffer.from([0x00])]));
		const res = await call([DLL], { key: KEY });
		expect(res._getStatusCode()).toBe(502);
	});

	it('answers HEAD without a body', async () => {
		const res = await call([DLL], { key: KEY, method: 'HEAD' });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()['Content-Length']).toBe(String(DLL_BYTES.length));
		expect(res.send).not.toHaveBeenCalled();
		expect(res.end).toHaveBeenCalled();
	});

	it('rejects a write method', async () => {
		expect((await call([DLL], { key: KEY, method: 'POST' }))._getStatusCode()).toBe(405);
	});
});

describe('the checksum file', () => {
	it('answers in the format shasum -c reads, without touching the DLL', async () => {
		const res = await call([`${DLL}.sha256`], { key: KEY });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toBe(`${SHA256}  ${DLL}\n`);
		expect(mockStore.mock.calls.map((c) => c[0])).toEqual(['emby-plugins/catalog.json']);
	});

	it('is gated like the DLL', async () => {
		lapsed();
		expect((await call([`${DLL}.sha256`], { key: KEY }))._getStatusCode()).toBe(401);
	});
});
