import handler from '@/pages/api/availability';
import { getTorrentInfo } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import rdMovie from '@/test/fixtures/libraryAvailability/rdinfo_movie.json';
import rdTv from '@/test/fixtures/libraryAvailability/rdinfo_tv.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');
vi.mock('@/services/realDebrid', () => ({ getTorrentInfo: vi.fn() }));

const mockRepository = vi.mocked(repository);
const RD_KEY = 'R'.repeat(52);

// real torrents/info answers (testacct123, 2026-11-05), download links redacted
const body = (overrides: Record<string, unknown> = {}) => ({
	dmmProblemKey: 'key-1-1234567890',
	solution: 'solution-hash',
	rdKey: RD_KEY,
	torrentId: rdMovie.id,
	imdbId: 'tt28363783',
	...overrides,
});

const post = async (b: object, headers: object = { 'sec-fetch-site': 'same-origin' }) => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'POST', headers: headers as any, body: b }), res);
	return res;
};

describe('/api/availability', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		mockRepository.upsertAvailability = vi.fn().mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(rdMovie as any);
	});

	it('records what Real-Debrid says about the torrent, read with the user token', async () => {
		const res = await post(body());
		expect(res.status).toHaveBeenCalledWith(200);
		expect(getTorrentInfo).toHaveBeenCalledWith(RD_KEY, rdMovie.id, true);
		const saved = vi.mocked(mockRepository.upsertAvailability).mock.calls[0][0];
		expect(saved).toMatchObject({
			hash: rdMovie.hash,
			imdbId: 'tt28363783',
			filename: rdMovie.filename,
			bytes: rdMovie.bytes,
			status: 'downloaded',
			host: 'real-debrid.com',
		});
		expect(saved.selectedFiles).toHaveLength(1);
		expect(saved.links).toEqual(rdMovie.links);
	});

	it('keeps only the selected files of a season pack', async () => {
		vi.mocked(getTorrentInfo).mockResolvedValue(rdTv as any);
		await post(body({ torrentId: rdTv.id, imdbId: 'tt5626028' }));
		const saved = vi.mocked(mockRepository.upsertAvailability).mock.calls[0][0];
		expect(saved.selectedFiles).toHaveLength(rdTv.files.filter((f) => f.selected === 1).length);
	});

	// The hole the 2026-11-05 audit found: the route stored whatever the caller sent, so a
	// script could plant a "cached" row with any /d/ link for any title.
	it('ignores a torrent described in the request body', async () => {
		const forged = {
			dmmProblemKey: 'key-1-1234567890',
			solution: 'solution-hash',
			hash: 'a'.repeat(40),
			imdbId: 'tt0111161',
			filename: 'Film.mkv',
			original_filename: 'Film.mkv',
			bytes: 90e9,
			original_bytes: 90e9,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			files: [{ id: 1, path: 'Film.mkv', bytes: 90e9, selected: 1 }],
			links: ['https://real-debrid.com/d/ATTACKERLINK1'],
			ended: '2026-01-01T00:00:00Z',
		};
		const res = await post(forged);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.upsertAvailability).not.toHaveBeenCalled();
	});

	it('serves DMM pages only', async () => {
		const res = await post(body(), { 'sec-fetch-site': 'cross-site' });
		expect(res.status).toHaveBeenCalledWith(403);
		expect(getTorrentInfo).not.toHaveBeenCalled();
	});

	it('refuses what RD does not show downloaded, whole and mostly video', async () => {
		const cases = [
			{ ...rdMovie, status: 'downloading', progress: 40 },
			{ ...rdMovie, links: [] },
			{ ...rdMovie, files: rdMovie.files.map((f) => ({ ...f, selected: 0 })) },
			{ ...rdMovie, files: rdMovie.files.map((f) => ({ ...f, path: '/Album/01.flac' })) },
		];
		for (const info of cases) {
			vi.mocked(getTorrentInfo).mockResolvedValueOnce(info as any);
			expect((await post(body())).status).toHaveBeenCalledWith(400);
		}
		vi.mocked(getTorrentInfo).mockRejectedValueOnce(new Error('404'));
		expect((await post(body())).status).toHaveBeenCalledWith(502);
		expect((await post(body({ imdbId: 'anidb-1' }))).status).toHaveBeenCalledWith(400);
		expect(mockRepository.upsertAvailability).not.toHaveBeenCalled();
	});

	it('returns 500 when persistence fails', async () => {
		mockRepository.upsertAvailability = vi.fn().mockRejectedValue(new Error('db'));
		expect((await post(body())).status).toHaveBeenCalledWith(500);
	});
});
