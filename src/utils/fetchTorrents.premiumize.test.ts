import { UserTorrentStatus } from '@/torrent/userTorrent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listPremiumizeTransfers: vi.fn(),
	listPremiumizeFolder: vi.fn(),
	listAllPremiumizeItems: vi.fn(),
	resolvePremiumizeTransferHashes: vi.fn(),
}));

vi.mock('@/services/premiumize', () => mocks);
vi.mock('@/services/allDebrid', () => ({ getMagnetStatus: vi.fn() }));
vi.mock('@/services/realDebrid', () => ({ getUserTorrentsList: vi.fn() }));
vi.mock('@/services/torbox', () => ({ getTorrentList: vi.fn(), getWebDownloadList: vi.fn() }));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: { error: (...args: unknown[]) => toastError(...args) },
	toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import {
	buildPremiumizeRowSources,
	convertToPremiumizeUserTorrent,
	fetchPremiumize,
} from './fetchTorrents';

const CREATED = 1787442631;

const item = (id: string, name: string, path: string, size: number) => ({
	id,
	name,
	created_at: CREATED,
	size,
	path,
});

const transfer = (over: Record<string, unknown> = {}) => ({
	id: 'C_c5ShzmbWdwiIc-KMP_5A',
	name: 'Big Buck Bunny',
	message: null,
	status: 'finished',
	progress: null,
	folder_id: 'hp92DFAmxWqvNFC_IzGbWw',
	file_id: null,
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('buildPremiumizeRowSources', () => {
	const rootFolder = { id: 'hp92DFAmxWqvNFC_IzGbWw', name: 'Big Buck Bunny', type: 'folder' };

	it('joins a transfer to its folder contents through the folder name', () => {
		const sources = buildPremiumizeRowSources(
			[transfer()],
			[rootFolder as any],
			[
				item('f1', 'Big Buck Bunny.mp4', 'Big Buck Bunny/Big Buck Bunny.mp4', 276134947),
				item('f2', 'poster.jpg', 'Big Buck Bunny/poster.jpg', 310380),
				item('f3', 'other.mkv', 'Something Else/other.mkv', 5),
			]
		);

		expect(sources).toHaveLength(1);
		expect(sources[0].kind).toBe('transfer');
		expect(sources[0].files.map((f) => f.id)).toEqual(['f1', 'f2']);
	});

	it('claims files nested below the top folder', () => {
		const sources = buildPremiumizeRowSources(
			[transfer({ name: 'Show S01' })],
			[{ id: 'hp92DFAmxWqvNFC_IzGbWw', name: 'Show S01', type: 'folder' } as any],
			[item('f1', 'ep1.mkv', 'Show S01/Season 1/ep1.mkv', 10)]
		);

		expect(sources[0].files).toHaveLength(1);
	});

	it('handles the single-file shape, where file_id is set and folder_id is not', () => {
		const sources = buildPremiumizeRowSources(
			[transfer({ folder_id: null, file_id: 'r9Bo', name: '1Mb.dat' })],
			[{ id: 'r9Bo', name: '1Mb.dat', type: 'file' } as any],
			[item('r9Bo', '1Mb.dat', '1Mb.dat', 1048576)]
		);

		expect(sources).toHaveLength(1);
		expect(sources[0].files.map((f) => f.id)).toEqual(['r9Bo']);
	});

	it('keeps a transfer with neither id - queued, errored or on an external cloud', () => {
		const sources = buildPremiumizeRowSources(
			[transfer({ folder_id: null, file_id: null, status: 'running', progress: 0.42 })],
			[],
			[]
		);

		expect(sources).toHaveLength(1);
		expect(sources[0].files).toEqual([]);
	});

	it('surfaces cloud content whose transfer record was cleared', () => {
		// transfer/clearfinished removes records and leaves every file in place,
		// so a transfer-only library would show this user nothing.
		const sources = buildPremiumizeRowSources(
			[],
			[rootFolder as any, { id: 'x1', name: 'loose.mkv', type: 'file' } as any],
			[
				item('f1', 'Big Buck Bunny.mp4', 'Big Buck Bunny/Big Buck Bunny.mp4', 10),
				item('x1', 'loose.mkv', 'loose.mkv', 20),
			]
		);

		expect(sources.map((s) => s.kind)).toEqual(['folder', 'file']);
		expect(sources[0].files).toHaveLength(1);
		expect(sources[1].files).toHaveLength(1);
	});

	it('does not list a folder twice when a transfer already owns it', () => {
		const sources = buildPremiumizeRowSources([transfer()], [rootFolder as any], []);
		expect(sources).toHaveLength(1);
		expect(sources[0].kind).toBe('transfer');
	});
});

describe('convertToPremiumizeUserTorrent', () => {
	const source = (over: Record<string, unknown> = {}) =>
		({
			kind: 'transfer' as const,
			id: 'abc',
			name: 'Big Buck Bunny (2008) 1080p',
			files: [item('f1', 'Big Buck Bunny.mp4', 'x/Big Buck Bunny.mp4', 276134947)],
			transfer: transfer(),
			...over,
		}) as any;

	it('reports a finished transfer at 100% despite a null progress', () => {
		// Premiumize documents 1.0 for a finished transfer and returns null, so
		// progress * 100 renders NaN unless it is coalesced.
		const torrent = convertToPremiumizeUserTorrent(source(), 'dd8255ec');

		expect(torrent.progress).toBe(100);
		expect(torrent.status).toBe(UserTorrentStatus.finished);
		expect(Number.isNaN(torrent.progress)).toBe(false);
	});

	it('scales a running transfer progress from a 0-1 float', () => {
		const torrent = convertToPremiumizeUserTorrent(
			source({ transfer: transfer({ status: 'running', progress: 0.42 }) }),
			''
		);

		expect(torrent.status).toBe(UserTorrentStatus.downloading);
		expect(torrent.progress).toBe(42);
	});

	it('treats seeding as finished - the file is already in the cloud', () => {
		const torrent = convertToPremiumizeUserTorrent(
			source({ transfer: transfer({ status: 'seeding', progress: 1 }) }),
			''
		);

		expect(torrent.status).toBe(UserTorrentStatus.finished);
		expect(torrent.progress).toBe(100);
	});

	it('treats a row with no transfer as stored and complete', () => {
		const torrent = convertToPremiumizeUserTorrent(
			source({ kind: 'folder', transfer: undefined }),
			''
		);

		expect(torrent.serviceStatus).toBe('stored');
		expect(torrent.status).toBe(UserTorrentStatus.finished);
		expect(torrent.progress).toBe(100);
		expect(torrent.id.startsWith('pm:')).toBe(true);
	});

	it('sums file sizes, since no Premiumize endpoint reports a transfer size', () => {
		const torrent = convertToPremiumizeUserTorrent(
			source({
				files: [item('a', 'a.mkv', 'x/a.mkv', 100), item('b', 'b.mkv', 'x/b.mkv', 250)],
			}),
			''
		);

		expect(torrent.bytes).toBe(350);
	});

	it('dates the row from its earliest file, the only timestamp available', () => {
		const torrent = convertToPremiumizeUserTorrent(
			source({
				files: [
					{ ...item('a', 'a.mkv', 'x/a.mkv', 1), created_at: CREATED + 500 },
					{ ...item('b', 'b.mkv', 'x/b.mkv', 1), created_at: CREATED },
				],
			}),
			''
		);

		expect(torrent.added).toEqual(new Date(CREATED * 1000));
	});

	it('stores no links - they expire and re-minting is free', () => {
		const torrent = convertToPremiumizeUserTorrent(source(), 'dd8255ec');

		expect(torrent.links).toEqual([]);
		expect(torrent.selectedFiles[0]).toMatchObject({
			fileId: 'f1',
			filename: 'Big Buck Bunny.mp4',
		});
	});
});

describe('fetchPremiumize', () => {
	it('builds the whole library from three calls and resolves transfer hashes only', async () => {
		mocks.listPremiumizeTransfers.mockResolvedValue([transfer()]);
		mocks.listPremiumizeFolder.mockResolvedValue({
			content: [
				{ id: 'hp92DFAmxWqvNFC_IzGbWw', name: 'Big Buck Bunny', type: 'folder' },
				{ id: 'orphan', name: 'Old Folder', type: 'folder' },
			],
		});
		mocks.listAllPremiumizeItems.mockResolvedValue([
			item('f1', 'Big Buck Bunny.mp4', 'Big Buck Bunny/Big Buck Bunny.mp4', 10),
			item('f2', 'old.mkv', 'Old Folder/old.mkv', 20),
		]);
		mocks.resolvePremiumizeTransferHashes.mockResolvedValue({
			'C_c5ShzmbWdwiIc-KMP_5A': 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
		});

		const callback = vi.fn();
		await fetchPremiumize('pm-key', callback);

		const [torrents] = callback.mock.calls[0];
		expect(torrents).toHaveLength(2);
		expect(torrents[0].hash).toBe('dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c');
		// The orphan folder has no transfer, so job/src cannot recover a hash for it
		expect(torrents[1].hash).toBe('');
		expect(mocks.resolvePremiumizeTransferHashes).toHaveBeenCalledWith('pm-key', [
			'C_c5ShzmbWdwiIc-KMP_5A',
		]);
	});

	it('skips the hash lookup entirely for an empty account', async () => {
		mocks.listPremiumizeTransfers.mockResolvedValue([]);
		mocks.listPremiumizeFolder.mockResolvedValue({ content: [] });
		mocks.listAllPremiumizeItems.mockResolvedValue([]);

		const callback = vi.fn();
		await fetchPremiumize('pm-key', callback);

		expect(callback).toHaveBeenCalledWith([]);
		expect(mocks.resolvePremiumizeTransferHashes).not.toHaveBeenCalled();
	});

	it('degrades to an empty library rather than throwing at the caller', async () => {
		mocks.listPremiumizeTransfers.mockRejectedValue(new Error('Not logged in.'));
		mocks.listPremiumizeFolder.mockResolvedValue({ content: [] });
		mocks.listAllPremiumizeItems.mockResolvedValue([]);

		const callback = vi.fn();
		await fetchPremiumize('pm-key', callback);

		expect(callback).toHaveBeenCalledWith([]);
		expect(toastError).toHaveBeenCalled();
	});
});
