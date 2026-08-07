import handler from '@/pages/api/stremio-tb/cast/library/[torrentIdPlusHash]';
import { repository } from '@/services/repository';
import {
	getTorrentList,
	getWebDownloadList,
	requestDownloadLink,
	requestWebDownloadLink,
} from '@/services/torbox';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/utils/torboxCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockGetTorrentList = vi.mocked(getTorrentList);
const mockGetWebDownloadList = vi.mocked(getWebDownloadList);
const mockRequestDownloadLink = vi.mocked(requestDownloadLink);
const mockRequestWebDownloadLink = vi.mocked(requestWebDownloadLink);

const TORRENT_HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';
const WEB_DOWNLOAD_HASH = 'd41d8cd98f00b204e9800998ecf8427e';

const item = (id: number, hash: string) => ({
	id,
	hash,
	name: 'Some Movie 2021.mkv',
	files: [{ id: 0, name: 'Some Movie 2021.mkv', size: 1000 }],
});

describe('/api/stremio-tb/cast/library/[torrentIdPlusHash]', () => {
	let res: ReturnType<typeof createMockResponse>;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateTorBoxUserId).mockResolvedValue('user1');
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue('tt1234567');
		mockRepository.saveIMDBIdMapping = vi.fn().mockResolvedValue(undefined);
		mockRepository.saveTorBoxCast = vi.fn().mockResolvedValue(undefined);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('rejects a non-numeric id', async () => {
		const req = createMockRequest({
			query: { torrentIdPlusHash: `abc:${TORRENT_HASH}`, apiKey: 'key' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('casts a torrent through the torrent endpoints', async () => {
		mockGetTorrentList.mockResolvedValue({
			success: true,
			data: item(123, TORRENT_HASH),
		} as any);
		mockRequestDownloadLink.mockResolvedValue({
			success: true,
			data: 'https://stream.test/torrent.mkv',
		} as any);

		const req = createMockRequest({
			query: { torrentIdPlusHash: `123:${TORRENT_HASH}`, apiKey: 'key' },
		});
		await handler(req, res);

		expect(mockGetTorrentList).toHaveBeenCalledWith('key', { id: 123 });
		expect(mockRequestDownloadLink).toHaveBeenCalledWith('key', {
			torrent_id: 123,
			file_id: 0,
		});
		expect(mockGetWebDownloadList).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('casts a web download through the webdl endpoints', async () => {
		mockGetWebDownloadList.mockResolvedValue({
			success: true,
			data: item(77, WEB_DOWNLOAD_HASH),
		} as any);
		mockRequestWebDownloadLink.mockResolvedValue({
			success: true,
			data: 'https://stream.test/webdl.mkv',
		} as any);

		const req = createMockRequest({
			query: { torrentIdPlusHash: `w77:${WEB_DOWNLOAD_HASH}`, apiKey: 'key' },
		});
		await handler(req, res);

		expect(mockGetWebDownloadList).toHaveBeenCalledWith('key', { id: 77 });
		expect(mockGetTorrentList).not.toHaveBeenCalled();
		expect(mockRequestWebDownloadLink).toHaveBeenCalledWith('key', {
			web_id: 77,
			file_id: 0,
		});
		expect(mockRepository.saveTorBoxCast).toHaveBeenCalledWith(
			'tt1234567',
			'user1',
			WEB_DOWNLOAD_HASH,
			'Some Movie 2021.mkv',
			'https://stream.test/webdl.mkv',
			expect.any(Number),
			77,
			0
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('asks for an imdb id when a web download has no mapping yet', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue('');
		mockGetWebDownloadList.mockResolvedValue({
			success: true,
			data: item(77, WEB_DOWNLOAD_HASH),
		} as any);

		const req = createMockRequest({
			query: { torrentIdPlusHash: `w77:${WEB_DOWNLOAD_HASH}`, apiKey: 'key' },
		});
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'need_imdb_id' }));
	});
});
