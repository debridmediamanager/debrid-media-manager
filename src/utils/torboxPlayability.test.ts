import { getTorrentList, getUsenetList, getWebDownloadList } from '@/services/torbox';
import type { TorBoxTorrentInfo } from '@/services/types';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { beforeEach, expect, it, vi } from 'vitest';
import { convertToTbUserTorrent, convertToTbWebDownloadUserTorrent } from './fetchTorrents';
import expiredState from './fixtures/torbox-expired-state.json';
import fixture from './fixtures/torbox-held-torrent.json';
import { getTorBoxDMMLibrary, getTorBoxDMMTorrent } from './torboxCastCatalogHelper';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorBoxCastProfile: vi.fn(async () => ({ apiKey: 'synthetic' })),
		identifyLibraryHashes: vi.fn(async () => new Map()),
	},
}));
vi.mock('@/services/torbox', () => ({
	getTorrentList: vi.fn(),
	getWebDownloadList: vi.fn(),
	getUsenetList: vi.fn(),
}));

// The captured provider row permits nulls omitted by the historical TS interface.
const held = fixture.tb_mylist_entry_same_hash.body.data[0] as unknown as TorBoxTorrentInfo;
const expired = { ...held, ...expiredState };
const ok = <T>(data: T) => ({ success: true, error: null, detail: '', data });

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getTorrentList).mockResolvedValue(ok([expired]));
	vi.mocked(getWebDownloadList).mockResolvedValue(ok([]));
	vi.mocked(getUsenetList).mockResolvedValue(ok([]));
});

it.each([convertToTbUserTorrent, convertToTbWebDownloadUserTorrent])(
	'does not mark expired content finished: %s',
	(convert) => {
		expect(convert(expired).status).toBe(UserTorrentStatus.error);
		expect(convert({ ...held, download_state: 'stalled (no seeds)' }).status).toBe(
			UserTorrentStatus.finished
		);
		expect(
			convert({ ...held, download_finished: false, download_state: 'seeding' }).status
		).not.toBe(UserTorrentStatus.finished);
	}
);

it('omits expired catalog entries without hiding the following playable page', async () => {
	vi.mocked(getTorrentList).mockImplementation(async (_key, params) =>
		ok(
			params?.offset
				? [held]
				: Array.from({ length: 1000 }, (_, i) => ({ ...expired, id: i }))
		)
	);
	const result = await getTorBoxDMMLibrary('user', 1);
	expect(result.data?.metas.map((m) => m.id)).toEqual([`dmm-tb:${held.id}`]);
});

it('does not advertise file playback for expired metadata', async () => {
	const result = await getTorBoxDMMTorrent('user', String(held.id));
	expect(result.status).toBe(404);
});
