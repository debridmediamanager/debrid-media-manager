import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import type { Dispatch, SetStateAction } from 'react';

const modalMock = vi.hoisted(() => ({
	fire: vi.fn(),
	close: vi.fn(),
	showLoading: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/components/modals/modal', () => ({ default: modalMock }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));
vi.mock('@/services/torrin', () => ({
	getTorrinTorrentInfo: vi.fn(),
	unrestrictTorrinLink: vi.fn(),
}));
vi.mock('./deleteTorrent', () => ({ handleDeleteTrTorrent: vi.fn() }));

import { getTorrinTorrentInfo } from '@/services/torrin';
import { handleShowInfoForTorrin } from './torrinInfo';

const torrent: UserTorrent = {
	id: 'tr:abc123',
	filename: 'Sample.mkv',
	title: 'Sample',
	hash: 'abc',
	bytes: 123,
	progress: 100,
	status: UserTorrentStatus.finished,
	serviceStatus: 'downloaded',
	added: new Date('2023-01-01T00:00:00Z'),
	mediaType: 'movie',
	info: {} as any,
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
};

const setList = vi.fn() as unknown as (fn: (prev: UserTorrent[]) => UserTorrent[]) => void;
const setSelected = vi.fn() as unknown as Dispatch<SetStateAction<Set<string>>>;
const torrentDB = { deleteById: vi.fn() } as any;

describe('handleShowInfoForTorrin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		modalMock.fire.mockResolvedValue({});
	});

	it('fetches info by the un-prefixed id and opens a modal with the file list', async () => {
		vi.mocked(getTorrinTorrentInfo).mockResolvedValue({
			id: 'abc123',
			filename: 'Sample.Movie.2024.mkv',
			status: 'downloaded',
			bytes: 2147483648,
			files: [
				{ id: 1, path: 'Sample.Movie.2024.mkv', bytes: 2147483648, selected: 1 },
				{ id: 2, path: 'unselected.nfo', bytes: 10, selected: 0 },
			],
			links: ['https://tr/l1'],
		} as any);

		await handleShowInfoForTorrin(
			torrent,
			'https://tr.test',
			'key',
			setList,
			torrentDB,
			setSelected
		);

		expect(getTorrinTorrentInfo).toHaveBeenCalledWith('https://tr.test', 'key', 'abc123');
		expect(modalMock.showLoading).toHaveBeenCalled();
		expect(modalMock.fire).toHaveBeenCalledTimes(1);
		const html = modalMock.fire.mock.calls[0][0].html as string;
		expect(html).toContain('Sample.Movie.2024.mkv');
		// only the selected file gets a play button
		expect(html).toContain('data-tr-play="0"');
		expect(html).not.toContain('unselected.nfo');
	});

	it('escapes html in the filename', async () => {
		vi.mocked(getTorrinTorrentInfo).mockResolvedValue({
			id: 'abc123',
			filename: '<script>x</script>',
			status: 'downloaded',
			bytes: 1,
			files: [],
			links: [],
		} as any);

		await handleShowInfoForTorrin(
			torrent,
			'https://tr.test',
			'key',
			setList,
			torrentDB,
			setSelected
		);

		const html = modalMock.fire.mock.calls[0][0].html as string;
		expect(html).not.toContain('<script>x</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('closes the modal and toasts on fetch error', async () => {
		vi.mocked(getTorrinTorrentInfo).mockRejectedValue(new Error('offline'));

		await handleShowInfoForTorrin(
			torrent,
			'https://tr.test',
			'key',
			setList,
			torrentDB,
			setSelected
		);

		expect(modalMock.close).toHaveBeenCalled();
		expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('offline'));
		expect(modalMock.fire).not.toHaveBeenCalled();
	});
});
