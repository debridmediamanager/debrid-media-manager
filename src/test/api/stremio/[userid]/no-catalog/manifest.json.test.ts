import handler from '@/pages/api/stremio/[userid]/no-catalog/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { describe, expect, it } from 'vitest';

describe('/api/stremio/[userid]/no-catalog/manifest.json', () => {
	it('responds with empty catalogs array', async () => {
		const req = createMockRequest({
			query: { userid: 'any' },
			headers: { host: 'debridmediamanager.com' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = res._getData() as Record<string, unknown>;
		expect(payload).toMatchObject({
			id: 'com.debridmediamanager.cast',
			name: 'DMM Cast for Real-Debrid',
			catalogs: [],
		});
		expect(payload.types).toEqual(['movie', 'series']);
		expect(payload.resources).toEqual([
			{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
		]);
	});

	it('sets CORS header', async () => {
		const req = createMockRequest({ query: { userid: 'any' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});
});
