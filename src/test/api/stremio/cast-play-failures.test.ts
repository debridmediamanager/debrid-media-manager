// @vitest-environment node
import adPlay from '@/pages/api/stremio-ad/[userid]/play/[hash]';
import tbPlay from '@/pages/api/stremio-tb/[userid]/play/[hash]';
import rdPlay from '@/pages/api/stremio/[userid]/play/[link]';
import { repository } from '@/services/repository';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { _testing as torboxTesting } from '@/services/torbox';
import recorded from '@/test/fixtures/castAddonFailures/play-failures-2026-10-04.json';
import providerRecorded from '@/test/fixtures/castAddonFailures/provider-failures-2026-10-04.json';
import tbPlanRestricted from '@/test/fixtures/torbox/createtorrent-plan-restricted-2026-09-23.json';
import tbBadToken from '@/test/fixtures/torbox/user-me-bad-token-2026-09-24.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card 220: the DMM Cast play routes answered provider refusals with a 500.
 *
 * dmm-01's access log for 2026-09-27..10-03 holds 21,044 Real-Debrid and 1,567
 * TorBox play 500s, and 108 TorBox plays the proxy cut off at 60 s. A player
 * never shows the body of a failed play, and the log shows players repeat a
 * 403 at least as often as a 500, so no status code tells the member anything.
 * What every player does follow is a redirect to something it can play - that
 * is how a successful play works - so a problem the member can act on now
 * plays a short notice video instead.
 *
 * The provider answers are recorded ones (see the fixture for where each comes
 * from), served to the real Real-Debrid and TorBox clients so that their
 * interceptors and retry ladders run as in production.
 */

type Reply = {
	status: number;
	contentType: string;
	body: unknown;
	headers?: Record<string, string>;
};
type Route = {
	method: string;
	match: RegExp;
	replies: Array<Reply | 'hang-up' | 'never'>;
};

const net = vi.hoisted(() => ({
	routes: [] as Route[],
	calls: [] as string[],
	hangUpUrl: '',
}));

const answer = (method: string, url: string) => {
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
		if (reply === 'never') return new Promise(() => {});
		if (reply === 'hang-up') {
			return httpAdapter({
				...config,
				baseURL: undefined,
				params: undefined,
				url: net.hangUpUrl,
			});
		}
		const response = {
			data:
				typeof reply.body === 'string' && !reply.contentType.includes('json')
					? reply.body
					: JSON.stringify(reply.body),
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
		getTorBoxCastProfile: vi.fn(),
		getAllDebridCastProfile: vi.fn(),
		getAllDebridCastLink: vi.fn(),
		getHashByLink: vi.fn(async () => null),
		removeAvailableFileByLinkPrefix: vi.fn(async () => 0),
		deleteCastsByLinkPrefix: vi.fn(async () => 0),
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
const tbReply = (recording: { status: number; body: unknown }): Reply => ({
	status: recording.status,
	contentType: 'application/json',
	body: recording.body,
});
const ok = (body: unknown): Reply => ({ status: 200, contentType: 'application/json', body });

const on = (
	method: string,
	match: RegExp,
	...replies: Array<Reply | 'hang-up' | 'never'>
): void => {
	net.routes.push({ method, match, replies });
};
const VIDEO = (name: string) => `https://debridmediamanager.com/noprecache/cast-play/${name}.mp4`;

const UNRESTRICT = /\/rest\/1\.0\/unrestrict\/link/;
const RD_TOKEN = /\/oauth\/v2\/token/;
const LINK = 'ABCDEFGHJKMNPQRS';
const LINK_PREFIX = 'https://real-debrid.com/d/ABCDEFGHJKMNP';
const HASH = '0123456789abcdef0123456789abcdef01234567';

const playRd = async () => {
	const req = createMockRequest({
		query: { userid: 'rd-user', link: LINK },
		headers: { 'cf-connecting-ip': '198.51.100.20' },
	});
	const res = createMockResponse();
	await rdPlay(req, res);
	return res;
};

const playTb = async (query: Record<string, string>) => {
	const req = createMockRequest({ query: { userid: 'tb-user', ...query } });
	const res = createMockResponse();
	await tbPlay(req, res);
	return res;
};

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
	net.routes.length = 0;
	net.calls.length = 0;
	vi.clearAllMocks();
	torboxTesting.resetState();
	setBlocklistForTests([]);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	db.getCastProfile.mockResolvedValue({
		clientId: 'client-id',
		clientSecret: 'client-secret',
		refreshToken: 'refresh-token',
		apiKey: null,
	} as never);
	db.getTorBoxCastProfile.mockResolvedValue({ apiKey: 'tb-key' } as never);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('Real-Debrid play', () => {
	// Real-Debrid documents 403 as an account answer: locked, or not premium.
	// The link is fine, so nothing may be deleted, and the member is the only
	// one who can do anything about it.
	it('plays the account notice for a 403 permission_denied and keeps the link', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, fixture('rd-permission-denied'));

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('account-refused'));
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
		expect(db.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(db.deleteCastsByLinkPrefix).not.toHaveBeenCalled();
	});

	it("plays the network notice when Real-Debrid refuses the player's address", async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, fixture('rd-unrestrict-ip-not-allowed'));

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('network-refused'));
		expect(db.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(db.deleteCastsByLinkPrefix).not.toHaveBeenCalled();
	});

	// A 403 is about the account whatever its body says. The cleanup deletes the
	// link for every member, so it must never run on one.
	it('never drops a link on a 403, even one that names the file', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, {
			...fixture('rd-permission-denied'),
			body: { error: 'unavailable_file', error_code: 24 },
		});

		const res = await playRd();

		expect(db.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
		expect(db.deleteCastsByLinkPrefix).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('account-refused'));
	});

	it('still drops a link Real-Debrid says has aged out, and says so', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, fixture('rd-unrestrict-hoster-unavailable'));

		const res = await playRd();

		expect(db.removeAvailableFileByLinkPrefix).toHaveBeenCalledWith(LINK_PREFIX);
		expect(db.deleteCastsByLinkPrefix).toHaveBeenCalledWith(LINK_PREFIX);
		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('file-unavailable'));
	});

	it('plays the file notice for a name Real-Debrid will not serve, and keeps the link', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, fixture('rd-unrestrict-infringing-file'));

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('file-unavailable'));
		expect(db.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
	});

	// dmm-01 2026-10-03: three installs drew a 401 on unrestrict and played fine
	// the rest of the week, so the credential behind them was alive and only the
	// access token cached for it was not.
	it('mints a fresh token once when unrestrict refuses the cached one', async () => {
		on(
			'POST',
			RD_TOKEN,
			ok({ access_token: 'stale-token', expires_in: 86400 }),
			ok({ access_token: 'fresh-token', expires_in: 86400 })
		);
		on(
			'POST',
			UNRESTRICT,
			fixture('rd-unrestrict-bad-token'),
			ok({ download: 'https://rd.example/download/file.mkv' })
		);
		db.getCastProfile.mockResolvedValue({
			clientId: 'client-401',
			clientSecret: 'client-secret',
			refreshToken: 'refresh-token',
			apiKey: null,
		} as never);

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith('https://rd.example/download/file.mkv');
		expect(net.calls.filter((call) => RD_TOKEN.test(call))).toHaveLength(2);
	});

	it('plays the sign-in notice when the fresh token is refused as well', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-x', expires_in: 86400 }));
		on('POST', UNRESTRICT, fixture('rd-unrestrict-bad-token'));
		db.getCastProfile.mockResolvedValue({ apiKey: 'pasted-key' } as never);

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('sign-in-again'));
	});

	it('plays the sign-in notice when the sign-in itself was revoked', async () => {
		on('POST', RD_TOKEN, {
			status: 403,
			contentType: 'application/json',
			body: { error: 'permission_denied', error_code: 9 },
		});
		db.getCastProfile.mockResolvedValue({
			clientId: 'client-revoked',
			clientSecret: 'client-secret',
			refreshToken: 'refresh-token',
			apiKey: null,
		} as never);

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('sign-in-again'));
	});

	it('plays the set-up notice when the install has no profile', async () => {
		db.getCastProfile.mockResolvedValue(null as never);

		const res = await playRd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('set-up-again'));
	});

	it('answers 503, not a notice, when our own database fails', async () => {
		db.getCastProfile.mockRejectedValue(new Error('Too many connections'));

		const res = await playRd();

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.redirect).not.toHaveBeenCalled();
	});

	it('answers 503 and keeps the link when Real-Debrid drops the connection', async () => {
		on('POST', RD_TOKEN, ok({ access_token: 'token-1', expires_in: 86400 }));
		on('POST', UNRESTRICT, 'hang-up');

		const res = await playRd();

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(db.removeAvailableFileByLinkPrefix).not.toHaveBeenCalled();
	});
});

describe('TorBox play', () => {
	const MYLIST = /\/torrents\/mylist/;
	const CHECKCACHED = /\/torrents\/checkcached/;
	const REQUESTDL = /\/torrents\/requestdl/;

	it('plays the set-up notice when the install has no profile', async () => {
		db.getTorBoxCastProfile.mockResolvedValue(null as never);

		const res = await playTb({ hash: '123:456' });

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('set-up-again'));
	});

	it('plays the account notice when the plan no longer includes the API', async () => {
		on('GET', CHECKCACHED, tbReply(tbPlanRestricted));

		const res = await playTb({ hash: HASH });

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('account-refused'));
	});

	// The fallback would spend the same refused key on a cache check and an add.
	it('plays the sign-in notice for a refused key without trying the fallback', async () => {
		on('GET', REQUESTDL, tbReply(tbBadToken));

		const res = await playTb({ hash: '123:456', h: HASH, own: '1' });

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('sign-in-again'));
		expect(net.calls.some((call) => CHECKCACHED.test(call))).toBe(false);
	});

	it('plays the file notice when TorBox no longer has the release', async () => {
		on('GET', CHECKCACHED, ok({ success: true, data: {} }));

		const res = await playTb({ hash: HASH });

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('file-unavailable'));
	});

	it('answers a TorBox lockout at once instead of sitting it out', async () => {
		on('GET', CHECKCACHED, ok({ success: true, data: { [HASH]: { name: 'x' } } }));
		on('GET', MYLIST, fixture('tb-rate-limited'));

		vi.useFakeTimers();
		const pending = playTb({ hash: HASH });
		let res: Awaited<typeof pending> | undefined;
		void pending.then((value) => {
			res = value;
		});
		await vi.advanceTimersByTimeAsync(1_000);

		expect(res).toBeDefined();
		expect(res!.status).toHaveBeenCalledWith(503);
	});

	// 108 TorBox plays in the week ran past the proxy's 60 s. An answer after
	// that reaches nobody, so the route stops waiting well before it.
	it('answers 503 before the proxy gives up when TorBox never answers', async () => {
		on('GET', CHECKCACHED, 'never');

		vi.useFakeTimers();
		const pending = playTb({ hash: HASH });
		let res: Awaited<typeof pending> | undefined;
		void pending.then((value) => {
			res = value;
		});
		await vi.advanceTimersByTimeAsync(30_000);

		expect(res).toBeDefined();
		expect(res!.status).toHaveBeenCalledWith(503);
	});
});

/**
 * Card 224: the AllDebrid play route still answered every failure with a 500 -
 * 139 in the week to 2026-10-04, 121 of them from two installs on 2026-10-03
 * that never played anything, while another member played one of the same
 * files fine. AllDebrid sends its refusals inside an HTTP 200, and the client
 * kept only the message, so the route could not tell them apart.
 */
describe('AllDebrid play', () => {
	const UNLOCK = /api\.alldebrid\.com\/v4\.1\/link\/unlock/;
	const FILES = /api\.alldebrid\.com\/v4\.1\/magnet\/files/;
	const USER = /api\.alldebrid\.com\/v4\.1\/user/;
	const STORED = 'https://alldebrid.com/f/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const magnetNotInAccount = () =>
		tbReply(providerRecorded.responses['ad-magnet-files-id-not-in-account']);

	const playAd = async (hash = '709355080:0') => {
		const req = createMockRequest({ query: { userid: 'ad-user', hash } });
		const res = createMockResponse();
		await adPlay(req, res);
		return res;
	};

	beforeEach(() => {
		db.getAllDebridCastProfile.mockResolvedValue({ apiKey: 'ad-key' } as never);
		db.getAllDebridCastLink.mockResolvedValue(STORED as never);
	});

	it('redirects to the unlocked file', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-success'));

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(
			'https://example.debrid.it/dl/0abcdefghij/Example.Movie.2025.mkv'
		);
	});

	it('plays the set-up notice when the install has no profile', async () => {
		db.getAllDebridCastProfile.mockResolvedValue(null as never);

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('set-up-again'));
		expect(res.status).not.toHaveBeenCalledWith(500);
	});

	it('answers 503, not a notice, when our own database fails', async () => {
		db.getAllDebridCastProfile.mockRejectedValue(new Error('Too many connections'));

		const res = await playAd();

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.redirect).not.toHaveBeenCalled();
	});

	// AllDebrid holds a key used from an address it has not seen for the
	// account - DMM's server, for a play - until the owner confirms the email
	// it sent. Nothing else fixes it, and the magnet is refused the same way.
	it('plays the confirm notice when AllDebrid holds the sign-in for a new location', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-auth-blocked'));

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('confirm-sign-in'));
		expect(net.calls.some((call) => FILES.test(call))).toBe(false);
	});

	it('plays the sign-in notice for a key AllDebrid no longer accepts', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-bad-key'));

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('sign-in-again'));
	});

	// Someone else's cast: the magnet id is not this account's, so only the
	// stored link's answer says anything, and AllDebrid says it cannot unlock it.
	it('plays the file notice when a premium account cannot unlock the stored link', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-link-not-supported'));
		on('POST', FILES, magnetNotInAccount());
		on('GET', USER, fixture('ad-user-premium'));

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('file-unavailable'));
	});

	// The same refusal to an account without premium is the account's, and a
	// file notice would send the member hunting through every stream.
	it('plays the account notice when the account has no premium', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-link-not-supported'));
		on('POST', FILES, magnetNotInAccount());
		on('GET', USER, fixture('ad-user-free'));

		const res = await playAd();

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('account-refused'));
	});

	it('plays the file notice for a saved link AllDebrid will not unlock', async () => {
		on('POST', UNLOCK, fixture('ad-unlock-link-not-supported'));
		on('GET', USER, fixture('ad-user-premium'));
		const savedLink = `l${Buffer.from('https://1fichier.com/?example', 'utf8').toString('base64url')}`;

		const res = await playAd(`${savedLink}:0`);

		expect(res.redirect).toHaveBeenCalledWith(307, VIDEO('file-unavailable'));
	});

	// AllDebrid throttles with an empty 503, and the client retries that for
	// up to two minutes - past the proxy's 60 s, after which nobody hears it.
	it('answers 503 before the proxy gives up when AllDebrid keeps throttling', async () => {
		on('POST', UNLOCK, fixture('ad-throttled'));

		vi.useFakeTimers();
		const pending = playAd();
		let res: Awaited<typeof pending> | undefined;
		void pending.then((value) => {
			res = value;
		});
		await vi.advanceTimersByTimeAsync(30_000);

		expect(res).toBeDefined();
		expect(res!.status).toHaveBeenCalledWith(503);
		expect(res!.redirect).not.toHaveBeenCalled();
	});
});
