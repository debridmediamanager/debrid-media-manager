import { identifyHandler } from '@/pages/api/library/identify';
import handler from '@/pages/api/metadata/identify';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/pages/api/library/identify', () => ({ identifyHandler: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const body = { items: [{ filename: 'Dune.2021.1080p.mkv', hash: 'a'.repeat(40) }] };
const call = async (authorization = 'Bearer s3cret') => {
	const req = createMockRequest({ method: 'POST', body, headers: { authorization } });
	const res = createMockResponse();
	await handler(req, res);
	return { req, res };
};

describe('/api/metadata/identify', () => {
	const original = process.env.METADATA_API_SECRET;
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.METADATA_API_SECRET = 's3cret';
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});
	afterEach(() => {
		if (original === undefined) delete process.env.METADATA_API_SECRET;
		else process.env.METADATA_API_SECRET = original;
	});

	it('refuses a caller without the secret', async () => {
		const { res } = await call('Bearer wrong');
		expect(res.status).toHaveBeenCalledWith(401);
		expect(identifyHandler).not.toHaveBeenCalled();
	});

	it('holds every caller to one shared budget', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValue(false);
		const { res } = await call();
		expect(checkRateLimitFor).toHaveBeenCalledWith(
			'internal',
			expect.objectContaining({ name: 'metadataIdentify' }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(429);
		expect(identifyHandler).not.toHaveBeenCalled();
	});

	it("answers with the library page's identification", async () => {
		const { req, res } = await call();
		expect(identifyHandler).toHaveBeenCalledWith(req, res);
	});
});
