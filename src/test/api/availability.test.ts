import handler from '@/pages/api/availability';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const mockValidateProblemToken = vi.mocked(validateProblemToken);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-1-1234567890',
	solution: 'solution-hash',
	filename: 'file.mkv',
	original_filename: 'original.mkv',
	hash: 'a'.repeat(40),
	bytes: 1000,
	original_bytes: 2000,
	host: 'real-debrid.com',
	progress: 100,
	status: 'downloaded',
	files: [
		{ id: 1, path: 'movie/file.mkv', bytes: 1000, selected: 1 },
		{ id: 2, path: 'extras/sample.txt', bytes: 10, selected: 0 },
	],
	links: ['https://real-debrid.com/download/123'],
	ended: '2024-01-01T00:00:00Z',
	imdbId: 'tt1234567',
	...overrides,
});

describe('/api/availability', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateProblemToken.mockReturnValue(true);
		mockRepository.upsertAvailability = vi.fn().mockResolvedValue(undefined);
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
		mockValidateProblemToken.mockReturnValue(false);
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockValidateProblemToken).toHaveBeenCalledWith('key-1-1234567890', 'solution-hash');
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
	});

	it('validates required fields', async () => {
		const body = buildBody();
		delete (body as any).hash;
		const req = createMockRequest({ method: 'POST', body });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('validates host', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ host: 'other-host' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid host. Only real-debrid.com is allowed',
		});
	});

	it('validates progress', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ progress: 50 }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid progress. Must be 100' });
	});

	it('validates hash format', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ hash: 'invalid-hash' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid torrent hash format' });
	});

	it('validates positive byte counts', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ bytes: 0 }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Bytes must be greater than 0' });
	});

	it('validates files and links shape', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({ files: 'bad', links: 'bad' }),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Files and links must be arrays' });
	});

	it('rejects when no selected files remain', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({
				files: [
					{ id: 1, path: 'movie/file.mkv', bytes: 1000, selected: 0 },
					{ id: 2, path: 'extras/sample.txt', bytes: 10, selected: 0 },
				],
			}),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Torrent is fully expired' });
	});

	it('rejects when links do not match selected files', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody({
				files: [
					{ id: 1, path: 'movie/file.mkv', bytes: 1000, selected: 1 },
					{ id: 2, path: 'extras/sample.txt', bytes: 10, selected: 1 },
				],
			}),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Torrent is partially expired' });
	});

	it('persists selected files with matching links', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.upsertAvailability).toHaveBeenCalledWith({
			hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			imdbId: 'tt1234567',
			filename: 'file.mkv',
			originalFilename: 'original.mkv',
			bytes: 1000,
			originalBytes: 2000,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			ended: '2024-01-01T00:00:00Z',
			selectedFiles: [{ id: 1, path: 'movie/file.mkv', bytes: 1000, selected: 1 }],
			links: ['https://real-debrid.com/download/123'],
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ success: true });
	});

	it('returns 500 when persistence fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockRepository.upsertAvailability = vi.fn().mockRejectedValue(new Error('db down'));
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to save available torrent' });
		consoleSpy.mockRestore();
	});
});
