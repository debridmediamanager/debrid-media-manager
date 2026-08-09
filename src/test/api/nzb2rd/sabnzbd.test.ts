import handler from '@/pages/api/sabnzbd/[[...path]]';
import { SAB_PREFIX } from '@/services/sabnzbdProxy';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { NextApiRequest } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, getNzb2rdUrl: () => 'http://nzb2rd.test:3200' };
});

const upstream = (body: unknown, status = 200) =>
	vi.fn().mockResolvedValue({
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	});

/** A request whose body is streamed, as it is with `bodyParser: false`. */
function postRequest(url: string, chunks: Buffer[]): NextApiRequest {
	const req = createMockRequest({
		method: 'POST',
		url,
		headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
	});
	(req as unknown as AsyncIterable<Buffer>)[Symbol.asyncIterator] = async function* () {
		for (const chunk of chunks) yield chunk;
	};
	return req;
}

const get = async (url: string) => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', url }) as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = upstream({ version: '4.5.1' }) as any;
});

describe('SABnzbd proxy', () => {
	it('forwards a poll to nzb2rd with the mount root and query intact', async () => {
		global.fetch = upstream({ queue: { slots: [] } }) as any;

		const res = await get(
			`${SAB_PREFIX}/mnt/zurg/__all__/api?mode=queue&apikey=RDKEY&limit=60`
		);

		expect(global.fetch).toHaveBeenCalledWith(
			'http://nzb2rd.test:3200/mnt/zurg/__all__/api?mode=queue&apikey=RDKEY&limit=60',
			expect.objectContaining({ method: 'GET' })
		);
		expect(res._getStatusCode()).toBe(200);
		expect(JSON.parse(res._getData() as string)).toEqual({ queue: { slots: [] } });
	});

	it('passes the upstream status through', async () => {
		global.fetch = upstream({ status: false, error: 'API Key Incorrect' }, 200) as any;
		const res = await get(`${SAB_PREFIX}/api?mode=queue`);
		expect(res._getStatusCode()).toBe(200);
		expect(JSON.parse(res._getData() as string)).toEqual({
			status: false,
			error: 'API Key Incorrect',
		});
	});

	it('streams an addfile body to nzb2rd byte-for-byte', async () => {
		global.fetch = upstream({ status: true, nzo_ids: ['job-1'] }) as any;
		const chunks = [Buffer.from('--xyz\r\nnzb '), Buffer.from('payload\r\n--xyz--')];

		const res = createMockResponse();
		await handler(
			postRequest(`${SAB_PREFIX}/api?mode=addfile&apikey=RDKEY&cat=movies`, chunks) as any,
			res as any
		);

		const [, init] = vi.mocked(global.fetch).mock.calls[0];
		expect(Buffer.from(init!.body as Uint8Array).toString()).toBe(
			'--xyz\r\nnzb payload\r\n--xyz--'
		);
		expect((init!.headers as Record<string, string>)['Content-Type']).toBe(
			'multipart/form-data; boundary=xyz'
		);
		expect(JSON.parse(res._getData() as string)).toEqual({
			status: true,
			nzo_ids: ['job-1'],
		});
	});

	it('refuses an NZB over the size cap instead of buffering it', async () => {
		const huge = [Buffer.alloc(33 * 1024 * 1024)];
		const res = createMockResponse();
		await handler(postRequest(`${SAB_PREFIX}/api?mode=addfile`, huge) as any, res as any);

		expect(res._getStatusCode()).toBe(413);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	// nzb2rd's management API is unauthenticated — `GET /jobs` lists every user's
	// jobs and `DELETE /jobs/:id` removes any of them. Proxying anything but
	// `/api` would republish it to the internet.
	it.each([
		[`${SAB_PREFIX}/jobs`],
		[`${SAB_PREFIX}/jobs/abc-123`],
		[`${SAB_PREFIX}/health`],
		[`${SAB_PREFIX}/x/../../jobs/api`],
		[`${SAB_PREFIX}/webseed/job-1/dir/api`],
	])('never proxies %s', async (url) => {
		const res = await get(url);
		expect(res._getStatusCode()).toBe(404);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('rejects methods SABnzbd never uses', async () => {
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'DELETE', url: `${SAB_PREFIX}/api?mode=queue` }) as any,
			res as any
		);
		expect(res._getStatusCode()).toBe(405);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('reports an unreachable nzb2rd in SABnzbd’s envelope, so *arr shows it', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT')) as any;
		const res = await get(`${SAB_PREFIX}/api?mode=version&apikey=RDKEY`);

		// 200 deliberately: *arr reads `error` from the body, and an HTML 502 page
		// surfaces to the user as an unreadable transport fault instead.
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ status: false, error: 'nzb2rd is unreachable' });
	});

	it('never writes the Real-Debrid key to the log', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await get(`${SAB_PREFIX}/api?mode=get_config&apikey=SECRETRDKEY`);

		const written = log.mock.calls.flat().join(' ');
		expect(written).not.toContain('SECRETRDKEY');
		expect(written).toContain('mode=get_config');
		log.mockRestore();
	});
});
