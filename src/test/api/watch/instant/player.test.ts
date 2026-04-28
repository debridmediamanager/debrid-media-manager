import handler from '@/pages/api/watch/instant/[os]/[player]';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getInstantIntent } from '@/utils/intent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/intent');
vi.mock('@/utils/clientIp');

const mockedGetInstantIntent = vi.mocked(getInstantIntent);
const mockedGetClientIp = vi.mocked(getClientIpFromRequest);

describe('/api/watch/instant/[os]/[player]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockedGetClientIp.mockReturnValue('192.168.1.1');
	});

	it('redirects 307 when intent is found', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce('vlc://instant-stream');
		const req = createMockRequest({
			query: {
				os: 'windows',
				player: 'vlc',
				token: 'rd-token',
				hash: 'abc123',
				fileId: '42',
			},
		});

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(307, 'vlc://instant-stream');
	});

	it('returns 500 when no intent is found', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce(undefined as any);
		const req = createMockRequest({
			query: {
				os: 'macos',
				player: 'infuse',
				token: 'rd-token',
				hash: 'def456',
				fileId: '10',
			},
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'No intent found for def456' });
	});

	it('parses fileId as integer', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce('intent-url');
		const req = createMockRequest({
			query: { os: 'linux', player: 'mpv', token: 'tok', hash: 'h1', fileId: '99' },
		});

		await handler(req, res);

		expect(mockedGetInstantIntent).toHaveBeenCalledWith(
			'tok',
			'h1',
			99,
			'192.168.1.1',
			'linux',
			'mpv'
		);
	});

	it('passes correct params to getInstantIntent', async () => {
		mockedGetClientIp.mockReturnValue('10.0.0.5');
		mockedGetInstantIntent.mockResolvedValueOnce('intent-url');
		const req = createMockRequest({
			query: { os: 'android', player: 'vlc', token: 'my-token', hash: 'xyz789', fileId: '3' },
		});

		await handler(req, res);

		expect(mockedGetClientIp).toHaveBeenCalledWith(req);
		expect(mockedGetInstantIntent).toHaveBeenCalledWith(
			'my-token',
			'xyz789',
			3,
			'10.0.0.5',
			'android',
			'vlc'
		);
	});
});
