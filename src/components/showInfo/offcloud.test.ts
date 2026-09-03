import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	modalFireMock: vi.fn(),
	modalShowLoadingMock: vi.fn(),
	modalCloseMock: vi.fn(),
	handleShareMock: vi.fn(),
	bindWatchButtonsMock: vi.fn(),
	exploreMock: vi.fn(),
	cacheInfoMock: vi.fn(),
	cloudStatusMock: vi.fn(),
	deleteOcMock: vi.fn(),
}));

vi.mock('../modals/modal', () => ({
	__esModule: true,
	default: {
		fire: mocks.modalFireMock,
		showLoading: mocks.modalShowLoadingMock,
		close: mocks.modalCloseMock,
		showValidationMessage: vi.fn(),
		DismissReason: {},
	},
}));

vi.mock('axios', () => {
	const axiosMock: any = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
	axiosMock.create = vi.fn(() => axiosMock);
	axiosMock.interceptors = {
		request: { use: vi.fn(), eject: vi.fn() },
		response: { use: vi.fn(), eject: vi.fn() },
	};
	return { __esModule: true, default: axiosMock, ...axiosMock };
});

vi.mock('../../utils/hashList', () => ({
	__esModule: true,
	handleShare: mocks.handleShareMock,
}));

vi.mock('./watchButtons', () => ({
	__esModule: true,
	bindWatchButtons: mocks.bindWatchButtonsMock,
}));

// `joinExploreWithCacheInfo` is the real one - pairing anonymous explore links
// with cache/info's named files is exactly what the modal depends on.
vi.mock('@/services/offcloud', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/offcloud')>()),
	exploreOffcloudCloud: mocks.exploreMock,
	getOffcloudCacheInfo: mocks.cacheInfoMock,
	getOffcloudCloudStatus: mocks.cloudStatusMock,
}));

vi.mock('@/utils/deleteTorrent', () => ({
	__esModule: true,
	handleDeleteAdTorrent: vi.fn(),
	handleDeleteOcTorrent: mocks.deleteOcMock,
	handleDeletePmTorrent: vi.fn(),
	handleDeleteRdTorrent: vi.fn(),
	handleDeleteTbTorrent: vi.fn(),
}));

import { showInfoForOC } from './index';

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/100000001/1/tok/sig';

const row = (over: Record<string, unknown> = {}) => ({
	id: 'oc:req-1',
	hash: HASH,
	filename: 'Big Buck Bunny',
	title: 'Big Buck Bunny',
	bytes: 0,
	serviceStatus: 'downloaded',
	progress: 100,
	added: new Date('2026-09-02T10:11:12.000Z'),
	...over,
});

const htmlOfLastModal = () => mocks.modalFireMock.mock.calls.at(-1)![0].html as string;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.modalFireMock.mockResolvedValue({ isConfirmed: false });
	mocks.handleShareMock.mockResolvedValue('/hashlist#share');
	mocks.exploreMock.mockResolvedValue([`${CDN}/Big%20Buck%20Bunny.mp4`]);
	mocks.cacheInfoMock.mockResolvedValue([
		{
			source: `magnet:?xt=urn:btih:${HASH}`,
			cached: true,
			files: [{ folder: 'Big Buck Bunny', filename: 'Big Buck Bunny.mp4', size: 276134947 }],
		},
	]);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('showInfoForOC', () => {
	it('assembles the listing from explore plus cache/info', async () => {
		await showInfoForOC('mac2', 'oc-key', row());

		expect(mocks.exploreMock).toHaveBeenCalledWith('oc-key', 'req-1');
		// The hash goes to the client, which is where it is put into magnet form -
		// a bare hash reaching `/cache/info` silently reports cached content as
		// uncached, so nothing here may build that request itself.
		expect(mocks.cacheInfoMock).toHaveBeenCalledWith('oc-key', [HASH]);

		const html = htmlOfLastModal();
		expect(html).toContain('Big Buck Bunny.mp4');
		// The size came from cache/info, not from the row, which carries none.
		expect(html).toContain('0.26 GB');
		expect(html).not.toContain('oc-key');
	});

	it('refuses a row id that addresses nothing', async () => {
		await showInfoForOC('mac2', 'oc-key', row({ id: 'oc:' }));

		expect(mocks.modalFireMock).not.toHaveBeenCalled();
		expect(mocks.exploreMock).not.toHaveBeenCalled();
	});

	// One poll, not a loop: cloud/status takes a single requestId per call and a
	// zombie would never change however long it were watched.
	it('polls once for a fresher status on an unstarted row', async () => {
		mocks.cloudStatusMock.mockResolvedValue({
			requestId: 'req-1',
			status: 'downloading',
			fileName: 'Big Buck Bunny',
			progress: 42,
			message: null,
		});

		await showInfoForOC('mac2', 'oc-key', row({ serviceStatus: 'created', progress: 0 }));

		expect(mocks.cloudStatusMock).toHaveBeenCalledTimes(1);
		const html = htmlOfLastModal();
		expect(html).toContain('Downloading');
		expect(html).toContain('42%');
		// Nothing to explore until it finishes.
		expect(mocks.exploreMock).not.toHaveBeenCalled();
	});

	// Offcloud never times a stuck item out, so the only way out is an explicit
	// removal and the modal has to offer it.
	it('offers the escape hatch for an item still stuck in created', async () => {
		mocks.cloudStatusMock.mockResolvedValue({
			requestId: 'req-1',
			status: 'created',
			fileName: 'Big Buck Bunny',
			progress: null,
			message: 'Loading...',
		});

		await showInfoForOC('mac2', 'oc-key', row({ serviceStatus: 'created', progress: 0 }));

		const html = htmlOfLastModal();
		expect(html).toContain('btn-remove-stuck-oc');
		expect(html).toContain('Remove stuck item');
	});

	it('does not offer the escape hatch on a finished item', async () => {
		await showInfoForOC('mac2', 'oc-key', row());

		expect(htmlOfLastModal()).not.toContain('btn-remove-stuck-oc');
	});

	// A plain HTTP submission has no info hash, so nothing magnet-shaped applies
	// - and cache/info cannot be asked about it either.
	it('drops the magnet actions and the cache lookup for a hashless row', async () => {
		await showInfoForOC('mac2', 'oc-key', row({ hash: '' }));

		expect(mocks.cacheInfoMock).not.toHaveBeenCalled();
		const html = htmlOfLastModal();
		expect(html).not.toContain('btn-magnet-copy-oc');
		expect(html).toContain('not a torrent submission');
		// The links still list - explore does not need the hash.
		expect(html).toContain('Big Buck Bunny.mp4');
	});

	it('still lists the links when cache/info fails', async () => {
		mocks.cacheInfoMock.mockRejectedValue(new Error('boom'));

		await showInfoForOC('mac2', 'oc-key', row());

		expect(htmlOfLastModal()).toContain('Big Buck Bunny.mp4');
	});
});
