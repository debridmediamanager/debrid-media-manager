import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Dispatch, SetStateAction } from 'react';

import type { TorrentInfoResponse } from '@/services/types';
import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';

const showInfoSpy = vi.hoisted(() => vi.fn());
const reinsertSpy = vi.hoisted(() => vi.fn());
const modalMock = vi.hoisted(() => ({
	fire: vi.fn(),
	close: vi.fn(),
	showLoading: vi.fn(),
}));

vi.mock('@/components/showInfo/index', () => ({
	showInfoForRD: showInfoSpy,
	showInfoForAD: vi.fn(),
	showInfoForTB: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => ({
	getTorrentInfo: vi.fn(),
	addHashAsMagnet: vi.fn(),
	proxyUnrestrictLink: vi.fn(),
	selectFiles: vi.fn(),
}));

vi.mock('@/utils/addMagnet', () => ({
	handleReinsertTorrentinRd: reinsertSpy,
}));

vi.mock('@/components/modals/modal', () => ({
	default: modalMock,
}));

vi.mock('@/utils/deleteTorrent', () => ({
	handleDeleteRdTorrent: vi.fn(),
	handleDeleteAdTorrent: vi.fn(),
	handleDeleteTbTorrent: vi.fn(),
}));

vi.mock('@/utils/libraryFetching', () => ({
	fetchLatestRDTorrents: vi.fn(),
}));

import { getTorrentInfo } from '@/services/realDebrid';
import { handleReinsertTorrentinRd } from '@/utils/addMagnet';
import { handleDeleteRdTorrent } from '@/utils/deleteTorrent';

import { handleShowInfoForRD } from './torrentInfo';

describe('handleShowInfoForRD reinsert handler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		showInfoSpy.mockImplementation(async () => {});
	});

	it('preserves torrent metadata when reinserting from modal', async () => {
		const baseTorrent: UserTorrent = {
			id: 'rd:123',
			filename: 'Sample.mkv',
			title: 'Sample',
			hash: 'abc',
			bytes: 123,
			progress: 100,
			status: UserTorrentStatus.finished,
			serviceStatus: 'finished',
			added: new Date('2023-01-01T00:00:00Z'),
			mediaType: 'movie',
			info: undefined,
			links: ['link'],
			selectedFiles: [],
			seeders: 0,
			speed: 0,
		};

		let userTorrents: UserTorrent[] = [baseTorrent];
		const setUserTorrentsList = (updater: (prev: UserTorrent[]) => UserTorrent[]) => {
			userTorrents = updater(userTorrents);
		};

		let selected = new Set<string>([baseTorrent.id]);
		const setSelectedTorrents: Dispatch<SetStateAction<Set<string>>> = (value) => {
			if (typeof value === 'function') {
				selected = value(selected);
			} else {
				selected = value;
			}
		};

		const torrentInfo: TorrentInfoResponse = {
			id: '123',
			filename: 'Sample.mkv',
			original_filename: 'Sample.mkv',
			hash: 'abc',
			bytes: 123,
			original_bytes: 123,
			host: 'host',
			split: 0,
			progress: 100,
			status: 'downloaded',
			added: new Date('2023-01-01T00:00:00Z').toISOString(),
			files: [
				{
					id: 1,
					path: 'Sample.mkv',
					bytes: 123,
					selected: 1,
				},
			],
			links: ['link'],
			ended: new Date('2023-01-01T01:00:00Z').toISOString(),
			speed: 0,
			seeders: 0,
			fake: false,
		};

		const reinsertionInfo: TorrentInfoResponse = {
			...torrentInfo,
			id: '999',
			added: '2025-02-02T02:02:02.000Z',
			status: 'waiting_files_selection',
			progress: 0,
			seeders: 0,
			speed: 0,
			links: [],
		};

		vi.mocked(getTorrentInfo)
			.mockResolvedValueOnce(torrentInfo)
			.mockResolvedValueOnce(reinsertionInfo);
		vi.mocked(handleReinsertTorrentinRd).mockResolvedValue('rd:999');

		const torrentDB = {
			add: vi.fn(),
			upsert: vi.fn(),
			deleteById: vi.fn(),
			getById: vi.fn().mockResolvedValue(baseTorrent),
		} as any;

		let capturedHandlers: any = null;
		showInfoSpy.mockImplementation(
			async (_player, _key, _info, _imdb, _mediaType, _shouldDownload, handlers) => {
				capturedHandlers = handlers;
			}
		);

		await handleShowInfoForRD(
			baseTorrent,
			'rdKey',
			setUserTorrentsList,
			torrentDB,
			setSelectedTorrents
		);

		expect(capturedHandlers?.onReinsertRd).toBeTypeOf('function');

		await capturedHandlers.onReinsertRd(
			'rdKey',
			{ id: baseTorrent.id, hash: baseTorrent.hash } as UserTorrent,
			true,
			['file-1']
		);

		expect(handleReinsertTorrentinRd).toHaveBeenCalledWith(
			'rdKey',
			expect.objectContaining({
				id: baseTorrent.id,
				hash: baseTorrent.hash,
				filename: baseTorrent.filename,
				title: baseTorrent.title,
				mediaType: baseTorrent.mediaType,
			}),
			true,
			['file-1']
		);
		expect(getTorrentInfo).toHaveBeenLastCalledWith('rdKey', '999');

		expect(userTorrents).toHaveLength(1);
		expect(userTorrents[0]).toMatchObject({
			id: 'rd:999',
			title: baseTorrent.title,
			filename: baseTorrent.filename,
			mediaType: baseTorrent.mediaType,
			hash: baseTorrent.hash,
		});
		expect(userTorrents[0].added.toISOString()).toBe(reinsertionInfo.added);

		expect(selected.has(baseTorrent.id)).toBe(false);
		expect(torrentDB.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'rd:999',
				title: baseTorrent.title,
				added: expect.any(Date),
			})
		);
		expect(
			(vi.mocked(torrentDB.upsert).mock.calls[0][0] as UserTorrent).added.toISOString()
		).toBe(reinsertionInfo.added);
		expect(torrentDB.deleteById).toHaveBeenCalledWith(baseTorrent.id);
		expect(modalMock.close).toHaveBeenCalled();
	});

	it('removes torrent from list and selection when deleting from modal', async () => {
		const baseTorrent: UserTorrent = {
			id: 'rd:123',
			filename: 'Sample.mkv',
			title: 'Sample',
			hash: 'abc',
			bytes: 123,
			progress: 100,
			status: UserTorrentStatus.finished,
			serviceStatus: 'finished',
			added: new Date('2023-01-01T00:00:00Z'),
			mediaType: 'movie',
			info: undefined,
			links: ['link'],
			selectedFiles: [],
			seeders: 0,
			speed: 0,
		};

		let userTorrents: UserTorrent[] = [baseTorrent];
		const setUserTorrentsList = (updater: (prev: UserTorrent[]) => UserTorrent[]) => {
			userTorrents = updater(userTorrents);
		};

		let selected = new Set<string>([baseTorrent.id]);
		const setSelectedTorrents: Dispatch<SetStateAction<Set<string>>> = (value) => {
			if (typeof value === 'function') {
				selected = value(selected);
			} else {
				selected = value;
			}
		};

		const torrentInfo: TorrentInfoResponse = {
			id: '123',
			filename: 'Sample.mkv',
			original_filename: 'Sample.mkv',
			hash: 'abc',
			bytes: 123,
			original_bytes: 123,
			host: 'host',
			split: 0,
			progress: 100,
			status: 'downloaded',
			added: new Date('2023-01-01T00:00:00Z').toISOString(),
			files: [
				{
					id: 1,
					path: 'Sample.mkv',
					bytes: 123,
					selected: 1,
				},
			],
			links: ['link'],
			ended: new Date('2023-01-01T01:00:00Z').toISOString(),
			speed: 0,
			seeders: 0,
			fake: false,
		};

		vi.mocked(getTorrentInfo).mockResolvedValue(torrentInfo);

		const torrentDB = {
			add: vi.fn(),
			upsert: vi.fn(),
			deleteById: vi.fn(),
			getById: vi.fn().mockResolvedValue(baseTorrent),
		} as any;

		let capturedHandlers: any = null;
		showInfoSpy.mockImplementation(
			async (_player, _key, _info, _imdb, _mediaType, _shouldDownload, handlers) => {
				capturedHandlers = handlers;
			}
		);

		await handleShowInfoForRD(
			baseTorrent,
			'rdKey',
			setUserTorrentsList,
			torrentDB,
			setSelectedTorrents
		);

		expect(capturedHandlers?.onDeleteRd).toBeTypeOf('function');
		vi.mocked(handleDeleteRdTorrent).mockResolvedValue(true);

		await capturedHandlers.onDeleteRd('rdKey', baseTorrent.id);

		expect(handleDeleteRdTorrent).toHaveBeenCalledWith('rdKey', baseTorrent.id);
		expect(userTorrents).toHaveLength(0);
		expect(selected.has(baseTorrent.id)).toBe(false);
		expect(torrentDB.deleteById).toHaveBeenCalledWith(baseTorrent.id);
		expect(modalMock.close).toHaveBeenCalled();
	});
});
