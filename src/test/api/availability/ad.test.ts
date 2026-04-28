import handler from '@/pages/api/availability/ad';
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
	hash: 'a'.repeat(40),
	imdbId: 'tt1234567',
	filename: 'movie.mkv',
	size: 5000000,
	status: 'Ready',
	statusCode: 4,
	completionDate: 1700000000,
	files: [{ n: 'movie.mkv', s: 5000000, l: 'https://example.com/dl' }],
	...overrides,
});

describe('/api/availability/ad', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateTokenWithHash.mockReturnValue(true);
		mockRepository.upsertAvailabilityAd = vi.fn().mockResolvedValue(undefined);
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

	it('returns 400 for missing hash', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ hash: '' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('returns 400 for missing filename', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ filename: '' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('returns 400 for missing imdbId', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ imdbId: '' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('returns 400 for invalid hash format', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ hash: 'not-a-hash' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid torrent hash format' });
	});

	it('returns 400 for invalid imdbId format', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ imdbId: 'nm1234567' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid IMDb ID format' });
	});

	it('returns 400 for wrong statusCode', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ statusCode: 3 }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid statusCode. Only instant torrents (statusCode 4) allowed',
		});
	});

	it('returns 400 for wrong status', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ status: 'Pending' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid status. Must be "Ready"' });
	});

	it('returns 400 for size of zero', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ size: 0 }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Size must be greater than 0' });
	});

	it('returns 400 for negative size', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ size: -100 }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Size must be greater than 0' });
	});

	it('returns 400 when completionDate is null', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ completionDate: null }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid completionDate. Must be a valid Unix timestamp (number)',
		});
	});

	it('returns 400 when completionDate is undefined', async () => {
		const body = buildBody();
		delete (body as any).completionDate;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid completionDate. Must be a valid Unix timestamp (number)',
		});
	});

	it('returns 400 when completionDate is negative', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ completionDate: -1 }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid completionDate. Must be a valid Unix timestamp (number)',
		});
	});

	it('returns 400 when completionDate is NaN', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ completionDate: NaN }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid completionDate. Must be a valid Unix timestamp (number)',
		});
	});

	it('returns 400 when completionDate is a string', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ completionDate: '2024-01-01' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid completionDate. Must be a valid Unix timestamp (number)',
		});
	});

	it('returns 400 when files is not an array', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ files: 'not-array' }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Files must be a non-empty array' });
	});

	it('returns 400 when files is an empty array', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody({ files: [] }) });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Files must be a non-empty array' });
	});

	it('returns 400 when file is missing n field', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ files: [{ s: 100, l: 'link' }] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid file structure. Each file must have n (name), s (size), and l (link)',
		});
	});

	it('returns 400 when file is missing s field', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ files: [{ n: 'file.mkv', l: 'link' }] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid file structure. Each file must have n (name), s (size), and l (link)',
		});
	});

	it('returns 400 when file is missing l field', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ files: [{ n: 'file.mkv', s: 100 }] }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid file structure. Each file must have n (name), s (size), and l (link)',
		});
	});

	it('returns 200 with success:true on valid request', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ success: true });
		expect(mockRepository.upsertAvailabilityAd).toHaveBeenCalledOnce();
	});

	it('lowercases hash before upserting', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hash: 'A'.repeat(40) }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.upsertAvailabilityAd).toHaveBeenCalledWith(
			expect.objectContaining({ hash: 'a'.repeat(40) })
		);
	});

	it('returns 500 on database error', async () => {
		mockRepository.upsertAvailabilityAd = vi.fn().mockRejectedValue(new Error('DB error'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to save AllDebrid availability' });
	});
});
