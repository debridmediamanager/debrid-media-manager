import handler from '@/pages/api/sponsor/mediainfo';
import { repository } from '@/services/repository';
import legacyWorker from '@/test/fixtures/torrentSnapshot/legacy-worker-0.10.0.json';
import partialPack from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-partial-pack.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

// A real zurg post, stored the way the snapshot route stores it.
const stored = toStoredSnapshot(TorrentSnapshot.parse(partialPack));
const packRow = { hash: stored.Hash, payload: stored };
const legacyRow = { hash: legacyWorker.Hash, payload: legacyWorker };

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/sponsor/mediainfo', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([packRow]);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("answers each stored file's probe with the path and size it was taken of", async () => {
		const res = createMockResponse();
		await handler(post({ hashes: [stored.Hash.toUpperCase()] }), res);

		expect(mockRepository.getSnapshotsByHashes).toHaveBeenCalledWith([stored.Hash]);
		expect(res.status).toHaveBeenCalledWith(200);
		const { releases } = vi.mocked(res.json).mock.calls[0][0];
		const files = releases[stored.Hash].files;
		expect(Object.keys(files)).toEqual(Object.keys(stored.SelectedFiles));
		for (const [key, file] of Object.entries(stored.SelectedFiles)) {
			expect(files[key]).toEqual({
				path: file.path,
				bytes: file.bytes,
				MediaInfo: file.MediaInfo,
			});
			expect(files[key].MediaInfo.streams.length).toBeGreaterThan(0);
		}
	});

	it('never hands back the address a probe read from', async () => {
		const [key, file] = Object.entries(stored.SelectedFiles)[0];
		const leaky = {
			...stored,
			SelectedFiles: {
				[key]: {
					...file,
					Link: 'https://real-debrid.com/d/SECRET',
					MediaInfo: {
						...file.MediaInfo,
						format: {
							...(file.MediaInfo.format as object),
							filename: 'https://x/d/SECRET',
						},
					},
				},
			},
		};
		mockRepository.getSnapshotsByHashes = vi
			.fn()
			.mockResolvedValue([{ hash: stored.Hash, payload: leaky }]);
		const res = createMockResponse();
		await handler(post({ hashes: [stored.Hash] }), res);

		expect(JSON.stringify(vi.mocked(res.json).mock.calls[0][0])).not.toContain('SECRET');
	});

	it('leaves out hashes with no file it can match', async () => {
		mockRepository.getSnapshotsByHashes = vi
			.fn()
			.mockResolvedValue([
				{ hash: 'b'.repeat(40), payload: { MediaInfo: { streams: [], format: {} } } },
			]);
		const res = createMockResponse();
		await handler(post({ hashes: ['b'.repeat(40)] }), res);

		expect(res.json).toHaveBeenCalledWith({ releases: {} });
	});

	it('answers legacy worker rows that carry path and size', async () => {
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([legacyRow]);
		const res = createMockResponse();
		await handler(post({ hashes: [legacyWorker.Hash] }), res);

		const { releases } = vi.mocked(res.json).mock.calls[0][0];
		expect(Object.keys(releases[legacyWorker.Hash].files).length).toBeGreaterThan(0);
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ hashes: [stored.Hash] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.getSnapshotsByHashes).not.toHaveBeenCalled();
	});

	it("refuses a lapsed sponsor's key", async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await handler(post({ hashes: [stored.Hash] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.getSnapshotsByHashes).not.toHaveBeenCalled();
	});

	it.each([
		['no body', undefined],
		['no hashes', {}],
		['an empty list', { hashes: [] }],
		['a malformed hash', { hashes: ['xyz'] }],
		['more than 100', { hashes: Array.from({ length: 101 }, () => stored.Hash) }],
	])('answers 400 for %s', async (_label, body) => {
		const res = createMockResponse();
		await handler(post(body), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.getSnapshotsByHashes).not.toHaveBeenCalled();
	});
});
