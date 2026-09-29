import handler from '@/pages/api/availability/playable';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { MAX_PLAYABLE_HASHES } from '@/utils/availability';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const mockValidate = vi.mocked(validateProblemToken);
const hashA = 'A'.repeat(40);
const hashB = 'b'.repeat(40);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key',
	solution: 'solution',
	service: 'rd',
	hashes: [hashA, hashB],
	...overrides,
});

const call = async (body: unknown, method = 'POST') => {
	const req = createMockRequest({ method, body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
};

describe('/api/availability/playable', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidate.mockReturnValue(true);
		mockRepository.filterPlayableCachedHashes = vi
			.fn()
			.mockResolvedValue(new Set(['a'.repeat(40)]));
		mockRepository.filterPlayableCachedHashesAd = vi.fn().mockResolvedValue(new Set([hashB]));
	});

	it('rejects non-POST', async () => {
		const res = await call(undefined, 'GET');
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('requires a valid problem token', async () => {
		expect((await call(buildBody({ solution: undefined }))).status).toHaveBeenCalledWith(403);
		mockValidate.mockReturnValue(false);
		const res = await call(buildBody());
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(mockRepository.filterPlayableCachedHashes).not.toHaveBeenCalled();
	});

	it('answers Real-Debrid from its own table', async () => {
		const res = await call(buildBody());
		expect(mockRepository.filterPlayableCachedHashes).toHaveBeenCalledWith([hashA, hashB]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ cached: ['a'.repeat(40)] });
	});

	it('answers AllDebrid from its own table', async () => {
		const res = await call(buildBody({ service: 'ad' }));
		expect(mockRepository.filterPlayableCachedHashesAd).toHaveBeenCalledWith([hashA, hashB]);
		expect(mockRepository.filterPlayableCachedHashes).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({ cached: [hashB] });
	});

	it('rejects an unknown service', async () => {
		const res = await call(buildBody({ service: 'tb' }));
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Service must be rd or ad' });
	});

	it(`takes at most ${MAX_PLAYABLE_HASHES} hashes`, async () => {
		const at = Array.from({ length: MAX_PLAYABLE_HASHES }, () => hashA);
		expect((await call(buildBody({ hashes: at }))).status).toHaveBeenCalledWith(200);
		const res = await call(buildBody({ hashes: [...at, hashB] }));
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: `Maximum ${MAX_PLAYABLE_HASHES} hashes allowed`,
		});
	});

	it('rejects a malformed hash, and a non-string one', async () => {
		for (const bad of ['xyz', 42]) {
			const res = await call(buildBody({ hashes: [hashA, bad] }));
			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: 'Invalid hash format', hash: bad });
		}
		expect((await call(buildBody({ hashes: 'x' }))).status).toHaveBeenCalledWith(400);
	});

	it('answers an empty list without asking the database', async () => {
		const res = await call(buildBody({ hashes: [] }));
		expect(res.json).toHaveBeenCalledWith({ cached: [] });
		expect(mockRepository.filterPlayableCachedHashes).not.toHaveBeenCalled();
	});

	it('reports a database failure as a 500', async () => {
		mockRepository.filterPlayableCachedHashes = vi.fn().mockRejectedValue(new Error('down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await call(buildBody());
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
