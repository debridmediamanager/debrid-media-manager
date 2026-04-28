import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import { handleChangeType } from './libraryTypeManagement';

const createTorrent = (overrides: Partial<UserTorrent> = {}): UserTorrent => ({
	id: '1',
	filename: 'movie.mkv',
	title: 'Movie',
	hash: 'hash',
	bytes: 100,
	progress: 0,
	status: UserTorrentStatus.waiting,
	serviceStatus: 'queued',
	added: new Date(),
	mediaType: 'movie',
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
	...overrides,
});

describe('handleChangeType', () => {
	it('cycles through media types and persists the change', async () => {
		const torrent = createTorrent();
		const initialList: UserTorrent[] = [torrent, createTorrent({ id: '2', mediaType: 'tv' })];
		let updatedList = initialList;
		const setUserTorrentsList = (fn: (prev: UserTorrent[]) => UserTorrent[]) => {
			updatedList = fn(updatedList);
		};
		const addMock = vi.fn();

		await handleChangeType(torrent, setUserTorrentsList, { add: addMock } as any);

		expect(torrent.mediaType).toBe('tv');
		expect(updatedList?.[0].mediaType).toBe('tv');
		expect(addMock).toHaveBeenCalledWith(torrent);
	});
});
