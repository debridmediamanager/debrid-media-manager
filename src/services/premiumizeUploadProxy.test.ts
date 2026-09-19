import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { forwardPremiumizeTorrentUpload } from './premiumizeUploadProxy';

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('forwards multipart torrent bytes and their boundary unchanged', async () => {
	const bytes = new TextEncoder().encode('--boundary\r\nvalid torrent bytes\r\n--boundary--');
	fetchMock.mockResolvedValue({
		status: 200,
		headers: { get: () => 'application/json' },
		json: async () => ({ status: 'success', id: 'transfer-1', type: 'torrent' }),
	} as unknown as Response);

	const result = await forwardPremiumizeTorrentUpload(
		'secret',
		'multipart/form-data; boundary=boundary',
		bytes
	);

	const [url, init] = fetchMock.mock.calls[0];
	expect(url).toBe('https://www.premiumize.me/api/transfer/create');
	expect(init.headers).toEqual({
		Authorization: 'Bearer secret',
		'Content-Type': 'multipart/form-data; boundary=boundary',
	});
	expect(init.body).toBe(bytes);
	expect(result.body).toMatchObject({ status: 'success', id: 'transfer-1' });
});

it('refuses non-multipart input before contacting Premiumize', async () => {
	const result = await forwardPremiumizeTorrentUpload(
		'secret',
		'application/json',
		new Uint8Array()
	);

	expect(result.httpStatus).toBe(415);
	expect(fetchMock).not.toHaveBeenCalled();
});
