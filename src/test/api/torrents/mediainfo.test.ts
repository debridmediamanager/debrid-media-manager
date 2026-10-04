import handler from '@/pages/api/torrents/mediainfo';
import { repository } from '@/services/repository';
import legacyWorkerSnapshot from '@/test/fixtures/torrentSnapshot/legacy-worker-0.10.0.json';
import zurgPartialPackSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-partial-pack.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { extractStreamMetadata } from '@/utils/streamMetadata';
import { TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
const mockRepository = vi.mocked(repository);

describe('/api/torrents/mediainfo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.getLatestTorrentSnapshot = vi.fn();
	});

	it('rejects unsupported methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ message: 'Method not allowed' });
	});

	it('returns 400 when hash is missing', async () => {
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Missing hash parameter' });
	});

	it('returns 400 when hash format is invalid', async () => {
		const req = createMockRequest({ query: { hash: 'invalid' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Invalid hash format' });
	});

	it('returns 404 when no snapshot exists', async () => {
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { hash: 'abcdef1234567890abcdef1234567890abcdef12' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getLatestTorrentSnapshot).toHaveBeenCalledWith(
			'abcdef1234567890abcdef1234567890abcdef12'
		);
		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
	});

	it('returns 404 when snapshot has no media info payload', async () => {
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue({
			payload: { SelectedFiles: {} },
		});
		const req = createMockRequest({
			query: { hash: 'abcdef1234567890abcdef1234567890abcdef12' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
	});

	it('returns media info when snapshot payload is available', async () => {
		const payload = {
			SelectedFiles: {
				'0': {
					MediaInfo: {
						streams: [
							{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
						],
						format: { duration: '3600' },
					},
				},
			},
		};
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue({ payload });
		const req = createMockRequest({
			query: { hash: 'abcdef1234567890abcdef1234567890abcdef12' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(payload);
	});

	it('serves a stored snapshot without its links or download address', async () => {
		// A real row as zurgtorrent-worker stored it, with the link and the
		// account's download URL replaced by placeholders of the same shape.
		mockRepository.getLatestTorrentSnapshot = vi
			.fn()
			.mockResolvedValue({ payload: legacyWorkerSnapshot });
		const req = createMockRequest({ query: { hash: legacyWorkerSnapshot.Hash } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, any>;
		expect(JSON.stringify(body)).not.toContain('real-debrid.com');
		const files = Object.values(body.SelectedFiles) as Record<string, any>[];
		expect(files).toHaveLength(1);
		expect(Object.keys(files[0])).toEqual(['MediaInfo']);
		expect(files[0].MediaInfo.streams.length).toBeGreaterThan(0);
		expect(files[0].MediaInfo.format.duration).toEqual(expect.any(String));
	});

	it('serves a pack zurg analyzed only in part as its analyzed episodes alone', async () => {
		// What the snapshot route now stores of a pack with two episodes unprobed:
		// the public answer must hold the two probes and nothing of the account.
		const stored = toStoredSnapshot(TorrentSnapshot.parse(zurgPartialPackSnapshot));
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue({ payload: stored });
		const req = createMockRequest({ query: { hash: zurgPartialPackSnapshot.Hash } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, any>;
		const text = JSON.stringify(body);
		expect(text).not.toContain('real-debrid.com');
		expect(text).not.toContain('REDACTED');
		expect(Object.keys(body.SelectedFiles).sort()).toEqual([
			'Ghosts.US.S04E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
			'Ghosts.US.S04E04.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
		]);
		for (const file of Object.values(body.SelectedFiles) as Record<string, any>[]) {
			expect(Object.keys(file)).toEqual(['MediaInfo']);
			expect(file.MediaInfo.streams.length).toBeGreaterThan(0);
		}
		// The panel and the Stremio addons read the first file; it has a probe.
		expect(extractStreamMetadata(stored)?.videoCodec).toEqual(expect.any(String));
	});

	it('returns 500 when repository throws', async () => {
		mockRepository.getLatestTorrentSnapshot = vi
			.fn()
			.mockRejectedValue(new Error('database error'));
		const req = createMockRequest({
			query: { hash: 'abcdef1234567890abcdef1234567890abcdef12' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
	});

	afterAll(() => {
		vi.resetAllMocks();
	});
});
