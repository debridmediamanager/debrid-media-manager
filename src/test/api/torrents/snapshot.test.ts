import handler from '@/pages/api/torrents/snapshot';
import { repository } from '@/services/repository';
import legacyWorkerSnapshot from '@/test/fixtures/torrentSnapshot/legacy-worker-0.10.0.json';
import zurgDeletedEpisodeSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-deleted-episode.json';
import zurgPartialPackSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-partial-pack.json';
import zurgDirectWithNfoSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-with-nfo.json';
import zurgDirectSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { extractStreamMetadata } from '@/utils/streamMetadata';
import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
const mockRepository = vi.mocked(repository);

// The fixtures are real snapshots with their account links, torrent ids and
// Plex keys replaced. One is what zurgtorrent-worker forwarded before January,
// one is what zurg 0.11.0 posts here directly. The third adds a real .nfo entry
// as zurg serializes it: zurg selects sidecars but only probes media, and on
// 2026-09-10 DMM refused live releases for exactly that
// ("invalid_type at .SelectedFiles.<name>.nfo.MediaInfo (expected object)").
//
// The two season packs were written by zurg itself: its own analysis pass and
// sender (ApplyMediaInfoDetails, sendTorrentToAPI at zurg 7963b245) posting to
// a capture server, with only the account calls stubbed and the probe being
// the real one above. zurg posts after every pass whatever the pass managed,
// so a pack arrives with an episode whose probe failed this pass, one still in
// its day of cooldown from an earlier failure, or one the user deleted through
// the mount. Over 2026-09-21..10-04 DMM refused 58,972 posts as "A media file
// was not analyzed" and 8,026 over a file's state, and a pack among them lost
// every probe it did carry. The hash is made up; nothing reads it.
const fixtures = [
	['as zurgtorrent-worker forwards it', legacyWorkerSnapshot, 1],
	['as zurg posts it directly', zurgDirectSnapshot, 1],
	['with a sidecar zurg never probes', zurgDirectWithNfoSnapshot, 1],
	['of a pack zurg analyzed only in part', zurgPartialPackSnapshot, 2],
	['of a pack with an episode the user deleted', zurgDeletedEpisodeSnapshot, 1],
] as const;

function post(body: unknown, headers: Record<string, string> = {}) {
	return createMockRequest({ method: 'POST', headers, body });
}

function storedPayload(): Record<string, any> {
	return mockRepository.upsertTorrentSnapshot.mock.calls[0][0].payload as Record<string, any>;
}

function withChange(change: (snapshot: Record<string, any>) => void) {
	const snapshot = structuredClone(zurgDirectSnapshot) as Record<string, any>;
	change(snapshot);
	return snapshot;
}

function withPackChange(change: (snapshot: Record<string, any>) => void) {
	const snapshot = structuredClone(zurgPartialPackSnapshot) as Record<string, any>;
	change(snapshot);
	return snapshot;
}

describe('/api/torrents/snapshot', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		process.env.ZURGTORRENT_SYNC_SECRET = 'sync-secret';
		mockRepository.upsertTorrentSnapshot = vi.fn().mockResolvedValue(undefined);
		mockRepository.getLatestTorrentSnapshot = vi.fn();
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it('rejects unsupported methods', async () => {
		const req = createMockRequest({ method: 'PUT' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ message: 'Method not allowed' });
	});

	describe('POST', () => {
		it('accepts a zurg snapshot with no sync secret configured', async () => {
			delete process.env.ZURGTORRENT_SYNC_SECRET;
			const res = createMockResponse();

			await handler(post(zurgDirectSnapshot, { 'x-zurg-token': 'a-users-own-key' }), res);

			const id = `${zurgDirectSnapshot.Hash}:${zurgDirectSnapshot.Added.slice(0, 10)}`;
			expect(res.status).toHaveBeenCalledWith(201);
			expect(res.json).toHaveBeenCalledWith({ success: true, id });
			expect(mockRepository.upsertTorrentSnapshot).toHaveBeenCalledWith(
				expect.objectContaining({ id, hash: zurgDirectSnapshot.Hash })
			);
		});

		it.each(fixtures)('accepts a snapshot %s', async (_, snapshot) => {
			const res = createMockResponse();

			await handler(post(snapshot), res);

			expect(res.status).toHaveBeenCalledWith(201);
			expect(mockRepository.upsertTorrentSnapshot).toHaveBeenCalledTimes(1);
		});

		it.each(fixtures)(
			'stores media details and nothing of the account, %s',
			async (_, snapshot, analyzed) => {
				await handler(post(snapshot), createMockResponse());

				const payload = storedPayload();
				const text = JSON.stringify(payload);
				expect(text).not.toContain('real-debrid.com');
				expect(text).not.toContain('REDACTEDID');
				const kept = [
					'Added',
					'Hash',
					'IMDBID',
					'Name',
					'OriginalName',
					'SelectedFiles',
					'State',
					'Version',
				];
				// An empty IMDBID says nothing, so it is not kept.
				expect(Object.keys(payload).sort()).toEqual(
					kept.filter((key) => key !== 'IMDBID' || Boolean(snapshot.IMDBID))
				);
				const files = Object.values(payload.SelectedFiles) as Record<string, any>[];
				expect(files).toHaveLength(analyzed);
				for (const file of files) {
					expect(Object.keys(file).sort()).toEqual(['MediaInfo', 'bytes', 'path']);
					expect(file.MediaInfo.streams.length).toBeGreaterThan(0);
					expect(file.MediaInfo.format).not.toHaveProperty('filename');
					expect(file.MediaInfo.format.duration).toEqual(expect.any(String));
				}
			}
		);

		it('stores the episodes zurg analyzed and skips the rest', async () => {
			await handler(post(zurgPartialPackSnapshot), createMockResponse());

			// E02 sits in its cooldown, E03 failed this pass, the .nfo is never probed.
			expect(Object.keys(storedPayload().SelectedFiles).sort()).toEqual([
				'Ghosts.US.S04E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
				'Ghosts.US.S04E04.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
			]);
		});

		it('stores no file the user deleted', async () => {
			await handler(post(zurgDeletedEpisodeSnapshot), createMockResponse());

			expect(Object.keys(storedPayload().SelectedFiles)).toEqual([
				'Ghosts.US.S04E02.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
			]);
		});

		it('says what it skipped from a pack it stored', async () => {
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			await handler(post(zurgPartialPackSnapshot), createMockResponse());

			expect(infoSpy).toHaveBeenCalledWith('Stored part of a torrent snapshot', {
				files: { analyzed: 2, not_analyzed: 2, sidecar: 1 },
			});
			infoSpy.mockRestore();
		});

		it('says nothing extra for a release stored whole', async () => {
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			await handler(post(zurgDirectWithNfoSnapshot), createMockResponse());

			expect(infoSpy).not.toHaveBeenCalled();
			infoSpy.mockRestore();
		});

		it.each(fixtures)('keeps what the Stremio addons read, %s', async (_, snapshot) => {
			await handler(post(snapshot), createMockResponse());

			const metadata = extractStreamMetadata(storedPayload());
			expect(metadata?.resolution).toEqual(expect.any(String));
			expect(metadata?.videoCodec).toEqual(expect.any(String));
			expect(metadata?.audioCodec).toEqual(expect.any(String));
		});

		it.each([
			[
				'a file that was never analyzed',
				withChange((s) => {
					Object.values<Record<string, any>>(s.SelectedFiles)[0].MediaInfo = null;
				}),
			],
			[
				'a pack in which no episode was analyzed',
				withPackChange((s) => {
					for (const file of Object.values<Record<string, any>>(s.SelectedFiles)) {
						file.MediaInfo = null;
					}
				}),
			],
			[
				// zurg probes only ok files, so a probe on any other is not one it sent.
				'a pack whose only probe belongs to a file that is not ok',
				withPackChange((s) => {
					for (const file of Object.values<Record<string, any>>(s.SelectedFiles)) {
						if (file.MediaInfo) file.State = 'broken_file';
					}
				}),
			],
			['a release zurg holds as broken', withChange((s) => (s.State = 'broken_torrent'))],
			[
				'a release zurg could not repair',
				withChange((s) => (s.Unfixable = 'infringing_torrent')),
			],
			['a hash that is not an infohash', withChange((s) => (s.Hash = 'abc'))],
			['no files', withChange((s) => (s.SelectedFiles = {}))],
			['an unparseable Added date', withChange((s) => (s.Added = 'yesterday'))],
			['no body', undefined],
		])('rejects %s', async (_, snapshot) => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const res = createMockResponse();

			await handler(post(snapshot), res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Invalid torrent snapshot' })
			);
			expect(mockRepository.upsertTorrentSnapshot).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		});

		it('says what each file of a refused pack carried', async () => {
			// The refusal log names the failing paths but not whether the pack
			// held any probe, which is what decides if a refusal lost data.
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const refused = withPackChange((s) => {
				s.State = 'broken_torrent';
				s.SelectedFiles['Ghosts.US.S04E02.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv'].State =
					'deleted_file';
			});

			await handler(post(refused), createMockResponse());

			expect(warnSpy).toHaveBeenCalledWith('Rejected torrent snapshot', {
				issues: ['invalid_literal at .State'],
				files: { analyzed: 2, not_analyzed: 1, sidecar: 1, deleted_file: 1 },
			});
			warnSpy.mockRestore();
		});

		it('returns 500 when the snapshot cannot be stored', async () => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockRepository.upsertTorrentSnapshot = vi.fn().mockRejectedValue(new Error('db down'));
			const res = createMockResponse();

			await handler(post(zurgDirectSnapshot), res);

			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
			errorSpy.mockRestore();
		});
	});

	it('returns 500 when sync secret is missing for reads', async () => {
		delete process.env.ZURGTORRENT_SYNC_SECRET;
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const req = createMockRequest({
			method: 'GET',
			query: { hash: 'abcdef1234567890abcdef1234567890abcdef12', password: 'test' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(errorSpy).toHaveBeenCalledWith(
			'Missing ZURGTORRENT_SYNC_SECRET environment variable'
		);
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ message: 'Server misconfiguration' });

		errorSpy.mockRestore();
	});

	it('returns 400 when hash query parameter is invalid', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { hash: 'invalid', password: 'test' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Invalid hash format' });
	});

	it('returns 401 when password does not match derived hash', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: {
				hash: 'abcdef1234567890abcdef1234567890abcdef12',
				password: 'wrong',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(warnSpy).toHaveBeenCalledWith(
			'Rejected torrent snapshot request due to invalid password'
		);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });

		warnSpy.mockRestore();
	});

	it('returns 404 when snapshot is not found', async () => {
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue(null);
		const hash = 'abcdef1234567890abcdef1234567890abcdef12';
		const password = crypto
			.createHash('sha1')
			.update(hash + 'sync-secret')
			.digest('hex');

		const req = createMockRequest({
			method: 'GET',
			query: { hash, password },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getLatestTorrentSnapshot).toHaveBeenCalledWith(hash);
		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
	});

	it('returns snapshot payload when credentials are valid', async () => {
		const payload = { files: ['file1.mkv'] };
		mockRepository.getLatestTorrentSnapshot = vi.fn().mockResolvedValue({ payload });
		const hash = 'abcdef1234567890abcdef1234567890abcdef12';
		const password = crypto
			.createHash('sha1')
			.update(hash + 'sync-secret')
			.digest('hex');

		const req = createMockRequest({
			method: 'GET',
			query: { hash, password },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getLatestTorrentSnapshot).toHaveBeenCalledWith(hash);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(payload);
	});
});
