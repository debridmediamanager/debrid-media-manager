import handler from '@/pages/api/availability/remove';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const mockValidate = vi.mocked(validateProblemToken);
const validHash = 'c'.repeat(40);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-3',
	solution: 'hash-3',
	hash: validHash,
	reason: 'user-request',
	...overrides,
});

describe('/api/availability/remove', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidate.mockReturnValue(true);
		mockRepository.removeAvailability = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('requires auth payload', async () => {
		const body = buildBody();
		delete (body as any).dmmProblemKey;
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
		expect(mockValidate).toHaveBeenCalledWith('key-3', 'hash-3');
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
	});

	it('validates hash format', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ hash: 'bad' }) });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid torrent hash format' });
	});

	it('removes availability when input is valid', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();
		await handler(req, res);
		expect(mockRepository.removeAvailability).toHaveBeenCalledWith(validHash);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ success: true });
	});

	it('returns 500 when removal fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockRepository.removeAvailability = vi.fn().mockRejectedValue(new Error('db failure'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to remove availability' });
		consoleSpy.mockRestore();
	});
});
