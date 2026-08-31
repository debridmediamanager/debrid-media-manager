import handler from '@/pages/api/availability/check2';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const mockValidate = vi.mocked(validateProblemToken);
const validHash = 'b'.repeat(40);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-2',
	solution: 'hash-2',
	hashes: [validHash],
	...overrides,
});

describe('/api/availability/check2', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidate.mockReturnValue(true);
		mockRepository.checkAvailabilityByHashes = vi.fn().mockResolvedValue([{ hash: validHash }]);
	});

	it('rejects non-POST', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('validates auth payload', async () => {
		const body = buildBody();
		delete (body as any).solution;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
	});

	it('rejects invalid tokens', async () => {
		mockValidate.mockReturnValue(false);
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();
		await handler(req, res);
		expect(mockValidate).toHaveBeenCalledWith('key-2', 'hash-2');
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
	});

	it('requires hashes array', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ hashes: null }) });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Hashes must be an array' });
	});

	it('returns empty for no hashes', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ hashes: [] }) });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: [] });
	});

	it('enforces 100 hash limit', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: Array.from({ length: 101 }).map(() => validHash) }),
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Maximum 100 hashes allowed' });
	});

	it('rejects invalid hash format', async () => {
		const badHash = 'bad';
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hashes: [validHash, badHash] }),
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid hash format', hash: badHash });
	});

	it('returns available hashes when validation passes', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();
		await handler(req, res);
		expect(mockRepository.checkAvailabilityByHashes).toHaveBeenCalledWith([validHash]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: [{ hash: validHash }] });
	});

	it('handles repository errors', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockRepository.checkAvailabilityByHashes = vi.fn().mockRejectedValue(new Error('db down'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to check available hashes' });
		consoleSpy.mockRestore();
	});
});
