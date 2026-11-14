// A copy served anywhere but debridmediamanager.com (jsdom's default is localhost).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			proxy: 'https://anticors.debridmediamanager.com/anticors?url=',
			authProxy: 'https://#num#.cors.debridmediamanager.com/api/anticors?url=',
			realDebridHostname: 'https://app.real-debrid.com',
			realDebridClientId: 'CLIENT_ID',
		},
	}),
}));

vi.mock('@/lib/observability/rdOperationalStats', () => ({
	recordRdOperationEvent: vi.fn(),
}));

import { __testing, getDeviceCode, getTorrentInfo, proxyUnrestrictLink } from './realDebrid';

const realAxios = __testing.realDebridAxios as any;
const genericAxios = __testing.genericAxios as any;

beforeEach(() => {
	realAxios.get = vi.fn();
	realAxios.post = vi.fn();
	genericAxios.get = vi.fn();
	genericAxios.post = vi.fn();
	__testing.clearUserRequestCache();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

const sentUrls = () =>
	[realAxios.get, realAxios.post, genericAxios.get, genericAxios.post].flatMap((fn) =>
		fn.mock.calls.map((call: unknown[]) => String(call[0]))
	);

describe('a self-hosted DMM keeps Real-Debrid tokens off DMM hosts', () => {
	it('sends browser calls through its own /api/anticors', async () => {
		genericAxios.get.mockResolvedValue({ data: { device_code: 'dev' } });
		realAxios.get.mockResolvedValue({ data: { id: 'X' } });
		await getDeviceCode();
		await getTorrentInfo('token', 'X');
		expect(sentUrls().sort()).toEqual([
			'/api/anticors?url=https://app.real-debrid.com/oauth/v2/device/code?client_id=CLIENT_ID&new_credentials=yes',
			'/api/anticors?url=https://app.real-debrid.com/rest/1.0/torrents/info/X',
		]);
	});

	it('calls Real-Debrid directly from the server', async () => {
		vi.stubGlobal('window', undefined);
		vi.stubEnv('DMM_ORIGIN', 'http://localhost:3000');
		genericAxios.get.mockResolvedValue({ data: { device_code: 'dev' } });
		await getDeviceCode();
		expect(sentUrls()[0]).toMatch(/^https:\/\/app\.real-debrid\.com\/oauth\/v2\/device\/code/);
	});

	it('unrestricts through Real-Debrid, not the unrestrict worker', async () => {
		realAxios.post.mockResolvedValue({ data: { filename: 'a.mkv', streamable: 1 } });
		await expect(
			proxyUnrestrictLink('token', 'https://real-debrid.com/d/ABC')
		).resolves.toEqual({ filename: 'a.mkv', streamable: 1 });
		expect(genericAxios.post).not.toHaveBeenCalled();
		expect(sentUrls()).toEqual([
			'/api/anticors?url=https://app.real-debrid.com/rest/1.0/unrestrict/link',
		]);
		expect(sentUrls().join(' ')).not.toContain('debridmediamanager.com');
	});
});
