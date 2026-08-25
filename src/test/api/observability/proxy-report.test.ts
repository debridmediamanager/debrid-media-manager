import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorderMocks = vi.hoisted(() => ({
	recordProxiedOperation: vi.fn(),
}));

vi.mock('@/lib/observability/recordProxiedOperation', () => recorderMocks);

import handler from '@/pages/api/observability/proxy-report';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const originalEnv = { ...process.env };
const SECRET = 'shhh-worker-secret';

function post(body: unknown, secret?: string) {
	return createMockRequest({
		method: 'POST',
		body,
		headers: secret === undefined ? {} : { 'x-anticors-secret': secret },
	});
}

const tbEvent = {
	host: 'api.torbox.app',
	method: 'GET',
	path: '/v1/api/user/me',
	status: 429,
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv, ANTICORS_REPORT_SECRET: SECRET };
});

describe('API /api/observability/proxy-report', () => {
	it('rejects non-POST requests', () => {
		const res = createMockResponse();
		handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
	});

	// cron.ts and aggregate.ts skip their check when the env var is missing, and
	// both are running unauthenticated in production because of it. This one
	// writes the numbers behind a public status page, so it stays shut instead.
	it('fails closed when the secret is not configured', () => {
		delete process.env.ANTICORS_REPORT_SECRET;
		const res = createMockResponse();

		handler(post({ events: [tbEvent] }, SECRET), res);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(recorderMocks.recordProxiedOperation).not.toHaveBeenCalled();
	});

	it('rejects a wrong secret', () => {
		const res = createMockResponse();
		handler(post({ events: [tbEvent] }, 'nope'), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(recorderMocks.recordProxiedOperation).not.toHaveBeenCalled();
	});

	it('rejects a missing secret', () => {
		const res = createMockResponse();
		handler(post({ events: [tbEvent] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(recorderMocks.recordProxiedOperation).not.toHaveBeenCalled();
	});

	it('records an authorised batch', () => {
		const res = createMockResponse();
		handler(post({ events: [tbEvent] }, SECRET), res);

		expect(recorderMocks.recordProxiedOperation).toHaveBeenCalledWith(
			'api.torbox.app',
			'GET',
			'/v1/api/user/me',
			429
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ accepted: 1, received: 1 });
	});

	it('rejects a body with no events array', () => {
		const res = createMockResponse();
		handler(post({}, SECRET), res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('rejects an oversized batch', () => {
		const res = createMockResponse();
		handler(post({ events: new Array(201).fill(tbEvent) }, SECRET), res);

		expect(res.status).toHaveBeenCalledWith(413);
		expect(recorderMocks.recordProxiedOperation).not.toHaveBeenCalled();
	});

	// requestdl carries the raw API key in `?token=`. A path that still has a
	// query string means the Worker sent more than it should have, so drop it
	// rather than write it anywhere.
	it('drops an event whose path carries a query string', () => {
		const res = createMockResponse();
		handler(
			post(
				{ events: [{ ...tbEvent, path: '/v1/api/torrents/requestdl?token=SECRETKEY' }] },
				SECRET
			),
			res
		);

		expect(recorderMocks.recordProxiedOperation).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({ accepted: 0, received: 1 });
	});

	it('drops malformed entries but keeps the rest of the batch', () => {
		const res = createMockResponse();
		handler(
			post(
				{
					events: [
						{ ...tbEvent, status: 'boom' },
						{ ...tbEvent, status: 4290 },
						null,
						tbEvent,
					],
				},
				SECRET
			),
			res
		);

		expect(recorderMocks.recordProxiedOperation).toHaveBeenCalledTimes(1);
		expect(res.json).toHaveBeenCalledWith({ accepted: 1, received: 4 });
	});

	it('passes a Real-Debrid event through with its own host', () => {
		const res = createMockResponse();
		handler(
			post(
				{
					events: [
						{
							host: 'app.real-debrid.com',
							method: 'GET',
							path: '/rest/1.0/user',
							status: 200,
						},
					],
				},
				SECRET
			),
			res
		);

		expect(recorderMocks.recordProxiedOperation).toHaveBeenCalledWith(
			'app.real-debrid.com',
			'GET',
			'/rest/1.0/user',
			200
		);
	});
});
