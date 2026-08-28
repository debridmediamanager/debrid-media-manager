import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryMock = vi.hoisted(() => ({
	repository: { recordTorBoxCdnSamples: vi.fn() },
}));

vi.mock('@/services/repository', () => repositoryMock);

import handler, { parseSamples } from '@/pages/api/observability/torbox-cdn';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
	repositoryMock.repository.recordTorBoxCdnSamples.mockResolvedValue(1);
});

describe('parseSamples', () => {
	it('keeps a well formed run', () => {
		expect(
			parseSamples({
				results: [
					{ region: 'ceur', ok: true, latencyMs: 42 },
					{ region: 'enam', ok: false, latencyMs: null },
				],
			})
		).toEqual([
			{ region: 'ceur', ok: true, latencyMs: 42 },
			{ region: 'enam', ok: false, latencyMs: null },
		]);
	});

	it('lowercases the region so casing cannot split a bucket', () => {
		expect(parseSamples({ results: [{ region: 'CEUR', ok: true, latencyMs: 1 }] })).toEqual([
			{ region: 'ceur', ok: true, latencyMs: 1 },
		]);
	});

	// One vote per region: a payload repeating a region must not outweigh one
	// that does not.
	it('keeps only the first entry for a repeated region', () => {
		expect(
			parseSamples({
				results: [
					{ region: 'ceur', ok: true, latencyMs: 10 },
					{ region: 'ceur', ok: false, latencyMs: null },
				],
			})
		).toEqual([{ region: 'ceur', ok: true, latencyMs: 10 }]);
	});

	it('drops entries that are not shaped like a probe result', () => {
		expect(
			parseSamples({
				results: [
					null,
					'nope',
					{ ok: true },
					{ region: 'ceur' },
					{ region: 'ceur', ok: 'yes' },
					{ region: 'not a region code!', ok: true },
					{ region: '', ok: true },
				],
			})
		).toEqual([]);
	});

	// TorBox adds and retires regions, so the check is on shape rather than an
	// allowlist - a region shipped tomorrow is recorded, not silently dropped.
	it('accepts a region code TorBox has not shipped yet', () => {
		expect(parseSamples({ results: [{ region: 'mars', ok: true, latencyMs: 5 }] })).toEqual([
			{ region: 'mars', ok: true, latencyMs: 5 },
		]);
	});

	it('discards a latency that is negative, absurd or not a number', () => {
		const samples = parseSamples({
			results: [
				{ region: 'aaa', ok: true, latencyMs: -1 },
				{ region: 'bbb', ok: true, latencyMs: 99_999_999 },
				{ region: 'ccc', ok: true, latencyMs: 'fast' },
				{ region: 'ddd', ok: true, latencyMs: Number.POSITIVE_INFINITY },
			],
		});

		expect(samples).toHaveLength(4);
		expect(samples.every((s) => s.latencyMs === null)).toBe(true);
	});

	it('caps how many regions one submission can carry', () => {
		const results = Array.from({ length: 100 }, (_, i) => ({
			region: `r${i.toString().padStart(3, '0')}`,
			ok: true,
			latencyMs: 1,
		}));

		expect(parseSamples({ results })).toHaveLength(32);
	});

	it('returns nothing for a body that is not a submission at all', () => {
		expect(parseSamples(null)).toEqual([]);
		expect(parseSamples({})).toEqual([]);
		expect(parseSamples({ results: 'nope' })).toEqual([]);
	});
});

describe('API /api/observability/torbox-cdn', () => {
	it('rejects non-POST requests', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
	});

	it('records a valid run and reports how many regions landed', async () => {
		repositoryMock.repository.recordTorBoxCdnSamples.mockResolvedValue(2);
		const res = createMockResponse();

		await handler(
			createMockRequest({
				method: 'POST',
				body: {
					results: [
						{ region: 'ceur', ok: true, latencyMs: 42 },
						{ region: 'enam', ok: false, latencyMs: null },
					],
				},
			}),
			res
		);

		expect(repositoryMock.repository.recordTorBoxCdnSamples).toHaveBeenCalledWith([
			{ region: 'ceur', ok: true, latencyMs: 42 },
			{ region: 'enam', ok: false, latencyMs: null },
		]);
		expect(res.status).toHaveBeenCalledWith(202);
		expect(res._getData()).toEqual({ recorded: 2 });
	});

	it('rejects a submission with nothing usable in it', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'POST', body: { results: [] } }), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(repositoryMock.repository.recordTorBoxCdnSamples).not.toHaveBeenCalled();
	});

	it('reports a server error when the write fails', async () => {
		repositoryMock.repository.recordTorBoxCdnSamples.mockRejectedValue(new Error('db down'));
		const res = createMockResponse();

		await handler(
			createMockRequest({
				method: 'POST',
				body: { results: [{ region: 'ceur', ok: true, latencyMs: 1 }] },
			}),
			res
		);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
