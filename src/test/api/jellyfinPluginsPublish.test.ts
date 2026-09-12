import handler from '@/pages/api/plugins/publish';
import type { PublishedPlugin } from '@/services/jellyfinPlugins/catalog';
import {
	isAuthorizedPublisher,
	mergeIntoCatalog,
	readPublishRequest,
} from '@/services/jellyfinPlugins/publish';
import { getStoredObject, putStoredObject } from '@/services/newznab/store';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/newznab/store', () => ({
	getStoredObject: vi.fn(),
	putStoredObject: vi.fn(),
}));

// Redis as the catalog lock uses it: SET NX takes a key only when nobody holds it, and the
// release script deletes it only for the token that took it. Shared by every request, as
// Redis is shared by every web replica.
const redisState = vi.hoisted(() => ({ values: new Map<string, string>(), failing: false }));

vi.mock('ioredis', () => ({
	default: class FakeRedis {
		on() {
			return this;
		}

		async set(key: string, value: string, ...options: unknown[]) {
			if (redisState.failing) throw new Error('Connection is closed.');
			if (options.includes('NX') && redisState.values.has(key)) return null;
			redisState.values.set(key, value);
			return 'OK';
		}

		async eval(_script: string, _keys: number, key: string, token: string) {
			if (redisState.failing) throw new Error('Connection is closed.');
			if (redisState.values.get(key) !== token) return 0;
			redisState.values.delete(key);
			return 1;
		}
	},
}));

const mockGet = vi.mocked(getStoredObject);
const mockPut = vi.mocked(putStoredObject);

const SECRET = 'publish-secret';
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
const PNG = Buffer.concat([
	Buffer.from('89504e470d0a1a0a', 'hex'),
	Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

const META = {
	category: 'General',
	changelog: 'Signed playback URLs.',
	description: 'Your Real-Debrid library in Jellyfin, without a mount.',
	guid: '4d0b1a37-1f1c-4a3e-9f5c-2e6a7b8c9d01',
	name: 'RD zurg',
	overview: 'Serves a Real-Debrid account as a Jellyfin library',
	owner: 'debridmediamanager',
	targetAbi: '12.0.0.0',
	timestamp: '2026-09-09T12:00:00Z',
	version: '1.0.2.0',
	imagePath: 'thumb.png',
};

const body = (overrides: Record<string, unknown> = {}) => ({
	file: 'rd-zurg_1.0.2.0.zip',
	zip: ZIP.toString('base64'),
	meta: META,
	image: PNG.toString('base64'),
	...overrides,
});

/** A different plugin already in the catalog, which must survive a publish. */
const EXISTING: PublishedPlugin = {
	category: 'General',
	description: 'Your Usenet library in Jellyfin.',
	guid: 'a04d241d-878d-42b1-a06a-6681640e4f51',
	name: 'NZB zurg',
	overview: 'Serves a directory of NZBs as a Jellyfin library',
	owner: 'debridmediamanager',
	image: 'nzb-zurg_1.0.1.0.png',
	versions: [
		{
			version: '1.0.1.0',
			changelog: 'First release.',
			targetAbi: '12.0.0.0',
			file: 'nzb-zurg_1.0.1.0.zip',
			checksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			timestamp: '2026-09-09T10:00:00Z',
		},
	],
};

/** `null` means no header at all. An explicit `undefined` would take the default. */
async function post(
	payload: unknown,
	token: string | null = SECRET,
	method = 'POST'
): Promise<MockResponse> {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method,
			headers: token === null ? {} : { 'x-publish-token': token },
			body: payload as never,
		}),
		res
	);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.PLUGIN_PUBLISH_SECRET = SECRET;
	process.env.REDIS_URL = 'redis://catalog-lock.test';
	redisState.values.clear();
	redisState.failing = false;
	mockPut.mockResolvedValue(true);
	mockGet.mockResolvedValue(Buffer.from(JSON.stringify([EXISTING]), 'utf8'));
});

describe('the publish token', () => {
	it('refuses a wrong token, and stores nothing', async () => {
		const res = await post(body(), 'wrong-secret');
		expect(res._getStatusCode()).toBe(401);
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('refuses a missing token', async () => {
		expect((await post(body(), null))._getStatusCode()).toBe(401);
	});

	it('refuses everything when the server has no secret configured', async () => {
		delete process.env.PLUGIN_PUBLISH_SECRET;
		const res = await post(body(), SECRET);
		expect(res._getStatusCode()).toBe(500);
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('does not match a token that merely starts the same', () => {
		expect(isAuthorizedPublisher('publish', SECRET)).toBe(false);
		expect(isAuthorizedPublisher(SECRET, SECRET)).toBe(true);
		expect(isAuthorizedPublisher(SECRET, undefined)).toBe(false);
	});

	it('rejects a write method other than POST', async () => {
		expect((await post(body(), SECRET, 'GET'))._getStatusCode()).toBe(405);
	});
});

describe('what it accepts', () => {
	it('publishes the package, the image and the catalog, in that order', async () => {
		const res = await post(body());
		expect(res._getStatusCode()).toBe(200);

		const keys = mockPut.mock.calls.map((call) => call[0]);
		expect(keys).toEqual([
			'jellyfin-plugins/rd-zurg_1.0.2.0.zip',
			'jellyfin-plugins/rd-zurg_1.0.2.0.png',
			'jellyfin-plugins/catalog.json',
		]);
	});

	it('computes the checksum from the bytes rather than trusting the caller', async () => {
		const res = await post(body({ checksum: 'not-used' }));
		const data = res._getData() as { checksum: string };
		// md5 of the six ZIP bytes above.
		expect(data.checksum).toHaveLength(32);
		const written = JSON.parse(
			(mockPut.mock.calls.find((c) => c[0].endsWith('catalog.json'))![1] as Buffer).toString()
		) as PublishedPlugin[];
		const rd = written.find((p) => p.name === 'RD zurg')!;
		expect(rd.versions[0].checksum).toBe(data.checksum);
	});

	it('leaves the other plugins in the catalog alone', async () => {
		await post(body());
		const written = JSON.parse(
			(mockPut.mock.calls.find((c) => c[0].endsWith('catalog.json'))![1] as Buffer).toString()
		) as PublishedPlugin[];
		expect(written.map((p) => p.name).sort()).toEqual(['NZB zurg', 'RD zurg']);
		expect(written.find((p) => p.name === 'NZB zurg')).toEqual(EXISTING);
	});

	it('replaces its own entry rather than adding a second one', async () => {
		mockGet.mockResolvedValue(
			Buffer.from(
				JSON.stringify([EXISTING, { ...EXISTING, guid: META.guid, name: 'RD zurg' }]),
				'utf8'
			)
		);
		await post(body());
		const written = JSON.parse(
			(mockPut.mock.calls.find((c) => c[0].endsWith('catalog.json'))![1] as Buffer).toString()
		) as PublishedPlugin[];
		expect(written.filter((p) => p.guid === META.guid)).toHaveLength(1);
		expect(written.find((p) => p.guid === META.guid)!.versions[0].version).toBe('1.0.2.0');
	});

	it('publishes into an empty catalog', async () => {
		mockGet.mockResolvedValue(null);
		const res = await post(body());
		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as { plugins: string[] }).plugins).toEqual(['RD zurg 1.0.2.0']);
	});
});

describe('what it refuses', () => {
	const bad: [string, Record<string, unknown>][] = [
		['a filename with a path', { file: '../catalog.json.zip' }],
		['a filename that is not a zip', { file: 'rd-zurg.png' }],
		['a version that is not four numbers', { meta: { ...META, version: '1.0.2' } }],
		['a guid that is not a guid', { meta: { ...META, guid: 'not-a-guid' } }],
		['a missing meta field', { meta: { ...META, owner: '' } }],
		['a payload that is not a zip', { zip: Buffer.from('hello').toString('base64') }],
		['an image that is not a png', { image: Buffer.from('hello').toString('base64') }],
		['an empty payload', { zip: '' }],
	];

	it.each(bad)('refuses %s without storing anything', async (_label, overrides) => {
		const res = await post(body(overrides));
		expect(res._getStatusCode()).toBe(400);
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('reports a failed upload rather than claiming success', async () => {
		mockPut.mockResolvedValue(false);
		const res = await post(body());
		expect(res._getStatusCode()).toBe(502);
	});

	it('says so when the package landed but the catalog did not', async () => {
		mockPut.mockImplementation(async (key: string) => !key.endsWith('catalog.json'));
		const res = await post(body());
		expect(res._getStatusCode()).toBe(502);
		expect((res._getData() as { error: string }).error).toContain('catalog');
	});
});

describe('publishes that arrive together', () => {
	const TB_META = {
		...META,
		guid: 'b2fbcb58-7681-44c9-9e9c-0ac2e1456a2b',
		name: 'TB zurg',
		version: '1.0.2.0',
	};

	const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	/** A store whose reads and writes each take a moment, as B2's do. */
	function slowStore() {
		let catalog: Buffer = Buffer.from(JSON.stringify([EXISTING]), 'utf8');
		mockGet.mockImplementation(async (key: string) => {
			await later(25);
			return key.endsWith('catalog.json') ? catalog : null;
		});
		mockPut.mockImplementation(async (key: string, bytes: Buffer) => {
			await later(25);
			if (key.endsWith('catalog.json')) catalog = bytes;
			return true;
		});
		return () =>
			(JSON.parse(catalog.toString()) as PublishedPlugin[]).map(
				(plugin) => `${plugin.name} ${plugin.versions[0].version}`
			);
	}

	// On 2026-09-13 seven tag releases published within 22 seconds and RD zurg 1.0.4.0
	// vanished: a later publish had read the catalog before RD's write and wrote it back.
	it('keeps both plugins when two publish at the same moment', async () => {
		const stored = slowStore();

		const [rd, tb] = await Promise.all([
			post(body()),
			post(body({ file: 'tb-zurg_1.0.2.0.zip', meta: TB_META })),
		]);

		expect(rd._getStatusCode()).toBe(200);
		expect(tb._getStatusCode()).toBe(200);
		expect(stored()).toEqual(['NZB zurg 1.0.1.0', 'RD zurg 1.0.2.0', 'TB zurg 1.0.2.0']);
	});

	it('refuses to write the catalog without the lock', async () => {
		redisState.failing = true;

		const res = await post(body());

		expect(res._getStatusCode()).toBe(503);
		expect(mockPut.mock.calls.map((call) => call[0])).not.toContain(
			'jellyfin-plugins/catalog.json'
		);
	});

	it('lets go of the lock after a publish, so the next one is not kept waiting', async () => {
		await post(body());
		expect(redisState.values.size).toBe(0);
	});
});

describe('the merge', () => {
	it('matches on guid, not name, so a rename does not duplicate', () => {
		const renamed = { ...EXISTING, name: 'Usenet zurg' };
		expect(mergeIntoCatalog([EXISTING], renamed)).toEqual([renamed]);
	});

	it('keeps the catalog ordered by name so the file does not churn', () => {
		const a = { ...EXISTING, guid: '11111111-1111-1111-1111-111111111111', name: 'AD zurg' };
		expect(mergeIntoCatalog([EXISTING], a).map((p) => p.name)).toEqual(['AD zurg', 'NZB zurg']);
	});
});

describe('the reader', () => {
	it('bounds the payload size', () => {
		const huge = { ...body(), zip: Buffer.alloc(64).toString('base64') };
		expect('error' in readPublishRequest(huge, 16)).toBe(true);
	});
});
