import handler from '@/pages/api/stremio-tr/cast/library/[torrentIdPlusHash]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockGetTorrentInfo,
	mockDbGetIMDBIdByHash,
	mockDbSaveCast,
	mockDbSaveIMDBIdMapping,
	mockGenerateUserId,
} = vi.hoisted(() => ({
	mockGetTorrentInfo: vi.fn(),
	mockDbGetIMDBIdByHash: vi.fn(),
	mockDbSaveCast: vi.fn(),
	mockDbSaveIMDBIdMapping: vi.fn(),
	mockGenerateUserId: vi.fn(),
}));

vi.mock('@/services/torrin', () => ({
	getTorrinTorrentInfo: mockGetTorrentInfo,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getIMDBIdByHash: mockDbGetIMDBIdByHash,
		saveTorrinCast: mockDbSaveCast,
		saveIMDBIdMapping: mockDbSaveIMDBIdMapping,
	},
}));

vi.mock('@/utils/torrinCastApiHelpers', () => ({
	generateTorrinUserId: mockGenerateUserId,
}));

const makeTorrentInfo = (overrides: Partial<any> = {}) => ({
	id: 'trid1',
	hash: 'hash123',
	filename: 'Movie.2024',
	original_filename: 'Movie.2024',
	files: [
		{ id: 1, path: 'Movie.2024.mkv', bytes: 1048576, selected: 1 },
		{ id: 2, path: 'Extra.mkv', bytes: 2097152, selected: 1 },
	],
	links: ['https://tr/link-1', 'https://tr/link-2'],
	...overrides,
});

const creds = { baseUrl: 'https://tr.test', apiKey: 'tr-key' };

describe('/api/stremio-tr/cast/library/[torrentIdPlusHash]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('tr-user-1');
		mockDbGetIMDBIdByHash.mockResolvedValue('tt1234567');
		mockGetTorrentInfo.mockResolvedValue(makeTorrentInfo());
		mockDbSaveIMDBIdMapping.mockResolvedValue(undefined);
	});

	it('validates creds', async () => {
		const req = createMockRequest({ query: { torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('validates torrentIdPlusHash', async () => {
		const req = createMockRequest({ query: { ...creds } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 when selected files and links mismatch', async () => {
		mockGetTorrentInfo.mockResolvedValue(makeTorrentInfo({ links: ['https://tr/link-1'] }));
		const req = createMockRequest({
			query: { torrentIdPlusHash: 'trid1:hash123', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Cannot determine file link',
		});
	});

	it('saves a cast per selected file and returns success', async () => {
		const req = createMockRequest({
			query: { torrentIdPlusHash: 'trid1:hash123', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetTorrentInfo).toHaveBeenCalledWith('https://tr.test', 'tr-key', 'trid1');
		expect(mockDbSaveCast).toHaveBeenCalledTimes(2);
		expect(mockDbSaveCast).toHaveBeenCalledWith(
			'tt1234567',
			'tr-user-1',
			'hash123',
			'Movie.2024.mkv',
			'https://tr/link-1',
			1
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'success', imdbId: 'tt1234567' })
		);
	});

	it('requests an imdb id when none is known', async () => {
		mockDbGetIMDBIdByHash.mockResolvedValue('');
		const req = createMockRequest({
			query: { torrentIdPlusHash: 'trid1:hash123', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'need_imdb_id' }));
		expect(mockDbSaveCast).not.toHaveBeenCalled();
	});

	it('saves a user-provided imdb id mapping', async () => {
		mockDbGetIMDBIdByHash.mockResolvedValue('');
		const req = createMockRequest({
			query: { torrentIdPlusHash: 'trid1:hash123', imdbId: 'tt7654321', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDbSaveIMDBIdMapping).toHaveBeenCalledWith('hash123', 'tt7654321');
		expect(mockDbSaveCast).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
	});
});
