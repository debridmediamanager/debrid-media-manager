import handler from '@/pages/api/stremio-tr/cast/series/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSaveCast, mockGenerateUserId, mockGetStreamUrl, mockValidateApiKey } = vi.hoisted(
	() => ({
		mockSaveCast: vi.fn(),
		mockGenerateUserId: vi.fn(),
		mockGetStreamUrl: vi.fn(),
		mockValidateApiKey: vi.fn(),
	})
);

vi.mock('@/services/repository', () => ({
	repository: {
		saveTorrinCast: mockSaveCast,
	},
}));

vi.mock('@/utils/torrinCastApiHelpers', () => ({
	generateTorrinUserId: mockGenerateUserId,
	validateTorrinApiKey: mockValidateApiKey,
}));

vi.mock('@/utils/getTorrinStreamUrl', () => ({
	getTorrinStreamUrl: mockGetStreamUrl,
}));

const creds = { baseUrl: 'https://tr.test', apiKey: 'tr-key' };

describe('/api/stremio-tr/cast/series/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('tr-user-1');
		mockValidateApiKey.mockResolvedValue({ valid: true });
	});

	it('validates required params', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt123', ...creds } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('casts each requested file id and records success', async () => {
		mockGetStreamUrl.mockResolvedValue([
			'https://files.example.com/Video-S01E02.mkv',
			'https://tr.test/d/link',
			1,
			2,
			700,
		]);
		const req = createMockRequest({
			query: { imdbid: 'tt999', hash: 'hash', fileIds: '101', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetStreamUrl).toHaveBeenCalledWith(
			'https://tr.test',
			'tr-key',
			'hash',
			101,
			'tv'
		);
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt999:1:2',
			'tr-user-1',
			'hash',
			'https://files.example.com/Video-S01E02.mkv',
			'https://tr.test/d/link',
			700
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: [] });
	});

	it('tracks episodes that fail to cast', async () => {
		mockGetStreamUrl
			.mockResolvedValueOnce([
				'https://files.example.com/Video-S01E01.mkv',
				'https://tr.test/d/1',
				1,
				1,
				600,
			])
			.mockRejectedValueOnce(new Error('tr offline'));

		const req = createMockRequest({
			query: { imdbid: 'tt777', hash: 'hash', fileIds: ['201', '202'], ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCast).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: ['fileId:202'] });
	});
});
