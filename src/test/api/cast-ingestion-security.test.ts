import movie from '@/pages/api/stremio-ad/cast/movie/[imdbid]';
import series from '@/pages/api/stremio-ad/cast/series/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), status: vi.fn(), files: vi.fn() }));
vi.mock('@/services/repository', () => ({ repository: { saveAllDebridCast: mocks.save } }));
vi.mock('@/utils/allDebridCastApiHelpers', () => ({
	generateAllDebridUserId: vi.fn().mockResolvedValue('user'),
}));
vi.mock('@/services/allDebrid', () => ({
	getMagnetStatusAd: mocks.status,
	getMagnetFiles: mocks.files,
}));
const hash = 'a'.repeat(40);
const link = `https://alldebrid.com/f/${'A'.repeat(43)}`;
const body = {
	apiKey: 'key',
	hash,
	magnetId: 123,
	fileIndex: 0,
	streamUrl: link,
	filename: 'movie.mkv',
	fileSize: 100,
};

describe('cast ingestion security', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.status.mockResolvedValue({ id: 123, hash, statusCode: 4 });
		mocks.files.mockResolvedValue({
			magnets: [{ id: '123', files: [{ n: 'movie.mkv', s: 100 * 1024 * 1024, l: link }] }],
		});
	});
	it.each(['https://attacker.test/video', `https://alldebrid.com/f/${'B'.repeat(43)}`])(
		'movie refuses a link not belonging to the provider file: %s',
		async (streamUrl) => {
			await movie(
				createMockRequest({
					method: 'POST',
					query: { imdbid: 'tt123' },
					body: { ...body, streamUrl },
				}),
				createMockResponse()
			);
			expect(mocks.save).not.toHaveBeenCalled();
		}
	);
	it('movie refuses attacker-selected hash attribution', async () => {
		await movie(
			createMockRequest({
				method: 'POST',
				query: { imdbid: 'tt123' },
				body: { ...body, hash: 'b'.repeat(40) },
			}),
			createMockResponse()
		);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it('series refuses arbitrary links', async () => {
		await series(
			createMockRequest({
				method: 'POST',
				query: { imdbid: 'tt123' },
				body: {
					...body,
					files: [
						{
							fileIndex: 0,
							link: 'https://attacker.test/video',
							filename: 'movie.mkv',
							fileSize: 100,
							season: 1,
							episode: 1,
						},
					],
				},
			}),
			createMockResponse()
		);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it('accepts a provider-attested movie file', async () => {
		const res = createMockResponse();
		await movie(
			createMockRequest({
				method: 'POST',
				query: { imdbid: 'tt123' },
				body: { ...body, filename: 'forged.mkv', fileSize: 999 },
			}),
			res
		);
		expect(mocks.save).toHaveBeenCalledWith(
			'tt123',
			'user',
			hash,
			'movie.mkv',
			link,
			100,
			123,
			0
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});
	it.each([movie, series])(
		'does not expose credential-bearing provider errors',
		async (handler) => {
			const secret = 'synthetic-provider-key-do-not-echo';
			const error = Object.assign(new Error(`request failed with ${secret}`), {
				config: { headers: { Authorization: `Bearer ${secret}` } },
			});
			mocks.status.mockRejectedValueOnce(error);
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			try {
				const res = createMockResponse();
				await handler(
					createMockRequest({
						method: 'POST',
						query: { imdbid: 'tt123' },
						body: {
							...body,
							apiKey: secret,
							files: [{ fileIndex: 0, link, filename: 'movie.mkv', fileSize: 100 }],
						},
					}),
					res
				);
				expect(res.status).toHaveBeenCalledWith(500);
				expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain(secret);
				expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
			} finally {
				log.mockRestore();
			}
		}
	);
});
