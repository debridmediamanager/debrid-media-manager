import handler from '@/pages/api/watch/[os]/[player]';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getIntent, isWatchService } from '@/utils/intent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/intent');
vi.mock('@/utils/clientIp');

const mockedGetIntent = vi.mocked(getIntent);
const mockedGetClientIp = vi.mocked(getClientIpFromRequest);
const mockedIsWatchService = vi.mocked(isWatchService);

describe('/api/watch/[os]/[player]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockedGetClientIp.mockReturnValue('192.168.1.1');
		// The module under test is auto-mocked, so restore the real type guard.
		mockedIsWatchService.mockImplementation(
			(v: unknown): v is 'rd' | 'ad' | 'tb' => v === 'rd' || v === 'ad' || v === 'tb'
		);
	});

	it('redirects 307 when intent is found', async () => {
		mockedGetIntent.mockResolvedValueOnce({ intent: 'vlc://stream-url' });
		const req = createMockRequest({
			query: {
				os: 'windows',
				player: 'vlc',
				token: 'rd-token',
				link: 'https://example.com/file.mkv',
			},
		});

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(307, 'vlc://stream-url');
	});

	it('returns 500 when no intent is found', async () => {
		mockedGetIntent.mockResolvedValueOnce({ error: 'Failed to unrestrict link: not found' });
		const req = createMockRequest({
			query: {
				os: 'macos',
				player: 'infuse',
				token: 'rd-token',
				link: 'https://example.com/file.mkv',
			},
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			error: 'Failed to unrestrict link: not found',
		});
	});

	it('passes correct params to getIntent', async () => {
		mockedGetIntent.mockResolvedValueOnce({ intent: 'intent-url' });
		const req = createMockRequest({
			query: { os: 'android', player: 'mpv', token: 'my-token', link: 'https://rd.link/abc' },
		});

		await handler(req, res);

		expect(mockedGetIntent).toHaveBeenCalledWith(
			'my-token',
			'https://rd.link/abc',
			'192.168.1.1',
			'android',
			'mpv',
			'rd'
		);
	});

	it('forwards the AllDebrid service so the link is unlocked, not unrestricted', async () => {
		mockedGetIntent.mockResolvedValueOnce({ intent: 'infuse://ad-stream' });
		const req = createMockRequest({
			query: {
				os: 'ios',
				player: 'infuse',
				token: 'ad-key',
				link: 'https://alldebrid.com/f/abc',
				service: 'ad',
			},
		});

		await handler(req, res);

		expect(mockedGetIntent).toHaveBeenCalledWith(
			'ad-key',
			'https://alldebrid.com/f/abc',
			'192.168.1.1',
			'ios',
			'infuse',
			'ad'
		);
	});

	it('falls back to Real-Debrid when the service param is not recognised', async () => {
		mockedGetIntent.mockResolvedValueOnce({ intent: 'intent-url' });
		const req = createMockRequest({
			query: {
				os: 'ios',
				player: 'infuse',
				token: 'tok',
				link: 'https://link',
				service: 'bogus',
			},
		});

		await handler(req, res);

		expect(mockedGetIntent).toHaveBeenCalledWith(
			'tok',
			'https://link',
			'192.168.1.1',
			'ios',
			'infuse',
			'rd'
		);
	});

	it('uses client IP from request', async () => {
		mockedGetClientIp.mockReturnValue('10.0.0.5');
		mockedGetIntent.mockResolvedValueOnce({ intent: 'intent-url' });
		const req = createMockRequest({
			query: { os: 'linux', player: 'vlc', token: 'tok', link: 'https://link' },
		});

		await handler(req, res);

		expect(mockedGetClientIp).toHaveBeenCalledWith(req);
		expect(mockedGetIntent).toHaveBeenCalledWith(
			'tok',
			'https://link',
			'10.0.0.5',
			'linux',
			'vlc',
			'rd'
		);
	});
});
