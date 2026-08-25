import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkCachedStatus,
	controlTorrent,
	createTorrent,
	deleteTorrent,
	exportTorrentData,
	getTorrentInfo,
	getTorrentList,
	getUserData,
	requestDownloadLink,
} from './torbox';

const mocks = vi.hoisted(() => ({
	postMock: vi.fn(),
	getMock: vi.fn(),
	requestMock: vi.fn(),
}));

const axiosInstance = {
	post: mocks.postMock,
	get: mocks.getMock,
	interceptors: {
		request: { use: vi.fn(), eject: vi.fn() },
		response: { use: vi.fn(), eject: vi.fn() },
	},
	request: mocks.requestMock,
};

vi.mock('axios', () => ({
	default: {
		create: vi.fn(() => ({
			post: mocks.postMock,
			get: mocks.getMock,
			interceptors: {
				request: { use: vi.fn(), eject: vi.fn() },
				response: { use: vi.fn(), eject: vi.fn() },
			},
			request: mocks.requestMock,
		})),
	},
}));

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			torboxHostname: 'https://api.torbox.test',
		},
	}),
}));

describe('torbox service helpers', () => {
	beforeEach(() => {
		Object.values(axiosInstance).forEach((prop) => {
			if (typeof prop === 'function') {
				prop.mockClear?.();
			}
		});
		axiosInstance.post.mockReset();
		axiosInstance.get.mockReset();
		axiosInstance.post.mockResolvedValue({ data: { success: true } });
		axiosInstance.get.mockResolvedValue({ data: { success: true, data: [] } });
	});

	it('creates torrents with magnet payloads', async () => {
		await createTorrent('token', { magnet: 'magnet:?xt=urn:btih:abc' });
		expect(axiosInstance.post).toHaveBeenCalled();
		const formData = axiosInstance.post.mock.calls[0][1] as FormData;
		expect(formData.get('magnet')).toBe('magnet:?xt=urn:btih:abc');
	});

	it('controls and deletes torrents through helper', async () => {
		await controlTorrent('token', { operation: 'stop_seeding', torrent_id: 5 });
		expect(axiosInstance.post).toHaveBeenCalledWith(
			expect.stringContaining('/controltorrent'),
			expect.objectContaining({ operation: 'stop_seeding', torrent_id: 5 }),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer token' }),
			})
		);

		await deleteTorrent('token', 2);
		expect(axiosInstance.post).toHaveBeenCalledWith(
			expect.stringContaining('/controltorrent'),
			expect.objectContaining({ operation: 'delete', torrent_id: 2 }),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer token' }),
			})
		);
	});

	it('fetches torrent list with cache-busting params', async () => {
		await getTorrentList('token', { limit: 5 });
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/mylist'),
			expect.objectContaining({
				params: expect.objectContaining({
					bypass_cache: true,
					limit: 5,
					_fresh: expect.any(Number),
				}),
			})
		);
	});

	it('requests download links with token fallbacks', async () => {
		await requestDownloadLink('token', { torrent_id: 10 });
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/requestdl'),
			expect.objectContaining({
				params: expect.objectContaining({ torrent_id: 10, token: 'token' }),
			})
		);
	});

	it('checks cached status for multiple hashes', async () => {
		await checkCachedStatus({ hash: ['a', 'b'] }, 'token');
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/checkcached'),
			expect.objectContaining({
				params: expect.objectContaining({ hash: 'a,b', format: 'object' }),
				headers: expect.objectContaining({ Authorization: 'Bearer token' }),
			})
		);
	});

	it('exports torrent data as file or magnet string', async () => {
		axiosInstance.get
			.mockResolvedValueOnce({ data: new Blob([]) })
			.mockResolvedValueOnce({ data: { success: true, data: 'magnet-data' } });

		const fileResponse = await exportTorrentData('token', { torrent_id: 1, type: 'file' });
		expect(fileResponse).toBeInstanceOf(Blob);
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/exportdata'),
			expect.objectContaining({ responseType: 'blob' })
		);

		const magnetResponse = await exportTorrentData('token', { torrent_id: 1, type: 'magnet' });
		expect((magnetResponse as any).data).toBe('magnet-data');
	});

	it('fetches torrent info using GET when only hash provided', async () => {
		await getTorrentInfo({ hash: 'abcd' });
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/torrentinfo'),
			expect.objectContaining({ params: { hash: 'abcd' } })
		);
	});

	it('retrieves user data via torbox API', async () => {
		await getUserData('token');
		expect(axiosInstance.get).toHaveBeenCalledWith(
			expect.stringContaining('/user/me'),
			expect.objectContaining({ params: { settings: undefined } })
		);
	});
});
