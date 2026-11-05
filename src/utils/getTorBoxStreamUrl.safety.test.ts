import type { TorBoxTorrentInfo } from '@/services/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import expiredState from './fixtures/torbox-expired-state.json';
import fixture from './fixtures/torbox-held-torrent.json';

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: vi.fn(),
	createTorrent: vi.fn(),
	deleteTorrent: vi.fn(),
	getTorrentList: vi.fn(),
	getWebDownloadList: vi.fn(),
	requestDownloadLink: vi.fn(),
	requestWebDownloadLink: vi.fn(),
}));
vi.mock('@/utils/delay', () => ({ delay: vi.fn().mockResolvedValue(undefined) }));

import * as tb from '@/services/torbox';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
	getOwnedTorBoxStreamUrl,
	getTorBoxStreamUrl,
	getTorBoxStreamUrlKeepTorrent,
	getWebDownloadStreamUrlByHash,
} from './getTorBoxStreamUrl';

// The captured row permits nulls omitted by the historical TypeScript interface.
const held = fixture.tb_mylist_entry_same_hash.body.data[0] as unknown as TorBoxTorrentInfo;
const key = 'synthetic-key';
const url = 'https://example.test/stream';
const ok = <T>(data: T) => ({ success: true, error: null, detail: '', data });
const resolvers = [
	['by id', () => getTorBoxStreamUrl(key, held.hash, 10, 'movie')],
	[
		'by name',
		() => getFileByNameTorBoxStreamUrl(key, held.hash, 'Sintel.mp4', { releaseIfAdded: true }),
	],
	['biggest', () => getBiggestFileTorBoxStreamUrl(key, held.hash, { releaseIfAdded: true })],
] as const;

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(tb.checkCachedStatus).mockResolvedValue(
		ok({ [held.hash]: { name: held.name, size: held.size, hash: held.hash } })
	);
	vi.mocked(tb.createTorrent).mockResolvedValue(fixture.tb_createtorrent_existing.body);
	vi.mocked(tb.requestDownloadLink).mockResolvedValue(ok(url));
	vi.mocked(tb.deleteTorrent).mockResolvedValue(ok(null));
});

describe.each(resolvers)('TorBox ownership %s', (_name, resolve) => {
	it.each(['HTTP error', 'business error'])(
		'never deletes a held id after an unknown lookup: %s',
		async (failure) => {
			const list = vi.mocked(tb.getTorrentList).mockResolvedValue(ok([held]));
			if (failure === 'HTTP error') list.mockRejectedValueOnce(new Error('unavailable'));
			else list.mockResolvedValueOnce({ ...ok([]), success: false });
			if (_name === 'by id')
				vi.mocked(tb.requestDownloadLink).mockResolvedValue({ ...ok(''), success: false });
			await resolve().catch(() => undefined);
			expect(tb.deleteTorrent).not.toHaveBeenCalled();
		}
	);

	it('finds a held torrent beyond the first thousand without re-adding or deleting it', async () => {
		vi.mocked(tb.getTorrentList).mockImplementation(async (_key, params) =>
			ok(
				params?.id
					? [held]
					: params?.offset === 1000
						? [held]
						: Array.from({ length: 1000 }, (_, i) => ({
								...held,
								id: i + 1,
								hash: String(i),
							}))
			)
		);
		await resolve();
		expect(tb.createTorrent).not.toHaveBeenCalled();
		expect(tb.deleteTorrent).not.toHaveBeenCalled();
	});

	it('polls an existing unfinished torrent without re-adding or deleting it', async () => {
		vi.mocked(tb.getTorrentList)
			.mockResolvedValueOnce(
				ok([
					{
						...held,
						download_finished: false,
						download_present: false,
						download_state: 'downloading',
					},
				])
			)
			.mockResolvedValue(ok([held]));
		await resolve();
		expect(tb.createTorrent).not.toHaveBeenCalled();
		expect(tb.deleteTorrent).not.toHaveBeenCalled();
	});

	it('does not delete an id already seen under another hash', async () => {
		vi.mocked(tb.getTorrentList)
			.mockResolvedValueOnce(ok([{ ...held, hash: 'other' }]))
			.mockResolvedValue(ok([held]));
		vi.mocked(tb.requestDownloadLink).mockResolvedValue({ ...ok(''), success: false });
		await expect(resolve()).rejects.toThrow('Failed to get download link');
		expect(tb.deleteTorrent).not.toHaveBeenCalled();
	});
});

describe('TorBox presence gate', () => {
	it.each([
		...resolvers,
		['keep', () => getTorBoxStreamUrlKeepTorrent(key, held.hash, 10, 'movie')],
		['owned', () => getOwnedTorBoxStreamUrl(key, held.hash)],
	] as const)('does not mint an expired entry through %s', async (_name, resolve) => {
		// Recorded provider transition: finished remains true after content disappears.
		vi.mocked(tb.getTorrentList).mockResolvedValue(ok([{ ...held, ...expiredState }]));
		await resolve().catch(() => undefined);
		expect(tb.requestDownloadLink).not.toHaveBeenCalled();
		expect(tb.deleteTorrent).not.toHaveBeenCalled();
	});

	it('waits until both finished and present before minting', async () => {
		vi.mocked(tb.getTorrentList)
			.mockResolvedValueOnce(ok([]))
			.mockResolvedValueOnce(
				ok([{ ...held, download_finished: false, download_present: false }])
			)
			.mockResolvedValue(ok([held]));
		await getBiggestFileTorBoxStreamUrl(key, held.hash);
		expect(tb.getTorrentList).toHaveBeenCalledTimes(3);
	});
});

it('finds a web download beyond the first thousand', async () => {
	vi.mocked(tb.getWebDownloadList).mockImplementation(async (_key, params) =>
		ok(
			params?.offset === 1000
				? [held]
				: Array.from({ length: 1000 }, (_, i) => ({ ...held, id: i + 1, hash: String(i) }))
		)
	);
	vi.mocked(tb.requestWebDownloadLink).mockResolvedValue(ok(url));
	await expect(getWebDownloadStreamUrlByHash(key, held.hash)).resolves.toBe(url);
});
