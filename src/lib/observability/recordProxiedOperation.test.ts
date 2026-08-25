import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	recordRdOperationEvent: vi.fn(),
	recordTorBoxOperationEvent: vi.fn(),
}));

vi.mock('./rdOperationalStats', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rdOperationalStats')>()),
	recordRdOperationEvent: mocks.recordRdOperationEvent,
}));

vi.mock('./torboxOperationalStats', async (importOriginal) => ({
	...(await importOriginal<typeof import('./torboxOperationalStats')>()),
	recordTorBoxOperationEvent: mocks.recordTorBoxOperationEvent,
}));

import { recordProxiedOperation } from './recordProxiedOperation';

beforeEach(() => vi.clearAllMocks());

describe('recordProxiedOperation', () => {
	it('routes a Real-Debrid path to the RD recorder', () => {
		recordProxiedOperation('app.real-debrid.com', 'GET', '/rest/1.0/user', 200);

		expect(mocks.recordRdOperationEvent).toHaveBeenCalledWith('GET /user', 200);
		expect(mocks.recordTorBoxOperationEvent).not.toHaveBeenCalled();
	});

	it('routes a TorBox path to the TorBox recorder', () => {
		recordProxiedOperation('api.torbox.app', 'GET', '/v1/api/user/me', 429);

		expect(mocks.recordTorBoxOperationEvent).toHaveBeenCalledWith('GET /user/me', 429);
		expect(mocks.recordRdOperationEvent).not.toHaveBeenCalled();
	});

	it('ignores a host it does not chart', () => {
		recordProxiedOperation('api.alldebrid.com', 'GET', '/v4.1/user', 200);

		expect(mocks.recordRdOperationEvent).not.toHaveBeenCalled();
		expect(mocks.recordTorBoxOperationEvent).not.toHaveBeenCalled();
	});

	it('ignores an endpoint that is not monitored', () => {
		recordProxiedOperation('api.torbox.app', 'GET', '/v1/api/stats', 200);

		expect(mocks.recordTorBoxOperationEvent).not.toHaveBeenCalled();
	});
});
