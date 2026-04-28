import handler from '@/pages/api/torrents/hash-imdb';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const validHash = 'a'.repeat(40);
const validImdbId = 'tt1234567';
const validItem = { hash: validHash, imdbId: validImdbId };

describe('/api/torrents/hash-imdb', () => {
	beforeEach(() => {
		vi.stubEnv('ZURGTORRENT_SYNC_SECRET', 'test-secret');
		mockRepository.upsertHashImdbBatch = vi.fn().mockResolvedValue({ upserted: 1 });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({
			method: 'GET',
			headers: { 'x-zurg-token': 'test-secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ message: 'Method not allowed' });
	});

	it('returns 500 when ZURGTORRENT_SYNC_SECRET is not set', async () => {
		vi.stubEnv('ZURGTORRENT_SYNC_SECRET', '');
		delete process.env.ZURGTORRENT_SYNC_SECRET;
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'anything' },
			body: [validItem],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ message: 'Server misconfiguration' });
	});

	it('returns 401 when x-zurg-token does not match', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'wrong-secret' },
			body: [validItem],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
	});

	it('returns 400 for null body', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: null,
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			message: 'Expected 1-100 items with valid hash and imdbId fields',
		});
	});

	it('returns 400 for empty array', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 for more than 100 items', async () => {
		const items = Array.from({ length: 101 }, (_, i) => ({
			hash: i.toString(16).padStart(40, '0'),
			imdbId: `tt${(1000000 + i).toString()}`,
		}));
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: items,
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 for invalid hash', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [{ hash: 'too-short', imdbId: validImdbId }],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 for invalid imdbId', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [{ hash: validHash, imdbId: 'nm123' }],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 for imdbId with fewer than 7 digits', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [{ hash: validHash, imdbId: 'tt12345' }],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('accepts a single object instead of array', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: validItem,
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(res.json).toHaveBeenCalledWith({ success: true, results: { upserted: 1 } });
		expect(mockRepository.upsertHashImdbBatch).toHaveBeenCalledWith([validItem]);
	});

	it('accepts Hash field name variant', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: { Hash: validHash, imdbId: validImdbId },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(mockRepository.upsertHashImdbBatch).toHaveBeenCalledWith([
			{ hash: validHash, imdbId: validImdbId },
		]);
	});

	it('accepts ImdbId field name variant', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: { hash: validHash, ImdbId: validImdbId },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(mockRepository.upsertHashImdbBatch).toHaveBeenCalledWith([
			{ hash: validHash, imdbId: validImdbId },
		]);
	});

	it('accepts IMDBID field name variant', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: { hash: validHash, IMDBID: validImdbId },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(mockRepository.upsertHashImdbBatch).toHaveBeenCalledWith([
			{ hash: validHash, imdbId: validImdbId },
		]);
	});

	it('returns 201 with results on success', async () => {
		const results = { upserted: 2 };
		mockRepository.upsertHashImdbBatch = vi.fn().mockResolvedValue(results);
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [validItem, { hash: 'b'.repeat(40), imdbId: 'tt9999999' }],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(res.json).toHaveBeenCalledWith({ success: true, results });
	});

	it('returns 500 on database error', async () => {
		mockRepository.upsertHashImdbBatch = vi.fn().mockRejectedValue(new Error('DB error'));
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-zurg-token': 'test-secret' },
			body: [validItem],
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
	});
});
