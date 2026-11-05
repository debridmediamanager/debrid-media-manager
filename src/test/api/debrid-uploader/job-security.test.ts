import handler from '@/pages/api/debrid-uploader/jobs/[id]';
import { getCurrentUser } from '@/services/realDebrid';
import { registerCompletedDebridJob } from '@/services/transferRegistration';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/realDebrid', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/services/transferRegistration', () => ({ registerCompletedDebridJob: vi.fn() }));
vi.mock('@/services/debridUploaderServers', () => ({
	resolveJobServer: vi.fn(async () => 'http://uploader:3100'),
}));

const user = {
	id: 123,
	username: 'owner',
	email: 'owner@example.invalid',
	points: 0,
	locale: 'en',
	avatar: '',
	type: 'premium',
	premium: 1,
	expiration: '',
};
const job = {
	id: 'job-1',
	status: 'uploading',
	info_hash: 'b'.repeat(40),
	rd_user_id: 'rd:123',
	tb_user_id: 'tb:456',
	rd_torrent_id: 'PRIVATE-TORRENT',
	webseed_url: 'http://internal/secret',
	torrent_path: '/private/torrent',
	future_secret: 'must-not-leak',
	queue: { position: 1, waiting: 2, owner: 'private' },
};
const call = async (method: 'GET' | 'DELETE', key?: string) => {
	const req = createMockRequest({
		method,
		query: { id: job.id },
		headers: key ? { 'x-rd-api-key': key } : {},
	});
	const res = createMockResponse();
	await handler(req, res);
	return res;
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getCurrentUser).mockResolvedValue(user);
	global.fetch = vi.fn(
		async (_url, init) =>
			new Response(JSON.stringify(init?.method === 'DELETE' ? { ok: true } : { ...job }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
	);
});

describe('debrid uploader job security', () => {
	it('keeps public cross-user polling but exposes only public progress', async () => {
		const res = await call('GET');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			id: job.id,
			status: job.status,
			info_hash: job.info_hash,
			queue: { position: 1, waiting: 2 },
		});
	});
	it('refuses cancellation without a credential before contacting the uploader', async () => {
		const res = await call('DELETE');
		expect(res._getStatusCode()).toBe(401);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('refuses cancellation by a different authenticated account', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ ...user, id: 999 });
		const res = await call('DELETE', 'other-key');
		expect(res._getStatusCode()).toBe(403);
		expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
			false
		);
	});
	it('fails closed when the credential cannot be verified', async () => {
		vi.mocked(getCurrentUser).mockRejectedValue(new Error('provider refused'));
		const res = await call('DELETE', 'bad-key');
		expect(res._getStatusCode()).toBe(401);
		expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
			false
		);
	});
	it('allows the verified destination owner to cancel after reading ownership', async () => {
		const res = await call('DELETE', 'owner-key');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ ok: true });
		expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.method)).toEqual([
			'GET',
			'DELETE',
		]);
	});
	it('fails closed for legacy jobs with no resolved owner', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ ...job, rd_user_id: null }), { status: 200 })
			);
		const res = await call('DELETE', 'owner-key');
		expect(res._getStatusCode()).toBe(403);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('debrid uploader ownership boundaries', () => {
	it.each(['torbox', 'premiumize'])(
		'does not let the RD source cancel a %s destination',
		async (destination) => {
			global.fetch = vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ ...job, destination }), { status: 200 })
				);
			const res = await call('DELETE', 'owner-key');
			expect(res._getStatusCode()).toBe(403);
			expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
				false
			);
		}
	);
	it('returns registered completion progress without exposing the destination account', async () => {
		const completed = {
			...job,
			status: 'completed',
			input: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
			imdb_id: 'tt1234567',
			completed_at: '2026-01-01T00:00:00Z',
		};
		global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(completed)));
		vi.mocked(registerCompletedDebridJob).mockResolvedValue(true);
		const res = await call('GET');
		expect(res._getData()).toMatchObject({ status: 'completed', dmm_registered: true });
		expect(res._getData()).not.toHaveProperty('rd_user_id');
	});
});
