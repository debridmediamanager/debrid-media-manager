import handler from '@/pages/api/watch/instant/[os]/[player]';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getInstantIntent, isWatchService } from '@/utils/intent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/intent');
vi.mock('@/utils/clientIp');

const mockedGetInstantIntent = vi.mocked(getInstantIntent);
const mockedGetClientIp = vi.mocked(getClientIpFromRequest);
const mockedIsWatchService = vi.mocked(isWatchService);

describe('/api/watch/instant/[os]/[player]', () => {
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
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://instant-stream' });
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
		mockedGetInstantIntent.mockResolvedValueOnce({ error: 'Failed to add magnet: not found' });
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
		expect(res._getData()).toEqual({ error: 'Failed to add magnet: not found' });
	});

	it('parses fileId as integer', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'intent-url' });
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
			'mpv',
			'rd',
			undefined
		);
	});

	it('forwards the TorBox service and file name', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://tb-stream' });
		const req = createMockRequest({
			query: {
				os: 'windows',
				player: 'vlc',
				token: 'tb-key',
				hash: 'abc123',
				fileId: '2',
				fileName: 'Movie.2024.mkv',
				service: 'tb',
			},
		});

		await handler(req, res);

		expect(mockedGetInstantIntent).toHaveBeenCalledWith(
			'tb-key',
			'abc123',
			2,
			'192.168.1.1',
			'windows',
			'vlc',
			'tb',
			'Movie.2024.mkv'
		);
	});

	it('passes correct params to getInstantIntent', async () => {
		mockedGetClientIp.mockReturnValue('10.0.0.5');
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'intent-url' });
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
			'vlc',
			'rd',
			undefined
		);
	});
});
