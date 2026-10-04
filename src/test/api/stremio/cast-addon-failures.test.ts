// @vitest-environment node
import adCatalog from '@/pages/api/stremio-ad/[userid]/catalog/other/ad-casted-other.json';
import adMeta from '@/pages/api/stremio-ad/[userid]/meta/other/[id]';
import dlCatalog from '@/pages/api/stremio-dl/[userid]/catalog/other/dl-casted-other.json';
import dlMeta from '@/pages/api/stremio-dl/[userid]/meta/other/[id]';
import ocCatalog from '@/pages/api/stremio-oc/[userid]/catalog/other/oc-casted-other.json';
import ocMeta from '@/pages/api/stremio-oc/[userid]/meta/other/[id]';
import pmCatalog from '@/pages/api/stremio-pm/[userid]/catalog/other/pm-casted-other.json';
import pmMeta from '@/pages/api/stremio-pm/[userid]/meta/other/[id]';
import tbCatalog from '@/pages/api/stremio-tb/[userid]/catalog/other/tb-casted-other.json';
import tbMeta from '@/pages/api/stremio-tb/[userid]/meta/other/[id]';
import rdCatalog from '@/pages/api/stremio/[userid]/catalog/other/casted-other.json';
import rdMeta from '@/pages/api/stremio/[userid]/meta/other/[id]';
import rdStream from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import accountRefusals from '@/test/fixtures/castAddonFailures/account-refusals-2026-10-04.json';
import playRecorded from '@/test/fixtures/castAddonFailures/play-failures-2026-10-04.json';
import recorded from '@/test/fixtures/castAddonFailures/provider-failures-2026-10-04.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card 207: the DMM Cast addon routes answered provider failures with a 500.
 *
 * Every provider answer below is a real one, recorded 2026-10-04 into the
 * fixture. They are served to the real provider clients - axios through an
 * adapter installed before the clients are created, `fetch` through a stub -
 * so the interceptors, envelope parsing and error classes all run as in
 * production. The one network failure, Real-Debrid's "socket hang up", is not
 * recorded but produced: a local server destroys the socket and Node raises
 * the same ECONNRESET dmm-01 logged on 2026-10-03.
 */

type Reply = {
	status: number;
	contentType: string;
	body: unknown;
	headers?: Record<string, string>;
};
type Route = { method: string; match: RegExp; replies: Array<Reply | 'hang-up'> };

const net = vi.hoisted(() => ({
	routes: [] as Route[],
	calls: [] as string[],
	hangUpUrl: '',
}));

const answer = (method: string, url: string): Reply | 'hang-up' => {
	net.calls.push(`${method} ${url}`);
	const route = net.routes.find((r) => r.method === method && r.match.test(url));
	if (!route) throw new Error(`No recorded answer for ${method} ${url}`);
	return route.replies.length > 1 ? route.replies.shift()! : route.replies[0];
};

vi.mock('axios', async (importOriginal) => {
	const actual = await importOriginal<typeof import('axios')>();
	const axios = actual.default;
	const httpAdapter = axios.getAdapter('http');
	axios.defaults.adapter = async (config) => {
		const reply = answer((config.method ?? 'get').toUpperCase(), axios.getUri(config));
		if (reply === 'hang-up') {
			return httpAdapter({
				...config,
				baseURL: undefined,
				params: undefined,
				url: net.hangUpUrl,
			});
		}
		const response = {
			data: JSON.stringify(reply.body),
			status: reply.status,
			statusText: '',
			headers: new actual.AxiosHeaders({
				'content-type': reply.contentType,
				...reply.headers,
			}),
			config,
			request: {},
		};
		if (reply.status >= 200 && reply.status < 300) return response;
		throw new actual.AxiosError(
			`Request failed with status code ${reply.status}`,
			reply.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
			config,
			{},
			response
		);
	};
	return actual;
});

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			realDebridHostname: 'https://app.real-debrid.com',
			allDebridHostname: 'https://api.alldebrid.com',
			torboxHostname: 'https://api.torbox.app',
		},
	}),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getCastProfile: vi.fn(),
		getAllDebridCastProfile: vi.fn(),
		getTorBoxCastProfile: vi.fn(),
		getPremiumizeCastProfile: vi.fn(),
		getOffcloudCastProfile: vi.fn(),
		getDebridLinkCastProfile: vi.fn(),
		identifyLibraryHashes: vi.fn(async () => new Map()),
		recordTorBoxOperation: vi.fn(async () => undefined),
		recordRdOperation: vi.fn(async () => undefined),
	},
}));
vi.mock('@/lib/observability/rdOperationalStats', () => ({ recordRdOperationEvent: vi.fn() }));
vi.mock('@/lib/observability/torboxOperationalStats', () => ({
	recordTorBoxOperationEvent: vi.fn(),
	resolveTorBoxOperation: vi.fn(() => null),
}));

const db = vi.mocked(repository);

const fixture = (key: keyof typeof recorded.responses): Reply => recorded.responses[key];
/** Real-Debrid's 403 for a locked or lapsed account (card 220's recording). */
const rdPermissionDenied: Reply = playRecorded.responses['rd-permission-denied'];
const tbPlanRestricted: Reply = accountRefusals.responses['tb-mylist-plan-restricted'];

const on = (method: string, match: RegExp, ...replies: Array<Reply | 'hang-up'>) =>
	net.routes.push({ method, match, replies });

let hangUpServer: http.Server;

beforeAll(async () => {
	hangUpServer = http.createServer((req) => req.socket.destroy());
	await new Promise<void>((resolve) => hangUpServer.listen(0, '127.0.0.1', resolve));
	net.hangUpUrl = `http://127.0.0.1:${(hangUpServer.address() as AddressInfo).port}/`;
});

afterAll(() => {
	hangUpServer.close();
});

beforeEach(() => {
	vi.clearAllMocks();
	net.routes = [];
	net.calls = [];
	process.env.DMM_ORIGIN = 'https://debridmediamanager.com';
	vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
		const reply = answer((init?.method ?? 'GET').toUpperCase(), String(input));
		if (reply === 'hang-up') throw new TypeError('fetch failed');
		return new Response(JSON.stringify(reply.body), {
			status: reply.status,
			headers: { 'content-type': reply.contentType },
		});
	});
});

const call = async (handler: (req: any, res: any) => unknown, query: Record<string, string>) => {
	const res = createMockResponse();
	await handler(createMockRequest({ query }), res);
	return res;
};

const noticeOf = (res: ReturnType<typeof createMockResponse>) =>
	(res._getData() as { metas: Array<{ id: string; name: string }> }).metas;

// Each test uses its own OAuth client id: Real-Debrid tokens are cached per
// client id for the life of the module.
let clientSeq = 0;
const rdOAuthProfile = () => ({
	clientId: `card207-client-${++clientSeq}`,
	clientSecret: 'secret',
	refreshToken: 'refresh',
	apiKey: null,
});

describe('Real-Debrid', () => {
	it('answers a library catalog whose token call hangs up twice with an empty page, not a 500', async () => {
		db.getCastProfile.mockResolvedValue(rdOAuthProfile() as any);
		on('POST', /app\.real-debrid\.com\/oauth\/v2\/token$/, 'hang-up');

		const res = await call(rdCatalog, { userid: 'rduser000001' });

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ metas: [], hasMore: false, cacheMaxAge: 0 });
		expect(res._getHeaders()['Cache-Control']).toBe('no-store');
		// One dropped connection is retried once before giving up.
		expect(net.calls.filter((c) => c.includes('/oauth/v2/token'))).toHaveLength(2);
	});

	it('serves the library when only the first token call hangs up', async () => {
		db.getCastProfile.mockResolvedValue(rdOAuthProfile() as any);
		on('POST', /app\.real-debrid\.com\/oauth\/v2\/token$/, 'hang-up', {
			status: 200,
			contentType: 'application/json',
			body: { access_token: 'AT', expires_in: 86400 },
		});
		on('GET', /app\.real-debrid\.com\/rest\/1\.0\/torrents\?/, {
			status: 200,
			contentType: 'application/json',
			headers: { 'x-total-count': '1' },
			body: [{ id: 'UK2VUCC2TZGAU', filename: 'Some.Release.mkv', hash: 'a'.repeat(40) }],
		});

		const res = await call(rdCatalog, { userid: 'rduser000002' });

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			{ id: 'dmm:UK2VUCC2TZGAU', name: 'Some.Release.mkv', type: 'other' },
		]);
	});

	it('answers a pasted key Real-Debrid refuses with a sign-in-again tile', async () => {
		db.getCastProfile.mockResolvedValue({ apiKey: 'REVOKEDKEY' } as any);
		on(
			'GET',
			/app\.real-debrid\.com\/rest\/1\.0\/torrents\?/,
			fixture('rd-torrents-bad-token')
		);

		const res = await call(rdCatalog, { userid: 'rduser000003' });
		expect(net.calls).toEqual([expect.stringContaining('/rest/1.0/torrents?')]);

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({
				id: 'dmm:notice:credential',
				type: 'other',
				name: expect.stringContaining('Sign in to Real-Debrid again'),
			}),
		]);
	});

	// Card 224: Real-Debrid documents 403 permission_denied as "account
	// locked, not premium". A fresh sign-in mints a token for the same
	// account, so "sign in again" sent the member round in a circle.
	it('answers an account Real-Debrid refuses with an account tile, not sign-in-again', async () => {
		db.getCastProfile.mockResolvedValue({ apiKey: 'LAPSEDKEY' } as any);
		on('GET', /app\.real-debrid\.com\/rest\/1\.0\/torrents\?/, rdPermissionDenied);

		const res = await call(rdCatalog, { userid: 'rduser000007' });
		expect(net.calls).toEqual([expect.stringContaining('/rest/1.0/torrents?')]);

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({
				id: 'dmm:notice:account',
				name: expect.stringContaining('Real-Debrid refused your account'),
				description: expect.stringContaining('https://real-debrid.com/account'),
			}),
		]);
		expect(JSON.stringify(res._getData())).not.toMatch(/sign in/i);
		expect(res._getHeaders()['Cache-Control']).toBe('max-age=300');
	});

	it('answers a library meta under a refused account with the account notice', async () => {
		db.getCastProfile.mockResolvedValue({ apiKey: 'LAPSEDKEY' } as any);
		on('GET', /app\.real-debrid\.com\/rest\/1\.0\/torrents\/info\//, rdPermissionDenied);

		const res = await call(rdMeta, { userid: 'rduser000008', id: 'dmm:UK2VUCC2TZGAU.json' });

		expect(res._getStatusCode()).toBe(200);
		const meta = (res._getData() as any).meta;
		expect(meta).toMatchObject({
			id: 'dmm:UK2VUCC2TZGAU',
			name: expect.stringContaining('Real-Debrid refused your account'),
		});
		expect(meta.videos[0].streams[0].externalUrl).toBe('https://real-debrid.com/account');
	});

	// 59% of the RD meta route's 500s in the week to 2026-10-03 were ids like
	// these, sent by clients that ignore idPrefixes.
	it.each([
		'realdebrid:OJ55SVQXH4ARI',
		'torbox:100531515',
		'st:store:rd:OGHWDWMB2425E',
		'tt0111161',
	])('answers %s, which another addon issued, without asking Real-Debrid', async (id) => {
		db.getCastProfile.mockResolvedValue({ apiKey: 'KEY' } as any);
		on('GET', /\/rest\/1\.0\/torrents\/info\//, fixture('rd-torrent-info-foreign-id'));

		const res = await call(rdMeta, { userid: 'rduser000004', id: `${id}.json` });

		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ meta: null });
		expect(net.calls).toEqual([]);
	});

	it('answers a meta whose token call hangs up with a 503, not a 500', async () => {
		db.getCastProfile.mockResolvedValue(rdOAuthProfile() as any);
		on('POST', /app\.real-debrid\.com\/oauth\/v2\/token$/, 'hang-up');

		const res = await call(rdMeta, { userid: 'rduser000005', id: 'dmm:UK2VUCC2TZGAU.json' });

		expect(res._getStatusCode()).toBe(503);
	});

	it('tells an install whose profile is gone how to set it up again, on the stream list', async () => {
		db.getCastProfile.mockResolvedValue(null);

		const res = await call(rdStream, {
			userid: 'rduser000006',
			mediaType: 'movie',
			imdbid: 'tt0111161.json',
		});

		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as any).streams).toEqual([
			expect.objectContaining({ externalUrl: 'https://debridmediamanager.com/stremio' }),
		]);
	});
});

describe('TorBox', () => {
	it('answers a key TorBox refuses with a sign-in-again tile', async () => {
		db.getTorBoxCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		// The web download and usenet lists refuse the same key the same way.
		on(
			'GET',
			/api\.torbox\.app\/v1\/api\/(torrents|webdl|usenet)\/mylist/,
			fixture('tb-mylist-bad-token')
		);

		const res = await call(tbCatalog, { userid: 'tbuser000001' });
		expect(net.calls).toContainEqual(expect.stringContaining('/v1/api/torrents/mylist'));

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({ id: 'dmm-tb:notice:credential' }),
		]);
	});

	// Card 224: a free-plan key's library answered an empty catalog with no
	// word of why, the same as a TorBox outage would.
	it('answers a plan without API access with an account tile', async () => {
		db.getTorBoxCastProfile.mockResolvedValue({ apiKey: 'FREEPLAN' } as any);
		on('GET', /api\.torbox\.app\/v1\/api\/(torrents|webdl|usenet)\/mylist/, tbPlanRestricted);

		const res = await call(tbCatalog, { userid: 'tbuser000003' });

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({
				id: 'dmm-tb:notice:account',
				name: expect.stringContaining('TorBox refused your account'),
			}),
		]);
	});

	it('answers a torrent the account no longer holds with a 404', async () => {
		db.getTorBoxCastProfile.mockResolvedValue({ apiKey: 'KEY' } as any);
		on(
			'GET',
			/api\.torbox\.app\/v1\/api\/torrents\/mylist/,
			fixture('tb-mylist-id-not-in-account')
		);

		const res = await call(tbMeta, { userid: 'tbuser000002', id: 'dmm-tb:1.json' });
		expect(net.calls).toEqual([expect.stringContaining('/v1/api/torrents/mylist')]);

		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ meta: null });
	});
});

describe('Premiumize', () => {
	// The probe profile 75D4fh1ayxOm holds a key Premiumize now refuses with
	// this exact answer, and its library catalog answered 500.
	it('answers a key Premiumize refuses with a sign-in-again tile', async () => {
		db.getPremiumizeCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		on('POST', /premiumize\.me\/api\/folder\/list$/, fixture('pm-folder-list-bad-key'));

		const res = await call(pmCatalog, { userid: 'pmuser000001' });

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({
				id: 'dmm-pm:notice:credential',
				name: expect.stringContaining('Sign in to Premiumize again'),
			}),
		]);
	});

	it('answers a library meta under a refused key with the same notice', async () => {
		db.getPremiumizeCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		on('POST', /premiumize\.me\/api\/folder\/list$/, fixture('pm-folder-list-bad-key'));

		const res = await call(pmMeta, { userid: 'pmuser000002', id: 'dmm-pm:folder:abc.json' });

		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as any).meta).toMatchObject({
			id: 'dmm-pm:folder:abc',
			name: expect.stringContaining('Sign in to Premiumize again'),
		});
	});

	it.each([
		['folder', 'folder/list', 'pm-folder-list-id-not-in-account'],
		['file', 'item/details', 'pm-item-details-id-not-in-account'],
	] as const)(
		'answers a %s the account no longer holds with a 404',
		async (kind, endpoint, key) => {
			db.getPremiumizeCastProfile.mockResolvedValue({ apiKey: 'KEY' } as any);
			on('POST', new RegExp(`premiumize\\.me/api/${endpoint}$`), fixture(key));

			const res = await call(pmMeta, {
				userid: 'pmuser000003',
				id: `dmm-pm:${kind}:AAAA.json`,
			});

			expect(res._getStatusCode()).toBe(404);
			expect(res._getData()).toEqual({ meta: null });
		}
	);
});

describe('Offcloud', () => {
	it('answers a key Offcloud refuses with a sign-in-again tile', async () => {
		db.getOffcloudCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		on('GET', /offcloud\.com\/api\/cloud\/history$/, fixture('oc-cloud-history-bad-key'));

		const res = await call(ocCatalog, { userid: 'ocuser000001' });

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({ id: 'dmm-oc:notice:credential' }),
		]);
	});

	it('answers an item the account no longer holds with a 404', async () => {
		db.getOffcloudCastProfile.mockResolvedValue({ apiKey: 'KEY' } as any);
		on(
			'GET',
			/offcloud\.com\/api\/cloud\/explore\//,
			fixture('oc-cloud-explore-id-not-in-account')
		);

		const res = await call(ocMeta, {
			userid: 'ocuser000002',
			id: 'dmm-oc:000000000000000000000000.json',
		});

		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ meta: null });
	});
});

describe('Debrid-Link', () => {
	it('answers a token Debrid-Link refuses with a sign-in-again tile', async () => {
		db.getDebridLinkCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		on(
			'GET',
			/debrid-link\.[a-z]+\/api\/v2\/seedbox\/list/,
			fixture('dl-seedbox-list-bad-key')
		);

		const res = await call(dlCatalog, { userid: 'dluser000001' });

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({ id: 'dmm-dl:notice:credential' }),
		]);
	});
});

describe('AllDebrid', () => {
	// The library helper used to swallow this, so a revoked key read as an
	// empty library with nothing saying why.
	it('answers a key AllDebrid refuses with a sign-in-again tile', async () => {
		db.getAllDebridCastProfile.mockResolvedValue({ apiKey: 'REVOKED' } as any);
		on(
			'POST',
			/api\.alldebrid\.com\/v4\.1\/magnet\/status/,
			fixture('ad-magnet-status-bad-key')
		);

		const res = await call(adCatalog, { userid: 'aduser000001' });
		expect(net.calls).toEqual([expect.stringContaining('/v4.1/magnet/status')]);

		expect(res._getStatusCode()).toBe(200);
		expect(noticeOf(res)).toEqual([
			expect.objectContaining({ id: 'dmm-ad:notice:credential' }),
		]);
	});

	it('answers a magnet the account no longer holds with a 404', async () => {
		db.getAllDebridCastProfile.mockResolvedValue({ apiKey: 'KEY' } as any);
		on(
			'POST',
			/api\.alldebrid\.com\/v4\.1\/magnet\/files/,
			fixture('ad-magnet-files-id-not-in-account')
		);

		const res = await call(adMeta, { userid: 'aduser000002', id: 'dmm-ad:999999999.json' });
		expect(net.calls).toEqual([expect.stringContaining('/v4.1/magnet/files')]);

		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ meta: null });
	});
});

// Stremio asks every addon whose prefix matches for a tile's meta, so each
// addon has to answer its own notice ids itself, with no profile and no call.
describe.each([
	['dmm:notice:account', rdMeta, 'https://real-debrid.com/account'],
	['dmm-tb:notice:account', tbMeta, 'https://torbox.app/settings'],
	['dmm:notice:credential', rdMeta, '/stremio'],
	['dmm-ad:notice:credential', adMeta, '/stremio-alldebrid'],
	['dmm-tb:notice:credential', tbMeta, '/stremio-torbox'],
	['dmm-pm:notice:credential', pmMeta, '/stremio-premiumize'],
	['dmm-oc:notice:not-connected', ocMeta, '/stremio-offcloud'],
	['dmm-dl:notice:not-connected', dlMeta, '/stremio-debridlink'],
] as const)('opening the %s tile', (id, handler, page) => {
	it('answers a notice meta that links to the setup page, without a lookup', async () => {
		const res = await call(handler, { userid: 'anyuser00001', id: `${id}.json` });

		expect(res._getStatusCode()).toBe(200);
		const meta = (res._getData() as any).meta;
		expect(meta).toMatchObject({ id, type: 'other', name: expect.stringContaining('⚠️') });
		expect(meta.videos[0].streams[0].externalUrl).toBe(
			page.startsWith('https://') ? page : `https://debridmediamanager.com${page}`
		);
		expect(res._getHeaders()['Cache-Control']).toBe('max-age=300');
		expect(net.calls).toEqual([]);
		for (const lookup of [
			db.getCastProfile,
			db.getAllDebridCastProfile,
			db.getTorBoxCastProfile,
			db.getPremiumizeCastProfile,
			db.getOffcloudCastProfile,
			db.getDebridLinkCastProfile,
		]) {
			expect(lookup).not.toHaveBeenCalled();
		}
	});
});
