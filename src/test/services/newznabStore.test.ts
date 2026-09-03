import {
	_resetStoreForTest,
	getStoredNzb,
	isStoreConfigured,
	nzbObjectKey,
	putStoredNzb,
} from '@/services/newznab/store';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_ID = 'k001';
const APP_KEY = 'secret';
const BUCKET = 'dmm-nzbs';
const API_URL = 'https://api002.backblazeb2.com';
const DOWNLOAD_URL = 'https://f002.backblazeb2.com';
const XML = '<?xml version="1.0"?><nzb></nzb>';

const AUTH_BODY = {
	authorizationToken: 'auth-token-1',
	apiUrl: API_URL,
	downloadUrl: DOWNLOAD_URL,
	accountId: 'acct-1',
	allowed: { bucketId: 'bucket-abc' },
};

type StubResponse = {
	ok?: boolean;
	status?: number;
	json?: unknown;
	text?: string;
};

const respond = ({ status = 200, json, text = '' }: StubResponse): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: async () => json,
		text: async () => text,
	}) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

/** Every request the module made, in order, as [url, init] pairs. */
const calls = () => fetchMock.mock.calls.map(([url, init]) => [String(url), init] as const);
const urls = () => calls().map(([url]) => url);

const configure = () => {
	process.env.B2_KEY_ID = KEY_ID;
	process.env.B2_APP_KEY = APP_KEY;
	process.env.B2_BUCKET = BUCKET;
};

const unconfigure = () => {
	delete process.env.B2_KEY_ID;
	delete process.env.B2_APP_KEY;
	delete process.env.B2_BUCKET;
};

beforeEach(() => {
	_resetStoreForTest();
	configure();
	fetchMock = vi.fn();
	global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	unconfigure();
	vi.restoreAllMocks();
});

describe('configuration', () => {
	// The store is optional infrastructure. Without credentials it must be inert,
	// not merely failing — a request that reaches the network to learn it has no
	// key spends the caller's latency budget on nothing.
	it('is disabled with no env, making zero requests', async () => {
		unconfigure();
		expect(isStoreConfigured()).toBe(false);
		expect(await getStoredNzb('ds', 'abc')).toBeNull();
		expect(await putStoredNzb('ds', 'abc', XML)).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is disabled when only some of the three vars are set', async () => {
		delete process.env.B2_APP_KEY;
		expect(isStoreConfigured()).toBe(false);
		expect(await getStoredNzb('ds', 'abc')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('nzbObjectKey', () => {
	it('namespaces by indexer prefix and encodes the indexer-supplied id', () => {
		expect(nzbObjectKey('ds', 'abc123')).toBe('nzb/ds/abc123.nzb');
		expect(nzbObjectKey('ah', 'a/b c')).toBe('nzb/ah/a%2Fb%20c.nzb');
	});
});

describe('getStoredNzb', () => {
	it('authorizes once, then downloads by name with the account token', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ text: XML }));

		expect(await getStoredNzb('ds', 'abc123')).toBe(XML);

		const [authCall, downloadCall] = calls();
		expect(authCall[0]).toBe('https://api.backblazeb2.com/b2api/v2/b2_authorize_account');
		expect((authCall[1] as any).headers.Authorization).toBe(
			`Basic ${Buffer.from(`${KEY_ID}:${APP_KEY}`).toString('base64')}`
		);
		expect(downloadCall[0]).toBe(`${DOWNLOAD_URL}/file/${BUCKET}/nzb/ds/abc123.nzb`);
		expect((downloadCall[1] as any).headers.Authorization).toBe('auth-token-1');
	});

	// One authorization serves the process for a day; re-authorizing per read
	// would triple the request count on the hot path.
	it('reuses the cached authorization across reads', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValue(respond({ text: XML }));

		await getStoredNzb('ds', 'one');
		await getStoredNzb('ds', 'two');

		expect(urls().filter((url) => url.includes('b2_authorize_account'))).toHaveLength(1);
	});

	it('returns null on a miss', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ status: 404 }));

		expect(await getStoredNzb('ds', 'missing')).toBeNull();
	});

	// A B2 outage has to look exactly like a miss: the caller's fallback is the
	// indexer, so an escaping error would turn a degraded cache into a dead page.
	it('returns null rather than throwing on a network failure', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockRejectedValueOnce(new Error('ECONNRESET'));

		await expect(getStoredNzb('ds', 'abc123')).resolves.toBeNull();
	});

	it('returns null when the authorize call itself fails', async () => {
		fetchMock.mockRejectedValue(new Error('dns'));
		await expect(getStoredNzb('ds', 'abc123')).resolves.toBeNull();
		// And the failure is not cached as an authorization.
		fetchMock.mockReset();
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ text: XML }));
		expect(await getStoredNzb('ds', 'abc123')).toBe(XML);
	});

	it('returns null on a timeout', async () => {
		const aborted = Object.assign(new Error('The operation was aborted'), {
			name: 'TimeoutError',
		});
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockRejectedValueOnce(aborted);

		await expect(getStoredNzb('ds', 'abc123')).resolves.toBeNull();
	});

	it('passes an abort signal on both the authorize and the download', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ text: XML }));

		await getStoredNzb('ds', 'abc123');
		for (const [, init] of calls()) {
			expect((init as any).signal).toBeInstanceOf(AbortSignal);
		}
	});

	// A revoked or rotated key expires the token before its 24h are up, so the
	// 401 path is the real refresh trigger. Once, though: a 401 that survives a
	// fresh token is a config error, and looping on it is a request storm.
	it('re-authorizes exactly once and retries the read once', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ status: 401 }))
			.mockResolvedValueOnce(
				respond({ json: { ...AUTH_BODY, authorizationToken: 'auth-token-2' } })
			)
			.mockResolvedValueOnce(respond({ text: XML }));

		expect(await getStoredNzb('ds', 'abc123')).toBe(XML);

		const all = calls();
		expect(all).toHaveLength(4);
		expect(all.filter(([url]) => url.includes('b2_authorize_account'))).toHaveLength(2);
		expect((all[3][1] as any).headers.Authorization).toBe('auth-token-2');
	});

	it('gives up after one retry when the 401 persists', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ status: 401 }))
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ status: 401 }));

		expect(await getStoredNzb('ds', 'abc123')).toBeNull();
		expect(calls()).toHaveLength(4);
	});
});

describe('putStoredNzb', () => {
	const uploadBody = { uploadUrl: `${API_URL}/upload/one`, authorizationToken: 'upload-token' };

	it('uploads with the name, content type and sha1 B2 requires', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ json: { fileId: 'f1' } }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(true);

		const [, uploadUrlCall, uploadCall] = calls();
		expect(uploadUrlCall[0]).toBe(`${API_URL}/b2api/v2/b2_get_upload_url`);
		expect(JSON.parse((uploadUrlCall[1] as any).body)).toEqual({ bucketId: 'bucket-abc' });

		expect(uploadCall[0]).toBe(uploadBody.uploadUrl);
		const init = uploadCall[1] as any;
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({
			Authorization: 'upload-token',
			'X-Bz-File-Name': 'nzb/ds/abc123.nzb',
			'Content-Type': 'application/x-nzb',
			'X-Bz-Content-Sha1': createHash('sha1').update(XML, 'utf8').digest('hex'),
		});
		expect(init.body).toBe(XML);
	});

	// B2 hands out per-endpoint upload URLs that expire on their own schedule, so
	// a held one is a stale one. One control call per put is the cheap answer.
	it('fetches a fresh upload url for every put', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValue(respond({ json: uploadBody }));

		await putStoredNzb('ds', 'one', XML);
		await putStoredNzb('ds', 'two', XML);

		expect(urls().filter((url) => url.includes('b2_get_upload_url'))).toHaveLength(2);
	});

	it('resolves the bucket id by name when the key is not bucket-scoped', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: { ...AUTH_BODY, allowed: {} } }))
			.mockResolvedValueOnce(
				respond({ json: { buckets: [{ bucketId: 'bucket-xyz', bucketName: BUCKET }] } })
			)
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ json: { fileId: 'f1' } }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(true);

		const listCall = calls()[1];
		expect(listCall[0]).toBe(`${API_URL}/b2api/v2/b2_list_buckets`);
		expect(JSON.parse((listCall[1] as any).body)).toEqual({
			accountId: 'acct-1',
			bucketName: BUCKET,
		});
		expect(JSON.parse((calls()[2][1] as any).body)).toEqual({ bucketId: 'bucket-xyz' });
	});

	it('returns false when B2 rejects the upload', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ status: 500 }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(false);
	});

	// A failed write only costs the next reader an indexer call. Throwing would
	// cost the caller the response it was about to send.
	it('returns false rather than throwing on a network failure', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockRejectedValueOnce(new Error('EPIPE'));

		await expect(putStoredNzb('ds', 'abc123', XML)).resolves.toBe(false);
	});

	it('re-authorizes once and retries the whole write on a 401 upload', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ status: 401 }))
			.mockResolvedValueOnce(
				respond({ json: { ...AUTH_BODY, authorizationToken: 'auth-token-2' } })
			)
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ json: { fileId: 'f1' } }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(true);
		expect(urls().filter((url) => url.includes('b2_authorize_account'))).toHaveLength(2);
	});

	// The 401 can land on the first call of the write, before any upload URL
	// exists — that must still trigger the retry, not end the put.
	it('re-authorizes when b2_get_upload_url is the call that 401s', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ status: 401 }))
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ json: { fileId: 'f1' } }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(true);
		expect(urls().filter((url) => url.includes('b2_authorize_account'))).toHaveLength(2);
	});

	it('gives up after one retry when the 401 persists', async () => {
		fetchMock
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ status: 401 }))
			.mockResolvedValueOnce(respond({ json: AUTH_BODY }))
			.mockResolvedValueOnce(respond({ json: uploadBody }))
			.mockResolvedValueOnce(respond({ status: 401 }));

		expect(await putStoredNzb('ds', 'abc123', XML)).toBe(false);
		expect(calls()).toHaveLength(6);
	});
});
