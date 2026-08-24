import handler from '@/pages/api/stremio/[userid]/watch/[imdbid]/[pingpong]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetLatestCast } = vi.hoisted(() => ({
	mockGetLatestCast: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getLatestCast: mockGetLatestCast,
	},
}));

describe('/api/stremio/[userid]/watch/[imdbid]/[pingpong]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://dmm.test';
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('validates required query params', async () => {
		const req = createMockRequest({ query: { userid: 'user', imdbid: ['tt1'] as any } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('redirects to the cached RD link when available', async () => {
		mockGetLatestCast.mockResolvedValue({ link: 'https://app.real-debrid.com/d/abc123' });
		const req = createMockRequest({
			query: { userid: 'user', imdbid: 'tt1', pingpong: 'ping', token: 'tok' },
		});
		const res = createMockResponse();
		(res.redirect as Mock).mockReturnValue(res);

		await handler(req, res);

		// No token on the play URL: the play route resolves the user's own stored
		// credentials and never read one, so passing it just put an RD token in
		// the address bar and in every access log on the way.
		expect(res.redirect).toHaveBeenCalledWith(
			302,
			'https://dmm.test/api/stremio/user/play/m/d/abc123'
		);
	});

	it('redirects to the saved stream URL when available', async () => {
		mockGetLatestCast.mockResolvedValue({ url: 'https://stream.example/video.mkv' });
		const req = createMockRequest({
			query: { userid: 'user', imdbid: 'tt1', pingpong: 'ping', token: 'tok' },
		});
		const res = createMockResponse();
		(res.redirect as Mock).mockReturnValue(res);

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(302, 'https://stream.example/video.mkv');
	});

	it('falls back to ping/pong polling when no cast exists', async () => {
		mockGetLatestCast.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', imdbid: 'tt1', pingpong: 'ping', token: 'tok' },
		});
		const res = createMockResponse();
		(res.redirect as Mock).mockReturnValue(res);

		vi.useFakeTimers();
		const handlerPromise = handler(req, res);
		await vi.runAllTimersAsync();
		await handlerPromise;
		vi.useRealTimers();

		expect(res.redirect).toHaveBeenCalledWith(
			302,
			'https://dmm.test/api/stremio/user/watch/tt1/pong?hop=1'
		);
	});

	// Regression: with nothing cast, this slept 3s and redirected to itself with
	// ping/pong flipped, forever - the only thing that ended it was the browser's
	// redirect cap, after ~20 hops of held server time per click.
	it('gives up once the hop budget is spent', async () => {
		mockGetLatestCast.mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user', imdbid: 'tt1', pingpong: 'ping', hop: '20' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(404);
	});
});
