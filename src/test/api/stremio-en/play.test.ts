import handler from '@/pages/api/stremio-en/[userid]/play/[hash]';
import { EasynewsAuthError, EasynewsGoneError, resolveEasynewsLink } from '@/services/easynews';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { castPlayVideoUrl } from '@/utils/castPlayVideos';
import { easynewsCastKey } from '@/utils/easynewsCastKey';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	resolveEasynewsLink: vi.fn(),
}));
vi.mock('@/services/repository');

const mockResolve = vi.mocked(resolveEasynewsLink);
const mockRepository = vi.mocked(repository);
const LOGIN = { username: 'alice', password: 'pw' };
const HASH = 'a'.repeat(32);
const PATH = `${HASH}.mkv/Severance.S02E05.1080p.WEB.H264-GRP.mkv`;

const request = (query: Record<string, string> = { userid: 'en-user', hash: HASH, path: PATH }) =>
	createMockRequest({ query });

describe('/api/stremio-en/[userid]/play/[hash]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.getEasynewsCastProfile = vi
			.fn()
			.mockResolvedValue({ apiKey: easynewsCastKey(LOGIN) });
	});

	// Nothing stored to redeem: a fresh signed link per play, with the stream owner's login.
	it('sends the player to a link signed with the profile login', async () => {
		mockResolve.mockResolvedValue('https://members-de.easynews.com/signed/file.mkv');
		const res = createMockResponse();
		await handler(request(), res);
		expect(mockResolve).toHaveBeenCalledWith(LOGIN, PATH);
		expect(res.redirect).toHaveBeenCalledWith(
			'https://members-de.easynews.com/signed/file.mkv'
		);
	});

	it('plays the file-unavailable video for a file Easynews no longer serves', async () => {
		mockResolve.mockRejectedValue(new EasynewsGoneError());
		const res = createMockResponse();
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(307, castPlayVideoUrl('file-unavailable'));
	});

	it('plays the sign-in-again video for a refused login', async () => {
		mockResolve.mockRejectedValue(new EasynewsAuthError());
		const res = createMockResponse();
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(307, castPlayVideoUrl('sign-in-again'));
	});

	it('plays the set-up-again video when the profile is gone', async () => {
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue(null);
		const res = createMockResponse();
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(307, castPlayVideoUrl('set-up-again'));
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('answers 503 for an Easynews outage', async () => {
		mockResolve.mockRejectedValue(new Error('Easynews did not hand out a link: HTTP 502'));
		const res = createMockResponse();
		await handler(request(), res);
		expect(res._getStatusCode()).toBe(503);
	});

	it.each([
		['no path', { userid: 'u', hash: HASH }],
		['a path of another hash', { userid: 'u', hash: 'b'.repeat(32), path: PATH }],
		['a path escaping the folder', { userid: 'u', hash: HASH, path: `${HASH}.mkv/../x` }],
	])('answers 400 for %s', async (_, query) => {
		const res = createMockResponse();
		await handler(request(query as Record<string, string>), res);
		expect(res._getStatusCode()).toBe(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});
});
