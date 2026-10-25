import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MagnetStatus } from '@/services/allDebrid';
import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import fixture from '../test/fixtures/alldebrid-library-magnet.json';

const mocks = vi.hoisted(() => ({
	postMock: vi.fn(),
	showInfoForAD: vi.fn(),
}));

vi.mock('axios', () => ({
	default: {
		create: vi.fn(() => ({
			post: mocks.postMock,
			interceptors: {
				request: { use: vi.fn(), eject: vi.fn() },
				response: { use: vi.fn(), eject: vi.fn() },
			},
		})),
	},
}));

vi.mock('@/components/showInfo/index', () => ({
	showInfoForRD: vi.fn(),
	showInfoForAD: mocks.showInfoForAD,
	showInfoForTB: vi.fn(),
}));

vi.mock('@/components/modals/modal', () => ({
	default: { fire: vi.fn(), close: vi.fn(), showLoading: vi.fn() },
}));

import { handleShowInfoForAD } from './torrentInfo';

const libraryTorrent = (adData: MagnetStatus): UserTorrent => ({
	id: `ad:${adData.id}`,
	filename: adData.filename,
	title: adData.filename,
	hash: adData.hash!,
	bytes: adData.size,
	seeders: 0,
	progress: 100,
	status: UserTorrentStatus.finished,
	serviceStatus: adData.status,
	added: new Date(adData.uploadDate! * 1000),
	speed: 0,
	links: [],
	adData,
	mediaType: 'movie',
	selectedFiles: [],
});

describe('handleShowInfoForAD', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.postMock.mockResolvedValue({
			data: { status: 'success', data: fixture.magnetFiles },
		});
	});

	// The library comes from the list form of /magnet/status, which carries no
	// files, so the popup showed a Ready magnet with no files and no downloads.
	it('lists the files of a Ready library magnet', async () => {
		const adData = { ...fixture.listStatusMagnet, links: [] } as unknown as MagnetStatus;

		await handleShowInfoForAD(libraryTorrent(adData), 'key');

		const info = mocks.showInfoForAD.mock.calls[0][2];
		expect(info.links.map((l: { filename: string }) => l.filename)).toEqual([
			'Big Buck Bunny.en.srt',
			'Big Buck Bunny.mp4',
			'poster.jpg',
		]);
		expect(info.links[1].link).toBe(fixture.magnetFiles.magnets[0].files[1].l);
	});

	it('opens the popup without files when AllDebrid refuses the lookup', async () => {
		mocks.postMock.mockRejectedValue(new Error('network'));
		const adData = { ...fixture.listStatusMagnet, links: [] } as unknown as MagnetStatus;

		await handleShowInfoForAD(libraryTorrent(adData), 'key');

		expect(mocks.showInfoForAD.mock.calls[0][2].links).toEqual([]);
	});
});
