import library from '@/pages/api/stremio-tb/cast/library/[torrentIdPlusHash]';
import movie from '@/pages/api/stremio-tb/cast/movie/[imdbid]';
import saveProfile from '@/pages/api/stremio-tb/cast/saveProfile';
import series from '@/pages/api/stremio-tb/cast/series/[imdbid]';
import updateSizeLimits from '@/pages/api/stremio-tb/cast/updateSizeLimits';
import { repository } from '@/services/repository';
import { getTorrentList, requestDownloadLink } from '@/services/torbox';
import type { MockResponse } from '@/test/utils/api';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	getBiggestFileTorBoxStreamUrl,
	getTorBoxStreamUrlKeepTorrent,
} from '@/utils/getTorBoxStreamUrl';
import type * as TorBoxCastHelpers from '@/utils/torboxCastApiHelpers';
import {
	generateTorBoxUserId,
	handleApiError,
	resolveTorBoxUser,
} from '@/utils/torboxCastApiHelpers';
import { Prisma } from '@prisma/client';
import { AxiosError, AxiosHeaders } from 'axios';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/utils/getTorBoxStreamUrl');
vi.mock('@/utils/castOtherStreamsLimit');
vi.mock('@/utils/requireSponsor');
vi.mock('@/utils/torboxCastApiHelpers', async (importOriginal) => ({
	...(await importOriginal<typeof TorBoxCastHelpers>()),
	generateTorBoxUserId: vi.fn(),
	resolveTorBoxUser: vi.fn(),
}));

const credential = 'synthetic-torbox-credential-do-not-log';
const downloadUrl = `https://download.example/video.mkv?token=${credential}`;
const axiosError = () =>
	new AxiosError(
		`Request failed for ${downloadUrl}`,
		'ERR_BAD_RESPONSE',
		{ headers: new AxiosHeaders({ Authorization: `Bearer ${credential}` }), url: downloadUrl },
		undefined,
		{
			status: 503,
			statusText: 'Service Unavailable',
			data: {},
			headers: {},
			config: { headers: new AxiosHeaders() },
		}
	);
const prismaError = () =>
	new Prisma.PrismaClientKnownRequestError(
		`Invalid save invocation: data: { apiKey: "${credential}", link: "${downloadUrl}" }`,
		{ code: 'P2002', clientVersion: 'test', meta: { apiKey: credential } }
	);

// These are actual handler catches, not a source scan or a logger-only test.
// Serialize every console argument: AxiosError.toJSON includes request config.
describe('TorBox cast credential-safe error paths', () => {
	let consoleSpy: MockInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(generateTorBoxUserId).mockResolvedValue('user1');
		vi.mocked(resolveTorBoxUser).mockResolvedValue({ valid: true, userId: 'user1' });
		vi.mocked(repository.getIMDBIdByHash).mockResolvedValue('tt1234567');
		vi.mocked(getTorrentList).mockResolvedValue({
			success: true,
			error: null,
			detail: 'OK',
			data: {
				id: 42,
				hash: 'hash',
				name: 'Movie',
				size: 1024,
				created_at: '',
				updated_at: '',
				magnet: '',
				active: true,
				auth_id: 'synthetic',
				download_state: 'cached',
				seeds: 0,
				peers: 0,
				ratio: 0,
				progress: 1,
				download_speed: 0,
				upload_speed: 0,
				eta: 0,
				server: 1,
				torrent_file: true,
				expires_at: '',
				download_present: true,
				download_finished: true,
				inactive_check: 0,
				availability: 1,
				files: [{ id: 7, name: 'Movie.mkv', size: 1024 }],
			},
		});
		vi.mocked(requestDownloadLink).mockResolvedValue({
			success: true,
			error: null,
			detail: 'OK',
			data: downloadUrl,
		});
		vi.mocked(getBiggestFileTorBoxStreamUrl).mockResolvedValue([
			downloadUrl,
			1,
			42,
			7,
			'Movie.mkv',
		]);
		vi.mocked(getTorBoxStreamUrlKeepTorrent).mockResolvedValue([
			downloadUrl,
			1,
			2,
			1,
			42,
			7,
			'Show.S01E02.mkv',
		]);
	});

	afterEach(() => vi.restoreAllMocks());

	const assertSafe = (res: MockResponse, status: number, payload: unknown, code: string) => {
		expect(res._getStatusCode()).toBe(status);
		expect(res._getData()).toEqual(payload);
		expect(consoleSpy).toHaveBeenCalled();
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(credential);
		expect(JSON.stringify(res._getData())).not.toContain(credential);
		expect(consoleSpy.mock.calls.flat()).toContainEqual(expect.objectContaining({ code }));
	};

	const req = () =>
		createMockRequest({
			method: 'POST',
			headers: { authorization: `Bearer ${credential}` },
			query: {
				imdbid: 'tt1234567',
				hash: 'hash',
				fileIds: '7',
				torrentIdPlusHash: '42:hash',
			},
			body: { apiKey: credential },
		});

	it('omits Axios config and URL-bearing messages from the movie catch', async () => {
		vi.mocked(getBiggestFileTorBoxStreamUrl).mockRejectedValue(axiosError());
		const res = createMockResponse();
		await movie(req(), res);
		assertSafe(
			res,
			500,
			{ status: 'error', errorMessage: 'Failed to cast movie' },
			'ERR_BAD_RESPONSE'
		);
		expect(consoleSpy.mock.calls.flat()).toContainEqual({
			status: 503,
			code: 'ERR_BAD_RESPONSE',
		});
	});

	it('omits Prisma arguments from the movie save catch', async () => {
		vi.mocked(repository.saveTorBoxCast).mockRejectedValue(prismaError());
		const res = createMockResponse();
		await movie(req(), res);
		assertSafe(res, 500, { status: 'error', errorMessage: 'Failed to cast movie' }, 'P2002');
	});

	it('keeps the partial series response when an episode save fails', async () => {
		vi.mocked(repository.saveTorBoxCast).mockRejectedValue(prismaError());
		const res = createMockResponse();
		await series(req(), res);
		assertSafe(res, 200, { status: 'partial', errorEpisodes: ['File 7'] }, 'P2002');
	});

	it('sanitizes the outer series catch', async () => {
		vi.mocked(generateTorBoxUserId).mockRejectedValue(axiosError());
		const res = createMockResponse();
		await series(req(), res);
		assertSafe(
			res,
			500,
			{ status: 'error', errorMessage: 'Failed to cast series' },
			'ERR_BAD_RESPONSE'
		);
	});

	it.each([
		['user ID', 'Failed to generate user ID from TorBox API key'],
		['lookup', 'Database error: Failed to retrieve IMDB ID from hash'],
		['mapping', 'Database error: Failed to save IMDB ID mapping'],
		['list', 'Failed to cast library item'],
		['save', 'Failed to cast library item'],
	] as const)('sanitizes the library %s catch', async (stage, errorMessage) => {
		const error = prismaError();
		if (stage === 'user ID') vi.mocked(generateTorBoxUserId).mockRejectedValue(error);
		if (stage === 'lookup') vi.mocked(repository.getIMDBIdByHash).mockRejectedValue(error);
		if (stage === 'mapping') {
			vi.mocked(repository.getIMDBIdByHash).mockResolvedValue(null);
			vi.mocked(repository.saveIMDBIdMapping).mockRejectedValue(error);
		}
		if (stage === 'list') vi.mocked(getTorrentList).mockRejectedValue(error);
		if (stage === 'save') vi.mocked(repository.saveTorBoxCast).mockRejectedValue(error);
		const request = req();
		request.query.imdbId = 'tt1234567';
		const res = createMockResponse();
		await library(request, res);
		assertSafe(res, 500, { status: 'error', errorMessage }, 'P2002');
	});

	it.each([
		['profile', saveProfile, 'Failed to save TorBox cast profile'],
		['size limits', updateSizeLimits, 'Failed to update TorBox cast size limits'],
	] as const)(
		'omits credential-bearing Prisma errors while saving %s',
		async (_, handler, errorMessage) => {
			vi.mocked(repository.saveTorBoxCastProfile).mockRejectedValue(prismaError());
			const res = createMockResponse();
			await handler(req(), res);
			assertSafe(res, 500, { status: 'error', errorMessage }, 'P2002');
		}
	);

	it('sanitizes the shared API error response and diagnostic', () => {
		const res = createMockResponse();
		handleApiError(axiosError(), res);
		assertSafe(res, 500, { error: 'Internal Server Error' }, 'ERR_BAD_RESPONSE');
	});

	it('does not treat arbitrary error codes as safe diagnostic text', () => {
		const res = createMockResponse();
		handleApiError(
			{ message: credential, code: credential, response: { status: credential } },
			res
		);
		expect(consoleSpy).toHaveBeenCalledWith('[DMM Cast TorBox] API request failed:', {});
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(credential);
		expect(res._getData()).toEqual({ error: 'Internal Server Error' });
	});
});
