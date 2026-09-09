import handler from '@/pages/api/plugins/[...route]';
import type { PublishedPlugin } from '@/services/jellyfinPlugins/catalog';
import { getStoredObject } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/newznab/store', () => ({ getStoredObject: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockStore = vi.mocked(getStoredObject);

const KEY = 'a'.repeat(64);
const REVOKED = 'b'.repeat(64);
const ZIP = 'rd-zurg_1.0.2.0.zip';
const BASE = 'https://debridmediamanager.com';

const ACTIVE = {
	isSponsor: true,
	sources: ['github'],
	shortId: '4GKO',
	githubUsername: 'yowmamasita',
	keyVersion: 3,
};

const CATALOG: PublishedPlugin[] = [
	{
		category: 'General',
		description: 'Your Real-Debrid library in Jellyfin, without a mount.',
		guid: '4d0b1a37-1f1c-4a3e-9f5c-2e6a7b8c9d01',
		name: 'RD zurg',
		overview: 'Serves a Real-Debrid account as a Jellyfin library',
		owner: 'debridmediamanager',
		image: 'rd-zurg.png',
		versions: [
			{
				version: '1.0.2.0',
				changelog: 'Signed playback URLs.',
				targetAbi: '12.0.0.0',
				file: ZIP,
				checksum: 'd41d8cd98f00b204e9800998ecf8427e',
				timestamp: '2026-09-09T12:00:00Z',
			},
		],
	},
];

function catalogBytes(): Buffer {
	return Buffer.from(JSON.stringify(CATALOG), 'utf8');
}

/**
 * The ZIP body, spelled as the four bytes of a real archive's magic number.
 *
 * Deliberately not `Buffer.from('PK', …)`: the test setup's Buffer is not Node's
 * and read that two-character string as four bytes, so a length assertion agreed
 * with the code for the wrong reason.
 */
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** The store answers the catalog descriptor, and the ZIP as those four bytes. */
function storeServes(zip: Buffer | null = ZIP_BYTES) {
	mockStore.mockImplementation(async (objectKey: string) => {
		if (objectKey.endsWith('catalog.json')) return catalogBytes();
		if (objectKey.endsWith(ZIP)) return zip;
		return null;
	});
}

async function call(
	query: Record<string, string | string[]>,
	method = 'GET'
): Promise<MockResponse> {
	const res = createMockResponse();
	await handler(createMockRequest({ method, query }) as never, res);
	return res;
}

const manifest = (apikey?: string) =>
	call(
		apikey === undefined ? { route: ['manifest.json'] } : { route: ['manifest.json'], apikey }
	);

const download = (key: string, file = ZIP) => call({ route: [key, file] });

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NEWZNAB_PUBLIC_BASE = BASE;
	mockRepo.getSponsorByDmmApiKey = vi.fn(async (key: string) =>
		key === KEY ? ACTIVE : null
	) as never;
	storeServes();
});

describe('the manifest', () => {
	it('mints download URLs carrying the caller’s own key', async () => {
		const res = await manifest(KEY);
		expect(res._getStatusCode()).toBe(200);

		const [entry] = JSON.parse(res._getData() as string);
		expect(entry.guid).toBe('4d0b1a37-1f1c-4a3e-9f5c-2e6a7b8c9d01');
		expect(entry.owner).toBe('debridmediamanager');
		// The key is a path segment so the URL still ends in .zip: Jellyfin refuses
		// a sourceUrl with a query string as "not a zip archive".
		expect(entry.versions[0].sourceUrl).toBe(`${BASE}/api/plugins/${KEY}/${ZIP}`);
		expect(entry.imageUrl).toBe(`${BASE}/api/plugins/${KEY}/rd-zurg.png`);
	});

	it('refuses a key that is not a sponsor’s', async () => {
		const res = await manifest(REVOKED);
		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({ error: 'Invalid API key' });
	});

	it('refuses a lapsed sponsorship, and says so', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn(async () => ({
			...ACTIVE,
			isSponsor: false,
		})) as never;
		const res = await manifest(KEY);
		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({ error: 'Sponsorship is no longer active' });
	});

	it('refuses a request with no key at all', async () => {
		expect((await manifest())._getStatusCode()).toBe(401);
	});

	it('is never cached, because the URL contains the credential', async () => {
		const res = await manifest(KEY);
		expect(res._getHeaders()['Cache-Control']).toContain('no-store');
	});
});

describe('a download', () => {
	it('serves a published file to an active sponsor', async () => {
		const res = await download(KEY);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()['Content-Type']).toBe('application/zip');
		expect(Buffer.from(res._getData() as Buffer).toString('hex')).toBe(
			ZIP_BYTES.toString('hex')
		);
	});

	it('stops working the moment the key stops resolving', async () => {
		// The URL a sponsor already has, after gatekeeper resets or revokes the
		// key: nothing about it was signed, so it is only as good as the lookup.
		const before = await download(KEY);
		expect(before._getStatusCode()).toBe(200);

		mockRepo.getSponsorByDmmApiKey = vi.fn(async () => null) as never;

		const after = await download(KEY);
		expect(after._getStatusCode()).toBe(401);
		expect(after._getData()).toEqual({ error: 'Invalid API key' });
	});

	it('stops working the moment the sponsorship lapses', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn(async () => ({
			...ACTIVE,
			isSponsor: false,
		})) as never;
		const res = await download(KEY);
		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({ error: 'Sponsorship is no longer active' });
	});

	it('reads nothing from the bucket for a refused key', async () => {
		mockStore.mockClear();
		const res = await download(REVOKED);
		expect(res._getStatusCode()).toBe(401);
		expect(mockStore).not.toHaveBeenCalled();
	});

	it('will not serve a file the catalog never published', async () => {
		const res = await download(KEY, 'secrets.zip');
		expect(res._getStatusCode()).toBe(404);
	});

	it('refuses a filename that tries to leave the prefix', async () => {
		for (const file of ['../catalog.json', 'a/b.zip', '..%2Fx.zip']) {
			expect((await download(KEY, file))._getStatusCode()).toBe(404);
		}
	});

	it('refuses an extension the catalog does not serve', async () => {
		expect((await download(KEY, 'catalog.json'))._getStatusCode()).toBe(404);
	});

	it('answers 502 rather than an empty file when the bucket read fails', async () => {
		storeServes(null);
		const res = await download(KEY);
		expect(res._getStatusCode()).toBe(502);
	});

	it('prefers the path key over a query key, so a good query cannot rescue a bad path', async () => {
		const res = await call({ route: [REVOKED, ZIP], apikey: KEY });
		expect(res._getStatusCode()).toBe(401);
	});

	it('answers HEAD without a body', async () => {
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'HEAD', query: { route: [KEY, ZIP] } }) as never,
			res
		);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()['Content-Length']).toBe(String(ZIP_BYTES.length));
		expect(res.end).toHaveBeenCalled();
	});

	it('rejects a write method', async () => {
		const res = await call({ route: [KEY, ZIP] }, 'POST');
		expect(res._getStatusCode()).toBe(405);
	});
});
