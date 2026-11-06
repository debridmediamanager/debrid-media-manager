import handler from '@/pages/api/sponsor/probes';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import sintel from '@/test/fixtures/contributedProbe/rd-sintel-ffprobe-2026-11-06.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', async (original) => ({
	...(await original<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn().mockResolvedValue(true),
}));

const mockRepository = vi.mocked(repository);
const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

// ffprobe's own output (rex-stremio's flags) of a Real-Debrid link to Sintel's file, link redacted.
const probe = {
	hash: sintel.hash,
	bytes: sintel.bytes,
	name: sintel.name,
	MediaInfo: sintel.MediaInfo,
};

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/sponsor/probes', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.saveContributedProbes = vi
			.fn()
			.mockImplementation(async (rows: unknown[]) => rows.length);
	});
	afterEach(() => vi.clearAllMocks());

	it('keeps a real ffprobe output under the sponsor, without the address it read', async () => {
		const res = createMockResponse();
		await handler(
			post({
				probes: [{ ...probe, hash: probe.hash.toUpperCase(), name: 'Sintel/Sintel.mp4' }],
			}),
			res
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ saved: 1, known: 0 });
		const [rows] = vi.mocked(mockRepository.saveContributedProbes).mock.calls[0];
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			hash: sintel.hash,
			bytes: BigInt(sintel.bytes),
			name: 'Sintel.mp4',
			sponsor: 'ZP1M',
		});
		expect(JSON.stringify(rows[0].mediaInfo)).not.toContain('REDACTED');
		expect((rows[0].mediaInfo as { streams: unknown[] }).streams).toHaveLength(2);
	});

	it('counts a file DMM already holds as known, never replacing it', async () => {
		mockRepository.saveContributedProbes = vi.fn().mockResolvedValue(0);
		const res = createMockResponse();
		await handler(post({ probes: [probe] }), res);

		expect(res.json).toHaveBeenCalledWith({ saved: 0, known: 1 });
	});

	it.each([
		['a malformed hash', { ...probe, hash: 'xyz' }, 'hash'],
		['no size', { ...probe, bytes: undefined }, 'bytes'],
		['a size that is not a whole number', { ...probe, bytes: 1.5 }, 'bytes'],
		['a probe of another size', { ...probe, bytes: probe.bytes + 1 }, 'format.size'],
		[
			'something that is not ffprobe output',
			{ ...probe, MediaInfo: { hello: 'world' } },
			'ffprobe',
		],
		['no streams', { ...probe, MediaInfo: { ...probe.MediaInfo, streams: [] } }, 'streams'],
		['a name that is not a string', { ...probe, name: 42 }, 'name'],
	])('refuses %s and keeps the rest', async (_label, bad, word) => {
		const res = createMockResponse();
		await handler(post({ probes: [probe, bad] }), res);

		const body = vi.mocked(res.json).mock.calls[0][0];
		expect(body.saved).toBe(1);
		expect(body.rejected).toEqual([{ index: 1, error: expect.stringContaining(word) }]);
	});

	it('refuses a probe larger than 256 KB', async () => {
		const big = {
			...probe,
			MediaInfo: { ...probe.MediaInfo, padding: 'x'.repeat(300 * 1024) },
		};
		const res = createMockResponse();
		await handler(post({ probes: [big] }), res);

		expect(vi.mocked(res.json).mock.calls[0][0].rejected[0].error).toContain('larger');
		expect(mockRepository.saveContributedProbes).not.toHaveBeenCalled();
	});

	it('takes one file once per request', async () => {
		const res = createMockResponse();
		await handler(post({ probes: [probe, probe] }), res);

		expect(vi.mocked(res.json).mock.calls[0][0]).toEqual({
			saved: 1,
			known: 0,
			rejected: [{ index: 1, error: 'the same file twice in one request' }],
		});
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ probes: [probe] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.saveContributedProbes).not.toHaveBeenCalled();
	});

	it('answers 429 past its rate limit', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValueOnce(false);
		const res = createMockResponse();
		await handler(post({ probes: [probe] }), res);

		expect(res.status).toHaveBeenCalledWith(429);
		expect(mockRepository.saveContributedProbes).not.toHaveBeenCalled();
	});

	it.each([
		['no body', undefined],
		['no probes', {}],
		['an empty list', { probes: [] }],
		['more than 100', { probes: Array.from({ length: 101 }, () => probe) }],
	])('answers 400 for %s', async (_label, body) => {
		const res = createMockResponse();
		await handler(post(body), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.saveContributedProbes).not.toHaveBeenCalled();
	});
});
