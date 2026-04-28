import handler from '@/pages/api/stremio-ad/[userid]/no-catalog/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it } from 'vitest';

describe('/api/stremio-ad/[userid]/no-catalog/manifest.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		res = createMockResponse();
	});

	it('sets CORS header', async () => {
		const req = createMockRequest({ query: { userid: 'test-user' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns production name when host includes debridmediamanager.com', async () => {
		const req = createMockRequest({
			query: { userid: 'test-user' },
			headers: { host: 'debridmediamanager.com' },
		});
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.name).toBe('DMM Cast for AllDebrid');
	});

	it('returns dev name when host does not include debridmediamanager.com', async () => {
		const req = createMockRequest({
			query: { userid: 'test-user' },
			headers: { host: 'localhost:3000' },
		});
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.name).toBe('[LOCAL] DMM Cast for AllDebrid (No Library)');
	});

	it('returns empty catalogs array', async () => {
		const req = createMockRequest({
			query: { userid: 'test-user' },
			headers: { host: 'debridmediamanager.com' },
		});
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.catalogs).toEqual([]);
	});

	it('returns correct manifest id', async () => {
		const req = createMockRequest({
			query: { userid: 'test-user' },
			headers: { host: 'debridmediamanager.com' },
		});
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.id).toBe('com.debridmediamanager.cast.alldebrid');
	});
});
