import handler from '@/pages/api/availability/ad/check';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateTokenWithHash } from '@/utils/token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/token');

const mockRepository = vi.mocked(repository);
const mockValidateTokenWithHash = vi.mocked(validateTokenWithHash);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-1-1234567890',
	solution: 'solution-hash',
	imdbId: 'tt1234567',
	hashes: ['a'.repeat(40), 'b'.repeat(40)],
	...overrides,
});

describe('/api/availability/ad/check', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateTokenWithHash.mockReturnValue(true);
		mockRepository.checkAvailabilityAd = vi
			.fn()
			.mockResolvedValue([{ hash: 'a'.repeat(40), files: [] }]);
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('returns 403 when dmmProblemKey is missing', async () => {
		const body = buildBody();
		delete (body as any).dmmProblemKey;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
	});

	it('returns 403 when solution is missing', async () => {
		const body = buildBody();
		delete (body as any).solution;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
	});

	it('returns 403 when token validation fails', async () => {
		mockValidateTokenWithHash.mockReturnValue(false);
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
	});

	it('returns 400 for missing imdbId', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ imdbId: '' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid IMDb ID' });
	});

	it('returns 400 for invalid imdbId format', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ imdbId: 'nm9999999' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid IMDb ID' });
	});

	it('returns 400 when hashes is not an array', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: 'not-an-array' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Hashes must be an array' });
	});

	it('returns 200 with empty array for empty hashes', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: [] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: [] });
		expect(mockRepository.checkAvailabilityAd).not.toHaveBeenCalled();
	});

	it('returns 400 when more than 100 hashes provided', async () => {
		const hashes = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(40, '0'));
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Maximum 100 hashes allowed' });
	});

	it('returns 400 for invalid hash format', async () => {
		const invalidHash = 'xyz-not-valid';
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: ['a'.repeat(40), invalidHash] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid hash format',
			hash: invalidHash,
		});
	});

	it('returns available hashes on success', async () => {
		const available = [{ hash: 'a'.repeat(40), files: [{ n: 'f.mkv', s: 100, l: 'link' }] }];
		mockRepository.checkAvailabilityAd = vi.fn().mockResolvedValue(available);
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available });
		expect(mockRepository.checkAvailabilityAd).toHaveBeenCalledWith('tt1234567', [
			'a'.repeat(40),
			'b'.repeat(40),
		]);
	});

	it('returns 500 on database error', async () => {
		mockRepository.checkAvailabilityAd = vi.fn().mockRejectedValue(new Error('DB error'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to check AllDebrid availability',
		});
	});
});
