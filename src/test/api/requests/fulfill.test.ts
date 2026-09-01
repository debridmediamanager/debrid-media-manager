import handler from '@/pages/api/requests/[id]/fulfill';
import { orderedServersForNewJob } from '@/services/debridUploaderServers';
import { getToken } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/realDebrid', () => ({ __esModule: true, getToken: vi.fn() }));
vi.mock('@/services/debridUploaderServers', () => ({
	__esModule: true,
	orderedServersForNewJob: vi.fn(() => ['http://debrid02:3100']),
}));
vi.mock('@/utils/castApiHelpers', () => ({ __esModule: true, generateUserId: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockToken = vi.mocked(getToken);
const mockUserId = vi.mocked(generateUserId);
const mockServers = vi.mocked(orderedServersForNewJob);

const HASH = '1ea32261cd04fc8633c6b30ca3d98213279d689f';

const request = (over: Record<string, unknown> = {}) => ({
	id: 'req-1',
	hash: HASH,
	imdbId: 'tt1234567',
	title: 'Some Release',
	mediaType: 'movie',
	status: 'open',
	requesterId: 'asker',
	fulfillerId: null,
	jobId: null,
	createdAt: new Date('2026-08-27T05:00:00Z'),
	...over,
});

const call = async (over: Record<string, unknown> = {}) => {
	const req = createMockRequest({
		method: 'POST',
		query: { id: 'req-1' },
		headers: { 'x-rd-access-token': 'helper-token' },
		body: { tbKey: 'TB_KEY' },
		...over,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const statusOf = (res: any) => (res.status as any).mock.calls[0][0];
const bodyOf = (res: any) => (res.json as any).mock.calls[0][0];

beforeEach(() => {
	vi.clearAllMocks();
	mockUserId.mockResolvedValue('helper');
	mockServers.mockReturnValue(['http://debrid02:3100']);
	mockRepo.getContentRequest = vi.fn().mockResolvedValue(request());
	mockRepo.claimContentRequest = vi.fn().mockResolvedValue(request({ status: 'claimed' }));
	mockRepo.attachContentRequestJob = vi.fn().mockResolvedValue(undefined);
	mockRepo.releaseContentRequest = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordDebridJobServer = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordTransferMeta = vi.fn().mockResolvedValue(undefined);
	mockRepo.getCastProfile = vi.fn().mockResolvedValue({
		userId: 'asker',
		clientId: 'cid',
		clientSecret: 'secret',
		refreshToken: 'refresh',
	});
	mockToken.mockResolvedValue({ access_token: 'FRESH_RD_TOKEN' } as any);
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ id: 'job-9' }),
	}) as any;
});

describe('POST /api/requests/[id]/fulfill', () => {
	it('submits the job and records it against the request', async () => {
		const res = await call();
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res)).toEqual({ jobId: 'job-9' });
		expect(mockRepo.attachContentRequestJob).toHaveBeenCalledWith(
			'req-1',
			'job-9',
			'http://debrid02:3100'
		);
	});

	// The whole point of the feature: two different people's credentials in one
	// submission.
	it('pairs the requester’s Real-Debrid key with the fulfiller’s TorBox key', async () => {
		await call();
		const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
		expect(body.rd_api_key).toBe('FRESH_RD_TOKEN');
		expect(body.tb_api_key).toBe('TB_KEY');
		expect(body.input).toBe(`magnet:?xt=urn:btih:${HASH}`);
	});

	// A request can sit on the board for days; an access token dies in 24 hours.
	it('mints a fresh token from the requester’s stored OAuth triple', async () => {
		await call();
		expect(mockRepo.getCastProfile).toHaveBeenCalledWith('asker');
		expect(mockToken).toHaveBeenCalledWith('cid', 'secret', 'refresh', true);
	});

	// AllDebrid was withdrawn as a cache source on 2026-09-01 along with debrid01,
	// the only uploader host whose IP AllDebrid permitted. A forwarded AD key can
	// now only come back `NO_SERVER`, which surfaced to the user as their job's
	// failure reason, so the refusal has to happen here instead.
	it('refuses an AllDebrid-only fulfiller rather than forwarding the key', async () => {
		const res = await call({ body: { adKey: 'AD_KEY' } });
		expect(statusOf(res)).toBe(400);
		expect(bodyOf(res).error).toMatch(/TorBox key is required/);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('never forwards an AllDebrid key alongside a TorBox one', async () => {
		await call({ body: { tbKey: 'TB_KEY', adKey: 'AD_KEY' } });
		const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
		expect(body.tb_api_key).toBe('TB_KEY');
		expect(body.ad_api_key).toBeUndefined();
	});

	it('files the transfer under the requester, whose account it lands in', async () => {
		await call();
		expect(mockRepo.recordTransferMeta).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'debrid', jobId: 'job-9', imdbId: 'tt1234567' })
		);
	});
});

describe('refusals', () => {
	it('rejects a caller with no Real-Debrid session', async () => {
		const res = await call({ headers: {} });
		expect(statusOf(res)).toBe(401);
	});

	it('rejects a fulfiller carrying no cache-source key', async () => {
		const res = await call({ body: {} });
		expect(statusOf(res)).toBe(400);
		expect(bodyOf(res).error).toContain('TorBox key is required');
	});

	it('404s an unknown request', async () => {
		mockRepo.getContentRequest = vi.fn().mockResolvedValue(null);
		expect(statusOf(await call())).toBe(404);
	});

	it('refuses self-fulfilment', async () => {
		mockUserId.mockResolvedValue('asker');
		const res = await call();
		expect(statusOf(res)).toBe(400);
		expect(bodyOf(res).error).toContain('both halves');
	});

	it('refuses one already in flight', async () => {
		mockRepo.getContentRequest = vi.fn().mockResolvedValue(request({ status: 'claimed' }));
		expect(statusOf(await call())).toBe(409);
	});

	it('rejects a non-POST', async () => {
		expect(statusOf(await call({ method: 'GET' }))).toBe(405);
	});
});

describe('races and failures', () => {
	// Two fulfillers a second apart is ordinary. The loser must not also submit,
	// or both spend their own TorBox quota on the same release.
	it('stands down when the claim is lost, without submitting anything', async () => {
		mockRepo.claimContentRequest = vi.fn().mockResolvedValue(null);
		const res = await call();
		expect(statusOf(res)).toBe(409);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('hands the request back when the requester has no usable credentials', async () => {
		mockRepo.getCastProfile = vi.fn().mockResolvedValue(null);
		const res = await call();
		expect(statusOf(res)).toBe(409);
		expect(mockRepo.releaseContentRequest).toHaveBeenCalledWith('req-1', expect.any(String));
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('hands the request back when the mint fails', async () => {
		mockToken.mockRejectedValue(new Error('refresh rejected'));
		expect(statusOf(await call())).toBe(409);
		expect(mockRepo.releaseContentRequest).toHaveBeenCalled();
	});

	// A deterministic refusal must not be retried on the next host.
	it('hands back and stops when the uploader refuses', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 422,
			json: async () => ({ error: 'not cached on TorBox' }),
		}) as any;
		mockServers.mockReturnValue(['http://debrid01:3100', 'http://debrid02:3100']);
		const res = await call();
		expect(statusOf(res)).toBe(422);
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(mockRepo.releaseContentRequest).toHaveBeenCalledWith(
			'req-1',
			'not cached on TorBox'
		);
	});

	it('tries the next host when one is unreachable', async () => {
		global.fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ id: 'job-9' }),
			}) as any;
		mockServers.mockReturnValue(['http://debrid01:3100', 'http://debrid02:3100']);
		expect(statusOf(await call())).toBe(200);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it('releases the request when every host is unreachable', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
		const res = await call();
		expect(statusOf(res)).toBe(502);
		expect(mockRepo.releaseContentRequest).toHaveBeenCalledWith(
			'req-1',
			'all uploader hosts unreachable'
		);
	});
});
