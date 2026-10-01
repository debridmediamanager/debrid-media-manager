import handler from '@/pages/api/emby-plugins/publish';
import type { EmbyPublishedPlugin } from '@/services/embyPlugins/catalog';
import { readEmbyPublishRequest } from '@/services/embyPlugins/publish';
import { getStoredObject, putStoredObject } from '@/services/newznab/store';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/newznab/store', () => ({
	getStoredObject: vi.fn(),
	putStoredObject: vi.fn(),
}));

// Redis as the catalog lock uses it, shared by every request as it is by every replica.
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
const DLL = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(126, 0x90)]);
const SHA256 = createHash('sha256').update(DLL).digest('hex');
const MD5 = createHash('md5').update(DLL).digest('hex');
const OBJECT = `Emby.Plugin.RdZurg_1.0.1.0_${SHA256.slice(0, 16)}.dll`;

const META = {
	guid: '43175d8f-3984-445c-a4cb-e4d2e1aa0fce',
	name: 'RD zurg',
	description: 'Your Real-Debrid library in Emby, without a mount.',
	version: '1.0.1.0',
	changelog: 'Signed playback URLs.',
};

const body = (overrides: Record<string, unknown> = {}) => ({
	file: 'Emby.Plugin.RdZurg.dll',
	dll: DLL.toString('base64'),
	sha256: SHA256,
	meta: META,
	...overrides,
});

/** A different plugin already in the Emby catalog, which must survive a publish. */
const EXISTING: EmbyPublishedPlugin = {
	guid: '8e2c6a41-5d73-4f18-9b0a-2c5e7d41ab6f',
	name: 'AD zurg',
	description: 'Your AllDebrid library in Emby, without a mount.',
	assembly: 'Emby.Plugin.AdZurg.dll',
	version: '1.0.0.0',
	changelog: 'First build.',
	timestamp: '2026-09-20T00:00:00.000Z',
	object: 'Emby.Plugin.AdZurg_1.0.0.0_0123456789abcdef.dll',
	sha256: 'c'.repeat(64),
	md5: 'd'.repeat(32),
	size: 157184,
};

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

const writtenCatalog = (): EmbyPublishedPlugin[] =>
	JSON.parse(
		(
			mockPut.mock.calls.find((c) => c[0] === 'emby-plugins/catalog.json')![1] as Buffer
		).toString()
	);

beforeEach(() => {
	vi.clearAllMocks();
	process.env.PLUGIN_PUBLISH_SECRET = SECRET;
	process.env.REDIS_URL = 'redis://catalog-lock.test';
	redisState.values.clear();
	redisState.failing = false;
	mockPut.mockResolvedValue(true);
	mockGet.mockImplementation(async (key: string) =>
		key === 'emby-plugins/catalog.json' ? Buffer.from(JSON.stringify([EXISTING]), 'utf8') : null
	);
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
		const res = await post(body());
		expect(res._getStatusCode()).toBe(500);
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('rejects a method other than POST', async () => {
		expect((await post(body(), SECRET, 'GET'))._getStatusCode()).toBe(405);
	});
});

describe('what it accepts', () => {
	it('stores the DLL under the Emby prefix before the Emby catalog, and nothing else', async () => {
		const res = await post(body());
		expect(res._getStatusCode()).toBe(200);
		expect(mockPut.mock.calls.map((call) => call[0])).toEqual([
			`emby-plugins/${OBJECT}`,
			'emby-plugins/catalog.json',
		]);
		expect(mockGet.mock.calls.map((call) => call[0])).toEqual(['emby-plugins/catalog.json']);
	});

	it('records digests it computed from the stored bytes', async () => {
		const res = await post(body());
		expect(res._getData()).toMatchObject({ sha256: SHA256, md5: MD5 });

		const rd = writtenCatalog().find((p) => p.guid === META.guid)!;
		expect(rd).toMatchObject({
			assembly: 'Emby.Plugin.RdZurg.dll',
			version: '1.0.1.0',
			object: OBJECT,
			sha256: SHA256,
			md5: MD5,
			size: DLL.length,
			changelog: 'Signed playback URLs.',
		});
		const stored = mockPut.mock.calls[0][1] as Buffer;
		expect(Buffer.from(stored).toString('hex')).toBe(DLL.toString('hex'));
	});

	it('leaves the other Emby plugins alone', async () => {
		await post(body());
		const written = writtenCatalog();
		expect(written.map((p) => p.name)).toEqual(['AD zurg', 'RD zurg']);
		expect(written.find((p) => p.name === 'AD zurg')).toEqual(EXISTING);
	});

	it('replaces its own entry, matched on the plugin id', async () => {
		mockGet.mockResolvedValue(
			Buffer.from(
				JSON.stringify([
					EXISTING,
					{
						...EXISTING,
						guid: META.guid.toUpperCase(),
						name: 'RD zurg (old name)',
						assembly: 'Emby.Plugin.RdZurg.dll',
						version: '1.0.0.0',
					},
				]),
				'utf8'
			)
		);
		await post(body());
		const mine = writtenCatalog().filter((p) => p.guid.toLowerCase() === META.guid);
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ name: 'RD zurg', version: '1.0.1.0' });
	});

	it('publishes into an empty catalog', async () => {
		mockGet.mockResolvedValue(null);
		const res = await post(body());
		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as { plugins: string[] }).plugins).toEqual(['RD zurg 1.0.1.0']);
	});
});

describe('what it refuses', () => {
	const bad: [string, Record<string, unknown>][] = [
		['a filename with a path', { file: '../Emby.Plugin.RdZurg.dll' }],
		['a filename that is not a plugin assembly', { file: 'MediaBrowser.Controller.dll' }],
		['a Jellyfin package', { file: 'rd-zurg_1.0.2.0.zip' }],
		['a version that is not four numbers', { meta: { ...META, version: '1.0.1' } }],
		['a guid that is not a guid', { meta: { ...META, guid: 'not-a-guid' } }],
		['a missing name', { meta: { ...META, name: ' ' } }],
		['a missing description', { meta: { ...META, description: '' } }],
		['a payload that is not an assembly', { dll: Buffer.alloc(128, 0x41).toString('base64') }],
		['an empty payload', { dll: '' }],
		['a missing sha256', { sha256: undefined }],
		['a sha256 that does not match the bytes', { sha256: 'e'.repeat(64) }],
	];

	it.each(bad)('refuses %s without storing anything', async (_label, overrides) => {
		const res = await post(body(overrides));
		expect(res._getStatusCode()).toBe(400);
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('refuses an assembly name another plugin already ships under', async () => {
		const res = await post(
			body({ file: 'Emby.Plugin.AdZurg.dll', meta: { ...META, name: 'Impostor' } })
		);
		expect(res._getStatusCode()).toBe(409);
		expect(mockPut.mock.calls.map((c) => c[0])).not.toContain('emby-plugins/catalog.json');
	});

	it('reports a failed upload rather than claiming success', async () => {
		mockPut.mockResolvedValue(false);
		const res = await post(body());
		expect(res._getStatusCode()).toBe(502);
		expect(mockPut.mock.calls.map((c) => c[0])).not.toContain('emby-plugins/catalog.json');
	});

	it('says so when the DLL landed but the catalog did not', async () => {
		mockPut.mockImplementation(async (key: string) => !key.endsWith('catalog.json'));
		const res = await post(body());
		expect(res._getStatusCode()).toBe(502);
		expect((res._getData() as { error: string }).error).toContain('catalog');
	});

	it('bounds the payload size', () => {
		expect('error' in readEmbyPublishRequest(body(), 16)).toBe(true);
	});
});

describe('publishes that arrive together', () => {
	const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	function slowStore() {
		let catalog: Buffer = Buffer.from(JSON.stringify([EXISTING]), 'utf8');
		mockGet.mockImplementation(async (key: string) => {
			await later(25);
			return key === 'emby-plugins/catalog.json' ? catalog : null;
		});
		mockPut.mockImplementation(async (key: string, bytes: Buffer) => {
			await later(25);
			if (key === 'emby-plugins/catalog.json') catalog = bytes;
			return true;
		});
		return () =>
			(JSON.parse(catalog.toString()) as EmbyPublishedPlugin[]).map(
				(plugin) => `${plugin.name} ${plugin.version}`
			);
	}

	it('keeps both plugins when two publish at the same moment', async () => {
		const stored = slowStore();
		const TB = {
			...META,
			guid: '7ff89db3-059a-48d4-8cf7-3e3c55a2d39f',
			name: 'TB zurg',
			version: '1.0.0.0',
		};

		const [rd, tb] = await Promise.all([
			post(body()),
			post(body({ file: 'Emby.Plugin.TbZurg.dll', meta: TB })),
		]);

		expect(rd._getStatusCode()).toBe(200);
		expect(tb._getStatusCode()).toBe(200);
		expect(stored()).toEqual(['AD zurg 1.0.0.0', 'RD zurg 1.0.1.0', 'TB zurg 1.0.0.0']);
	});

	it('takes the Emby lock, so a Jellyfin publish in flight does not hold it up', async () => {
		redisState.values.set('jellyfin-plugins:catalog-lock', 'someone-else');

		const res = await post(body());

		expect(res._getStatusCode()).toBe(200);
		expect(redisState.values.get('jellyfin-plugins:catalog-lock')).toBe('someone-else');
		expect(redisState.values.has('emby-plugins:catalog-lock')).toBe(false);
	});

	it('refuses to write the catalog without the lock', async () => {
		redisState.failing = true;
		const res = await post(body());
		expect(res._getStatusCode()).toBe(503);
		expect(mockPut.mock.calls.map((call) => call[0])).not.toContain(
			'emby-plugins/catalog.json'
		);
	});
});
