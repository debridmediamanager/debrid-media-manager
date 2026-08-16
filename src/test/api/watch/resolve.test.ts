import handler from '@/pages/api/watch/resolve/[os]/[player]';
import { MockResponse, createMockRequest, createMockResponse } from '@/test/utils/api';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getInstantIntent, getIntent, isWatchService } from '@/utils/intent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/intent');
vi.mock('@/utils/clientIp');

const mockedGetIntent = vi.mocked(getIntent);
const mockedGetInstantIntent = vi.mocked(getInstantIntent);
const mockedGetClientIp = vi.mocked(getClientIpFromRequest);
const mockedIsWatchService = vi.mocked(isWatchService);

describe('/api/watch/resolve/[os]/[player]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockedGetClientIp.mockReturnValue('192.168.1.1');
		// The module under test is auto-mocked, so restore the real type guard.
		mockedIsWatchService.mockImplementation(
			(v: unknown): v is 'rd' | 'ad' | 'tb' | 'tbw' =>
				v === 'rd' || v === 'ad' || v === 'tb' || v === 'tbw'
		);
	});

	const post = (body: unknown, query: Record<string, string> = {}) =>
		createMockRequest({
			method: 'POST',
			query: { os: 'windows', player: 'vlc', ...query },
			body,
		});

	it('answers with the intent instead of redirecting to it', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		await handler(post({ token: 'rd-key', hash: 'abc', service: 'rd' }), res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ intent: 'vlc://stream' });
	});

	// The whole point of this route: the key travels in the body, so it never
	// reaches an access log or the tab's address bar.
	it('reads the token from the body, not the query string', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		const req = post({ token: 'rd-key', hash: 'abc', service: 'rd' });
		await handler(req, res);

		expect(req.query.token).toBeUndefined();
		expect(mockedGetInstantIntent).toHaveBeenCalledWith(
			'rd-key',
			'abc',
			NaN,
			'192.168.1.1',
			'windows',
			'vlc',
			'rd',
			undefined
		);
	});

	it('never caches a resolved stream URL', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		await handler(post({ token: 'rd-key', hash: 'abc' }), res);

		expect(res._getHeaders()['Cache-Control']).toBe('no-store');
	});

	// A caller that already holds a service link must not send the hash back
	// through the magnet path - Real-Debrid stalls on content it already has.
	it('unrestricts a link when the caller supplies one', async () => {
		mockedGetIntent.mockResolvedValueOnce({ intent: 'infuse://stream' });

		await handler(
			post({ token: 'rd-key', hash: 'abc', link: 'https://real-debrid.com/d/XYZ' }),
			res
		);

		expect(mockedGetIntent).toHaveBeenCalledWith(
			'rd-key',
			'https://real-debrid.com/d/XYZ',
			'192.168.1.1',
			'windows',
			'vlc',
			'rd'
		);
		expect(mockedGetInstantIntent).not.toHaveBeenCalled();
	});

	it('forwards the file name so a shared file id cannot pick the wrong file', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		await handler(
			post({
				token: 'tb-key',
				hash: 'abc',
				service: 'tbw',
				fileId: '3',
				fileName: 'Episode.mkv',
			}),
			res
		);

		expect(mockedGetInstantIntent).toHaveBeenCalledWith(
			'tb-key',
			'abc',
			3,
			'192.168.1.1',
			'windows',
			'vlc',
			'tbw',
			'Episode.mkv'
		);
	});

	it('falls back to Real-Debrid when the service is not recognised', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		await handler(post({ token: 'tok', hash: 'abc', service: 'bogus' }), res);

		expect(mockedGetInstantIntent.mock.calls[0][6]).toBe('rd');
	});

	it('parses a string body', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ intent: 'vlc://stream' });

		await handler(post(JSON.stringify({ token: 'rd-key', hash: 'abc' })), res);

		expect(res._getStatusCode()).toBe(200);
	});

	it('rejects an unparseable body as a missing token', async () => {
		await handler(post('not json'), res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('rejects a request without a token', async () => {
		await handler(post({ hash: 'abc' }), res);

		expect(res._getStatusCode()).toBe(400);
		expect(mockedGetInstantIntent).not.toHaveBeenCalled();
	});

	it('rejects a request with neither hash nor link', async () => {
		await handler(post({ token: 'rd-key' }), res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('rejects a GET, which would put the token back in a URL', async () => {
		const req = createMockRequest({ method: 'GET', query: { os: 'windows', player: 'vlc' } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(405);
		expect(res._getHeaders()['Allow']).toBe('POST');
	});

	it('reports the resolver error when there is no intent', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({ error: "Torrent status is 'queued'" });

		await handler(post({ token: 'rd-key', hash: 'abc' }), res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: "Torrent status is 'queued'" });
	});

	it('reports a generic failure when the resolver gives no reason', async () => {
		mockedGetInstantIntent.mockResolvedValueOnce({});

		await handler(post({ token: 'rd-key', hash: 'abc' }), res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'No intent found for abc' });
	});
});
