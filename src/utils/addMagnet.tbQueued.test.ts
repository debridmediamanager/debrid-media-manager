import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import queuedReply from '../test/fixtures/torbox/createtorrent-queued-zurg-228.json';
import mylistEntry from '../test/fixtures/torbox/mylist-entry-349-files-2026-10-22.json';
import { handleAddAsMagnetInTb } from './addMagnet';

const mocks = vi.hoisted(() => ({
	createTorrent: vi.fn(),
	getTorrentList: vi.fn(),
}));

vi.mock('@/services/torbox', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		createTorrent: mocks.createTorrent,
		getTorrentList: mocks.getTorrentList,
	};
});

vi.mock('@/services/realDebrid');
vi.mock('@/services/allDebrid');
vi.mock('./deleteTorrent');

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	}),
}));

describe('a TorBox add with no free slot', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createTorrent.mockResolvedValue(queuedReply);
		// mylist without an id answers with the whole library, measured live 2026-10-30.
		mocks.getTorrentList.mockResolvedValue({ success: true, data: [mylistEntry] });
	});

	it('writes no library row, because the reply has no torrent to read', async () => {
		const callback = vi.fn();

		await handleAddAsMagnetInTb('tb-key', 'a'.repeat(40), callback);

		expect(callback).not.toHaveBeenCalled();
		expect(mocks.getTorrentList).not.toHaveBeenCalled();
	});

	it('tells the user it is queued rather than added', async () => {
		await handleAddAsMagnetInTb('tb-key', 'a'.repeat(40));

		expect(toast.success).toHaveBeenCalledWith(
			'Queued on TorBox until a slot is free.',
			expect.any(Object)
		);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('stays quiet for a bulk caller', async () => {
		await handleAddAsMagnetInTb('tb-key', 'a'.repeat(40), undefined, true);

		expect(toast.success).not.toHaveBeenCalled();
	});
});
