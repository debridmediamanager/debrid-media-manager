import handler from '@/pages/api/watch/[os]/[player]';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getIntent } from '@/utils/intent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/intent');
vi.mock('@/utils/clientIp');

const mockedGetIntent = vi.mocked(getIntent);
const mockedGetClientIp = vi.mocked(getClientIpFromRequest);

describe('/api/watch/[os]/[player]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockedGetClientIp.mockReturnValue('192.168.1.1');
	});

	it('redirects 307 when intent is found', async () => {
		mockedGetIntent.mockResolvedValueOnce('vlc://stream-url');
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
		mockedGetIntent.mockResolvedValueOnce(undefined as any);
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
			error: 'No intent found for https://example.com/file.mkv',
		});
	});

	it('passes correct params to getIntent', async () => {
		mockedGetIntent.mockResolvedValueOnce('intent-url');
		const req = createMockRequest({
			query: { os: 'android', player: 'mpv', token: 'my-token', link: 'https://rd.link/abc' },
		});

		await handler(req, res);

		expect(mockedGetIntent).toHaveBeenCalledWith(
			'my-token',
			'https://rd.link/abc',
			'192.168.1.1',
			'android',
			'mpv'
		);
	});

	it('uses client IP from request', async () => {
		mockedGetClientIp.mockReturnValue('10.0.0.5');
		mockedGetIntent.mockResolvedValueOnce('intent-url');
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
			'vlc'
		);
	});
});
