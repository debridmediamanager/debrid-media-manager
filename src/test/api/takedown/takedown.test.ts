import adminHandler from '@/pages/api/takedown/admin';
import blocklistHandler from '@/pages/api/takedown/blocklist';
import submitHandler from '@/pages/api/takedown/index';
import { TakedownService } from '@/services/database/takedown';
import {
	getBlocklist,
	resetBlocklistForTests,
	setBlocklistForTests,
} from '@/services/takedown/blocklist';
import { deleteHashlistPages } from '@/services/takedown/hashlists';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('@/services/takedown/hashlists', () => ({ deleteHashlistPages: vi.fn() }));

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const TOKEN = 'test-admin-token';

const call = async (handler: any, init: Parameters<typeof createMockRequest>[0]) => {
	const req = createMockRequest(init);
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const validNotice = (over: Record<string, unknown> = {}) => ({
	claimantName: 'Rights Holder',
	claimantEmail: 'legal@example.com',
	work: 'Big Buck Bunny (2008)',
	reason: 'We own the film and did not license it.',
	locations: `magnet:?xt=urn:btih:${HASH}&dn=Big.Buck.Bunny`,
	releaseNames: '',
	goodFaith: true,
	accurate: true,
	...over,
});

afterEach(() => vi.restoreAllMocks());

describe('POST /api/takedown', () => {
	let create: MockInstance<TakedownService['createNotice']>;
	beforeEach(() => {
		create = vi.spyOn(TakedownService.prototype, 'createNotice').mockResolvedValue('notice-1');
	});

	it('files a notice as pending and blocks nothing yet', async () => {
		const res = await call(submitHandler, { method: 'POST', body: validNotice() });
		expect(res._getStatusCode()).toBe(201);
		expect(res._getData()).toMatchObject({ id: 'notice-1', hashes: 1 });
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ hashes: [HASH], releases: [], hashlistIds: [] })
		);
		expect((await getBlocklist()).hashes.size).toBe(0);
	});

	it('refuses a notice without both statements', async () => {
		const res = await call(submitHandler, {
			method: 'POST',
			body: validNotice({ accurate: false }),
		});
		expect(res._getStatusCode()).toBe(400);
		expect(create).not.toHaveBeenCalled();
	});

	it('refuses a notice that names nothing it can block', async () => {
		const res = await call(submitHandler, {
			method: 'POST',
			body: validNotice({ locations: 'please remove the bunny film' }),
		});
		expect(res._getStatusCode()).toBe(400);
		expect(create).not.toHaveBeenCalled();
	});

	it('refuses a bad email address', async () => {
		const res = await call(submitHandler, {
			method: 'POST',
			body: validNotice({ claimantEmail: 'nope' }),
		});
		expect(res._getStatusCode()).toBe(400);
	});
});

describe('GET /api/takedown/blocklist', () => {
	it('serves the contract the uploaders poll, with an ETag', async () => {
		setBlocklistForTests([HASH], ['big.buck.bunny.2008']);
		const res = await call(blocklistHandler, { method: 'GET' });
		expect(res._getStatusCode()).toBe(200);
		const body = res._getData() as any;
		expect(body).toEqual({
			version: expect.any(String),
			hashes: [HASH],
			releases: ['big.buck.bunny.2008'],
		});
		expect(res._getHeaders()['ETag']).toBe(`"${body.version}"`);

		const again = await call(blocklistHandler, {
			method: 'GET',
			headers: { 'if-none-match': `"${body.version}"` },
		});
		expect(again._getStatusCode()).toBe(304);
	});

	// An empty 200 would make every consumer drop its last good copy.
	it('answers 503 rather than an empty list when it never loaded', async () => {
		resetBlocklistForTests();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(TakedownService.prototype, 'getBlocked').mockRejectedValue(new Error('db down'));
		const res = await call(blocklistHandler, { method: 'GET' });
		expect(res._getStatusCode()).toBe(503);
	});
});

describe('/api/takedown/admin', () => {
	const auth = { authorization: `Bearer ${TOKEN}` };
	beforeEach(() => {
		process.env.TAKEDOWN_ADMIN_TOKEN = TOKEN;
		vi.spyOn(TakedownService.prototype, 'getNotice').mockResolvedValue({ id: 'n1' } as any);
	});
	afterEach(() => {
		delete process.env.TAKEDOWN_ADMIN_TOKEN;
	});

	it('refuses a wrong or missing token', async () => {
		expect(
			(
				await call(adminHandler, {
					method: 'GET',
					headers: { authorization: 'Bearer nope' },
				})
			)._getStatusCode()
		).toBe(401);
		expect((await call(adminHandler, { method: 'GET' }))._getStatusCode()).toBe(401);
	});

	it('refuses everything when no token is configured', async () => {
		delete process.env.TAKEDOWN_ADMIN_TOKEN;
		expect((await call(adminHandler, { method: 'GET', headers: auth }))._getStatusCode()).toBe(
			401
		);
	});

	it('approves, deletes the cited share pages, and reports a GitHub failure without undoing', async () => {
		const approve = vi
			.spyOn(TakedownService.prototype, 'approveNotice')
			.mockResolvedValue({ id: 'n1', hashlistIds: ['h1'] } as any);
		vi.mocked(deleteHashlistPages).mockRejectedValueOnce(new Error('GitHub down'));
		const res = await call(adminHandler, {
			method: 'POST',
			headers: auth,
			body: { id: 'n1', action: 'approve', note: 'ok' },
		});
		expect(res._getStatusCode()).toBe(200);
		expect(approve).toHaveBeenCalledWith('n1', 'ok');
		expect((res._getData() as any).hashlists).toEqual({ error: 'GitHub down' });
	});

	it('rejects', async () => {
		const reject = vi
			.spyOn(TakedownService.prototype, 'rejectNotice')
			.mockResolvedValue({ id: 'n1' } as any);
		const res = await call(adminHandler, {
			method: 'POST',
			headers: auth,
			body: { id: 'n1', action: 'reject' },
		});
		expect(res._getStatusCode()).toBe(200);
		expect(reject).toHaveBeenCalledWith('n1', null);
	});
});
