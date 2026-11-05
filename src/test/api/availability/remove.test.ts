import handler from '@/pages/api/availability/remove';
import { getTorrentInfo } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import rdMovie from '@/test/fixtures/libraryAvailability/rdinfo_movie.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');
vi.mock('@/services/realDebrid', () => ({ getTorrentInfo: vi.fn() }));

const mockRepository = vi.mocked(repository);
const RD_KEY = 'R'.repeat(52);
const token = { dmmProblemKey: 'key-3', solution: 'hash-3' };
// a real torrents/info answer (testacct123, 2026-11-05), download links redacted
const proof = { rdKey: RD_KEY, torrentId: rdMovie.id };

const post = async (b: object, headers: object = { 'sec-fetch-site': 'same-origin' }) => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'POST', headers: headers as any, body: b }), res);
	return res;
};

describe('/api/availability/remove', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		mockRepository.removeAvailability = vi.fn().mockResolvedValue(undefined);
		mockRepository.getCachedRdNames = vi.fn().mockResolvedValue(new Map());
	});

	// The 2026-11-05 audit: a token from /api/challenge was all it took to delete any row.
	it('keeps a row when nothing but the request says it is uncached', async () => {
		mockRepository.getCachedRdNames = vi
			.fn()
			.mockResolvedValue(
				new Map([
					[
						rdMovie.hash,
						{ filename: rdMovie.filename, originalFilename: rdMovie.original_filename },
					],
				])
			);
		const res = await post({ ...token, hash: rdMovie.hash, reason: 'user-request' });
		expect(res.status).toHaveBeenCalledWith(409);
		expect(mockRepository.removeAvailability).not.toHaveBeenCalled();
	});

	it('removes a row whose recorded name Real-Debrid refuses', async () => {
		mockRepository.getCachedRdNames = vi
			.fn()
			.mockResolvedValue(
				new Map([
					[
						'c'.repeat(40),
						{ filename: 'Show.S01.WEB-DL.mkv', originalFilename: 'Show.S01.WEB-DL' },
					],
				])
			);
		const res = await post({ ...token, hash: 'c'.repeat(40), reason: 'RD infringing_file' });
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.removeAvailability).toHaveBeenCalledWith('c'.repeat(40));
	});

	it('removes a row when RD shows the user add downloading', async () => {
		vi.mocked(getTorrentInfo).mockResolvedValue({
			...rdMovie,
			status: 'downloading',
			progress: 2,
		} as any);
		const res = await post({ ...token, hash: rdMovie.hash, ...proof });
		expect(getTorrentInfo).toHaveBeenCalledWith(RD_KEY, rdMovie.id, true);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.removeAvailability).toHaveBeenCalledWith(rdMovie.hash);
	});

	// A selection that failed on a 429 or a dropped connection leaves a cached release
	// waiting for files; that used to evict it for everybody.
	it('keeps a row RD holds, or that is waiting for its files, or is another release', async () => {
		const cases = [
			rdMovie,
			{
				...rdMovie,
				status: 'waiting_files_selection',
				files: rdMovie.files.map((f) => ({ ...f, selected: 0 })),
			},
			{ ...rdMovie, status: 'downloading', hash: 'b'.repeat(40) },
		];
		for (const info of cases) {
			vi.mocked(getTorrentInfo).mockResolvedValueOnce(info as any);
			const res = await post({ ...token, hash: rdMovie.hash, ...proof });
			expect(res.status).not.toHaveBeenCalledWith(200);
		}
		vi.mocked(getTorrentInfo).mockRejectedValueOnce(new Error('503'));
		expect(
			(await post({ ...token, hash: rdMovie.hash, ...proof })).status
		).toHaveBeenCalledWith(502);
		expect(mockRepository.removeAvailability).not.toHaveBeenCalled();
	});

	it('serves DMM pages only and checks its input', async () => {
		expect(
			(
				await post(
					{ ...token, hash: rdMovie.hash, ...proof },
					{ 'sec-fetch-site': 'cross-site' }
				)
			).status
		).toHaveBeenCalledWith(403);
		expect((await post({ ...token, hash: 'xyz' })).status).toHaveBeenCalledWith(400);
		vi.mocked(validateProblemToken).mockReturnValue(false);
		expect((await post({ ...token, hash: rdMovie.hash })).status).toHaveBeenCalledWith(403);
		expect(mockRepository.removeAvailability).not.toHaveBeenCalled();
	});
});
