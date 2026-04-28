import handler from '@/pages/api/stremio-ad/[userid]/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it } from 'vitest';

describe('/api/stremio-ad/[userid]/manifest.json', () => {
	let req: ReturnType<typeof createMockRequest>;
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		req = createMockRequest({ query: { userid: 'test-user' } });
		res = createMockResponse();
	});

	it('returns 200', async () => {
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('sets CORS header', async () => {
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns correct manifest id and name', async () => {
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.id).toBe('com.debridmediamanager.cast.alldebrid');
		expect(data.name).toBe('DMM Cast for AllDebrid');
	});

	it('includes catalogs', async () => {
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.catalogs).toHaveLength(3);
		expect(data.catalogs[0].id).toBe('ad-casted-movies');
		expect(data.catalogs[1].id).toBe('ad-casted-shows');
		expect(data.catalogs[2].id).toBe('ad-casted-other');
	});

	it('includes resources', async () => {
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.resources).toHaveLength(2);
		expect(data.resources[0].name).toBe('stream');
		expect(data.resources[1].name).toBe('meta');
	});

	it('includes types', async () => {
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.types).toEqual(['movie', 'series', 'other']);
	});

	it('includes behaviorHints', async () => {
		await handler(req, res);
		const data = res._getData() as any;
		expect(data.behaviorHints).toEqual({ adult: false, p2p: false });
	});
});
