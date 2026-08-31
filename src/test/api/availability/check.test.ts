import handler from '@/pages/api/availability/check';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const mockValidate = vi.mocked(validateProblemToken);

const validHash = 'a'.repeat(40);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-1',
	solution: 'hash-1',
	imdbId: 'tt1234567',
	hashes: [validHash],
	...overrides,
});

describe('/api/availability/check', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidate.mockReturnValue(true);
		mockRepository.checkAvailability = vi.fn().mockResolvedValue([{ hash: validHash }]);
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('requires authentication payload', async () => {
		const body = buildBody();
		delete (body as any).dmmProblemKey;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
	});

	it('rejects invalid auth tokens', async () => {
		mockValidate.mockReturnValue(false);
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockValidate).toHaveBeenCalledWith('key-1', 'hash-1');
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
	});

	it('validates imdb ids', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ imdbId: 'invalid' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid IMDb ID' });
	});

	it('requires hashes array', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: 'bad' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Hashes must be an array' });
	});

	it('returns empty array for empty hashes', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: [] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: [] });
	});

	it('limits to 100 hashes', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: Array.from({ length: 101 }).map(() => validHash) }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Maximum 100 hashes allowed' });
	});

	it('returns 400 when a hash is invalid', async () => {
		const invalid = 'bad';
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: [validHash, invalid] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid hash format', hash: invalid });
	});

	it('returns repository result when hashes are valid', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.checkAvailability).toHaveBeenCalledWith('tt1234567', [validHash]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: [{ hash: validHash }] });
	});

	it('returns 500 when database check fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockRepository.checkAvailability = vi.fn().mockRejectedValue(new Error('db error'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to check available hashes' });
		consoleSpy.mockRestore();
	});
});
