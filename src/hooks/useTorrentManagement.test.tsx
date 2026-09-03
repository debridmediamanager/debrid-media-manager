import { UserTorrentStatus } from '@/torrent/userTorrent';
import { act, renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTorrentManagement } from './useTorrentManagement';

const {
	mockDb,
	mockAddTorrentToCache,
	mockRemoveTorrentFromCache,
	mockHandleAddAsMagnetInRd,
	mockHandleAddAsMagnetInAd,
	mockHandleAddAsMagnetInTb,
	mockHandleAddAsMagnetInOc,
	mockHandleAddAsMagnetInDl,
	mockFetchAllDebrid,
	mockConvertToUserTorrent,
	mockGenerateTokenAndHash,
	mockSubmitAvailability,
	mockRemoveAvailability,
	mockHandleDeleteRdTorrent,
	mockHandleDeleteAdTorrent,
	mockHandleDeleteTbTorrent,
	mockHandleDeleteOcTorrent,
	mockHandleDeleteDlTorrent,
} = vi.hoisted(() => ({
	mockDb: {
		all: vi.fn(),
		add: vi.fn(),
		addAll: vi.fn(),
		deleteByHash: vi.fn(),
		deleteById: vi.fn(),
		getAllByHash: vi.fn(),
	},
	mockAddTorrentToCache: vi.fn(),
	mockRemoveTorrentFromCache: vi.fn(),
	mockHandleAddAsMagnetInRd: vi.fn(),
	mockHandleAddAsMagnetInAd: vi.fn(),
	mockHandleAddAsMagnetInTb: vi.fn(),
	mockHandleAddAsMagnetInOc: vi.fn(),
	mockHandleAddAsMagnetInDl: vi.fn(),
	mockFetchAllDebrid: vi.fn(),
	mockConvertToUserTorrent: vi.fn(),
	mockGenerateTokenAndHash: vi.fn(),
	mockSubmitAvailability: vi.fn(),
	mockRemoveAvailability: vi.fn(),
	mockHandleDeleteRdTorrent: vi.fn(),
	mockHandleDeleteAdTorrent: vi.fn(),
	mockHandleDeleteTbTorrent: vi.fn(),
	mockHandleDeleteOcTorrent: vi.fn(),
	mockHandleDeleteDlTorrent: vi.fn(),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: () => ({
		addTorrent: mockAddTorrentToCache,
		removeTorrent: mockRemoveTorrentFromCache,
	}),
}));

vi.mock('@/torrent/db', () => ({
	default: vi.fn().mockImplementation(() => mockDb),
}));

vi.mock('@/utils/addMagnet', () => ({
	handleAddAsMagnetInRd: mockHandleAddAsMagnetInRd,
	handleAddAsMagnetInAd: mockHandleAddAsMagnetInAd,
	handleAddAsMagnetInTb: mockHandleAddAsMagnetInTb,
	handleAddAsMagnetInOc: mockHandleAddAsMagnetInOc,
	handleAddAsMagnetInDl: mockHandleAddAsMagnetInDl,
}));

vi.mock('@/utils/fetchTorrents', () => ({
	convertToUserTorrent: mockConvertToUserTorrent,
	fetchAllDebrid: mockFetchAllDebrid,
}));

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: mockGenerateTokenAndHash,
}));

vi.mock('@/utils/availability', () => ({
	submitAvailability: mockSubmitAvailability,
	removeAvailability: mockRemoveAvailability,
}));

vi.mock('@/utils/deleteTorrent', () => ({
	handleDeleteRdTorrent: mockHandleDeleteRdTorrent,
	handleDeleteAdTorrent: mockHandleDeleteAdTorrent,
	handleDeleteTbTorrent: mockHandleDeleteTbTorrent,
	handleDeleteOcTorrent: mockHandleDeleteOcTorrent,
	handleDeleteDlTorrent: mockHandleDeleteDlTorrent,
}));

vi.mock('react-hot-toast', () => ({
	default: {
		error: vi.fn(),
		success: vi.fn(),
		// The send flows carry one toast from submit onwards, so anything that
		// gets past a guard and actually starts a transfer needs this.
		loading: vi.fn(() => 'toast-id'),
	},
}));

const makeTorrentInfo = (hash: string, overrides: Partial<any> = {}) => ({
	id: '123',
	hash,
	status: 'downloaded',
	progress: 100,
	bytes: 1024,
	original_bytes: 1024,
	files: [{ id: 1, path: 'file.mkv', bytes: 1024, selected: 1 }],
	links: ['https://rd/link'],
	added: new Date().toISOString(),
	speed: 0,
	seeders: 0,
	...overrides,
});

const makeUserTorrent = (overrides: Partial<any> = {}) => ({
	id: 'rd:123',
	hash: 'hash-1',
	filename: 'File.mkv',
	title: 'File',
	bytes: 1024,
	progress: 100,
	status: UserTorrentStatus.finished,
	serviceStatus: 'done',
	added: new Date(),
	mediaType: 'movie',
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
	...overrides,
});

const createSearchResult = (overrides: Partial<any> = {}) => ({
	id: 'hash-1',
	hash: 'hash-1',
	title: 'Sample Torrent',
	fileSize: 1024,
	medianFileSize: 1024,
	biggestFileSize: 1024,
	videoCount: 1,
	rdAvailable: false,
	tbAvailable: false,
	pmAvailable: false,
	ocAvailable: false,
	adAvailable: false,
	noVideos: false,
	files: [],
	...overrides,
});

describe('useTorrentManagement', () => {
	const searchResults = [createSearchResult()];
	let currentResults = [...searchResults];
	const setSearchResults = vi.fn((updater) => {
		currentResults =
			typeof updater === 'function'
				? (updater as (prev: any[]) => any[])(currentResults)
				: updater;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		currentResults = [...searchResults];
		mockDb.all.mockResolvedValue([]);
		mockDb.add.mockResolvedValue(undefined);
		mockDb.addAll.mockResolvedValue(undefined);
		mockDb.deleteByHash.mockResolvedValue(undefined);
		mockDb.deleteById.mockResolvedValue(undefined);
		mockDb.getAllByHash.mockResolvedValue([]);
		mockHandleAddAsMagnetInRd.mockImplementation(async (_rdKey, hash, cb) => {
			await cb(makeTorrentInfo(hash));
		});
		mockHandleAddAsMagnetInAd.mockImplementation(async (_adKey, hash, cb) => {
			if (cb) {
				await cb({
					id: 123,
					filename: `${hash}.mkv`,
					size: 1000000,
					status: 'Ready',
					statusCode: 4,
				} as any);
			}
		});
		mockHandleAddAsMagnetInTb.mockImplementation(async (_tbKey, hash, cb) => {
			await cb(
				makeUserTorrent({
					id: `tb:${hash}`,
					hash,
					progress: 40,
					status: UserTorrentStatus.downloading,
				})
			);
		});
		mockFetchAllDebrid.mockImplementation(async (_key, cb) => {
			await cb([
				makeUserTorrent({
					id: 'ad:hash-ad',
					hash: 'hash-ad',
					progress: 80,
				}),
			]);
		});
		mockConvertToUserTorrent.mockImplementation((info) =>
			makeUserTorrent({ id: `rd:${info.id}`, hash: info.hash })
		);
		mockGenerateTokenAndHash.mockResolvedValue(['token-ts', 'token-hash']);
		mockSubmitAvailability.mockResolvedValue(undefined);
		mockRemoveAvailability.mockResolvedValue(undefined);
		mockHandleDeleteRdTorrent.mockResolvedValue(undefined);
		mockHandleDeleteAdTorrent.mockResolvedValue(undefined);
		mockHandleDeleteTbTorrent.mockResolvedValue(undefined);
		mockHandleDeleteOcTorrent.mockResolvedValue(undefined);
		mockHandleDeleteDlTorrent.mockResolvedValue(undefined);
	});

	const renderManagementHook = () =>
		renderHook(() =>
			useTorrentManagement(
				'rd-key',
				'ad-key',
				'tb-key',
				'pm-key',
				'oc-key',
				'dl-key',
				'tt123',
				currentResults,
				setSearchResults
			)
		);

	it('adds RD torrents, submits availability, and updates progress state', async () => {
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.addRd('hash-1');
		});

		expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledWith(
			'rd-key',
			'hash-1',
			expect.any(Function),
			false,
			0,
			false,
			'Sample Torrent',
			0,
			[]
		);
		expect(mockSubmitAvailability).toHaveBeenCalledWith(
			'token-ts',
			'token-hash',
			expect.any(Object),
			'tt123'
		);
		expect(result.current.hashAndProgress['rd:hash-1']).toBe(100);
		expect(mockAddTorrentToCache).toHaveBeenCalled();
	});

	it('handles false positives for RD availability', async () => {
		mockHandleAddAsMagnetInRd.mockImplementation(async (_rdKey, hash, cb) => {
			await cb(makeTorrentInfo(hash, { status: 'downloading', progress: 50 }));
		});
		currentResults = [createSearchResult({ rdAvailable: true })];
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.addRd('hash-1');
		});

		expect(mockRemoveAvailability).toHaveBeenCalled();
		expect(setSearchResults).toHaveBeenCalled();
	});

	it('addRd with deleteIfNotInstant=true returns true when torrent is instant', async () => {
		currentResults = [createSearchResult({ rdAvailable: true })];
		const { result } = renderManagementHook();

		let returnValue: any;
		await act(async () => {
			returnValue = await result.current.addRd('hash-1', false, true);
		});

		expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledWith(
			'rd-key',
			'hash-1',
			expect.any(Function),
			true,
			0,
			false,
			// The row title goes with it: it is the only way to tell RD's
			// content block apart from its throttle penalty, since both come
			// back as 451 infringing_file.
			'Sample Torrent',
			0,
			// …and so do the filenames, because RD reads the paths inside the
			// torrent too and a display title can have lost the dots it blocks on.
			[]
		);
		expect(returnValue).toBe(true);
		expect(mockSubmitAvailability).toHaveBeenCalled();
		expect(mockRemoveAvailability).not.toHaveBeenCalled();
	});

	// RD blocks on the paths inside a torrent, not only on its root name, and the
	// row title is often the space-separated display form that has lost the dots
	// the block keys on — measured 2026-09-03 on a `WEB.h264` release whose title
	// read clean. Without these the 451 is misread as a throttle and the add sits
	// through two 20-second backoffs before failing with the wrong message.
	it('addRd hands over every filename it knows for the row', async () => {
		currentResults = [
			createSearchResult({
				files: [{ fileId: 1, filename: 'from.files.mkv', filesize: 1 }],
				tbFiles: [{ fileId: 7, filename: 'from.tbFiles.mkv', filesize: 1 }],
				rdFiles: [{ fileId: 2, filename: 'from.rdFiles.mkv', filesize: 1 }],
			}),
		];
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.addRd('hash-1');
		});

		expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledWith(
			'rd-key',
			'hash-1',
			expect.any(Function),
			false,
			0,
			false,
			'Sample Torrent',
			0,
			['from.files.mkv', 'from.tbFiles.mkv', 'from.rdFiles.mkv']
		);
	});

	it('addRd with deleteIfNotInstant=true returns false and cleans up when torrent is not instant', async () => {
		// When deleteIfNotInstant=true and torrent is not instant,
		// handleAddAsMagnetInRd deletes the torrent and does NOT call the callback.
		mockHandleAddAsMagnetInRd.mockImplementation(
			async (_rdKey, _hash, _cb, deleteIfNotInstant) => {
				// Simulate: torrent not instant, callback not called when deleteIfNotInstant=true
				if (!deleteIfNotInstant) {
					await _cb(makeTorrentInfo(_hash, { status: 'downloading', progress: 50 }));
				}
				// When deleteIfNotInstant=true and not instant: callback is skipped
			}
		);
		currentResults = [createSearchResult({ rdAvailable: true })];
		const { result } = renderManagementHook();

		let returnValue: any;
		await act(async () => {
			returnValue = await result.current.addRd('hash-1', false, true);
		});

		expect(returnValue).toBe(false);
		// Should clean up the false positive in availability DB
		expect(mockRemoveAvailability).toHaveBeenCalledWith(
			'token-ts',
			'token-hash',
			'hash-1',
			'Torrent not instant; deleted from RD'
		);
		// Should update search results to mark as not available
		expect(setSearchResults).toHaveBeenCalled();
		const updatedResult = currentResults.find((r: any) => r.hash === 'hash-1');
		expect(updatedResult?.rdAvailable).toBe(false);
	});

	// RD answers `451 infringing_file` both for a blocked filename and as a
	// throttle penalty mid-burst, and the throttle form shows up long before it
	// ever escalates to 429. Deleting the availability row on the raw status
	// evicted 285 hashes in one day that RD then downloaded to 100% once the
	// burst subsided — and the row is shared, so one user's burst cost everyone.
	describe('RD infringing_file', () => {
		beforeEach(() => {
			// A 451 throws inside handleAddAsMagnetInRd, so the callback never
			// runs and torrentInfo stays null.
			mockHandleAddAsMagnetInRd.mockResolvedValue('infringing_file');
		});

		it('keeps availability when the name is not one RD blocks', async () => {
			currentResults = [
				createSearchResult({
					rdAvailable: true,
					title: 'Would.I.Lie.To.You.S19E10.1080p.HEVC.x265-MeGusta',
				}),
			];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addRd('hash-1');
			});

			expect(mockRemoveAvailability).not.toHaveBeenCalled();
		});

		it('keeps availability mid-sweep, where deleteIfNotInstant is set', async () => {
			currentResults = [
				createSearchResult({
					rdAvailable: true,
					title: 'Would.I.Lie.To.You.S19E10.1080p.HDTV.H264-FTP',
				}),
			];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addRd('hash-1', false, true);
			});

			// A failed add is not evidence the torrent was slow to cache.
			expect(mockRemoveAvailability).not.toHaveBeenCalled();
		});

		it('removes availability when the name is one RD blocks', async () => {
			currentResults = [
				createSearchResult({
					rdAvailable: true,
					title: 'Movie.2019.1080p.WEB-DL.DDP5.1.H.264-GROUP',
				}),
			];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addRd('hash-1');
			});

			expect(mockRemoveAvailability).toHaveBeenCalledWith(
				'token-ts',
				'token-hash',
				'hash-1',
				'RD infringing_file'
			);
			const updatedResult = currentResults.find((r: any) => r.hash === 'hash-1');
			expect(updatedResult?.rdAvailable).toBe(false);
		});

		it('keeps availability when the title is unknown', async () => {
			currentResults = [createSearchResult({ rdAvailable: true, hash: 'hash-other' })];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addRd('hash-1');
			});

			expect(mockRemoveAvailability).not.toHaveBeenCalled();
		});
	});

	it('adds AD torrents via handleAddAsMagnetInAd', async () => {
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.addAd('hash-ad');
		});

		expect(mockHandleAddAsMagnetInAd).toHaveBeenCalledWith(
			'ad-key',
			'hash-ad',
			expect.any(Function), // callback
			false, // deleteIfNotInstant (isCheckingAvailability)
			true, // keepInLibrary (!isCheckingAvailability)
			false // silent
		);
		// Torrent is added directly in the callback via torrentDB.add
		expect(mockDb.add).toHaveBeenCalled();
	});

	it('adds TB torrents and persists them', async () => {
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.addTb('hash-tb');
		});

		expect(mockHandleAddAsMagnetInTb).toHaveBeenCalledWith(
			'tb-key',
			'hash-tb',
			expect.any(Function)
		);
		expect(mockAddTorrentToCache).toHaveBeenCalled();
		expect(result.current.hashAndProgress['tb:hash-tb']).toBe(40);
	});

	it('deletes RD torrents and removes them from cache', async () => {
		mockDb.getAllByHash.mockResolvedValue([
			makeUserTorrent({ id: 'rd:hash-1', hash: 'hash-1' }),
		]);
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.deleteRd('hash-1');
		});

		expect(mockHandleDeleteRdTorrent).toHaveBeenCalledWith('rd-key', 'rd:hash-1');
		expect(mockDb.deleteByHash).toHaveBeenCalledWith('rd', 'hash-1');
		expect(mockRemoveTorrentFromCache).toHaveBeenCalledWith('rd:hash-1');
	});

	it('deletes AD torrents and removes progress tracking entries', async () => {
		mockDb.getAllByHash.mockResolvedValue([
			makeUserTorrent({ id: 'ad:hash-ad', hash: 'hash-ad' }),
		]);
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.deleteAd('hash-ad');
		});

		expect(mockHandleDeleteAdTorrent).toHaveBeenCalledWith('ad-key', 'ad:hash-ad');
		expect(mockDb.deleteByHash).toHaveBeenCalledWith('ad', 'hash-ad');
		expect(mockRemoveTorrentFromCache).toHaveBeenCalledWith('ad:hash-ad');
	});

	it('deletes TB torrents when removing from the library', async () => {
		mockDb.getAllByHash.mockResolvedValue([
			makeUserTorrent({ id: 'tb:hash-tb', hash: 'hash-tb' }),
		]);
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.deleteTb('hash-tb');
		});

		expect(mockHandleDeleteTbTorrent).toHaveBeenCalledWith('tb-key', 'tb:hash-tb');
		expect(mockDb.deleteByHash).toHaveBeenCalledWith('tb', 'hash-tb');
		expect(mockRemoveTorrentFromCache).toHaveBeenCalledWith('tb:hash-tb');
	});

	it('fetches hash progress from IndexedDB and updates state', async () => {
		mockDb.all.mockResolvedValue([
			makeUserTorrent({ id: 'rd:first', hash: 'hash-1', progress: 70 }),
			makeUserTorrent({ id: 'ad:second', hash: 'hash-2', progress: 20 }),
		]);
		const { result } = renderManagementHook();

		await act(async () => {
			await result.current.fetchHashAndProgress();
		});

		expect(result.current.hashAndProgress['rd:hash-1']).toBe(70);
		expect(result.current.hashAndProgress['ad:hash-2']).toBe(20);
	});

	// The uploader refuses these anyway once it knows the size, but not before
	// the submission has crossed the network and taken a job row. Measured over
	// 30 days to 2026-08-29, releases this size never complete: 0 of 14 above
	// 200 GB, against a largest-ever success of 186.1 GB.
	describe('the transfer size cap', () => {
		// `fileSize` is in MB and is the whole release; the hook's routing hint
		// uses `biggestFileSize` first, which would read a 600 GB season pack as
		// one 8 GB episode — so the cap has to read the total itself.
		const oversize = { fileSize: 600_000, biggestFileSize: 8_000, tbAvailable: true };

		it('refuses to send a release over the cap', async () => {
			currentResults = [createSearchResult(oversize)];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.sendTbToRd('hash-1');
			});

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('over the 100 GB limit'),
				expect.anything()
			);
			expect(setSearchResults).not.toHaveBeenCalled();
		});

		it('names the actual size so the refusal is explicable', async () => {
			currentResults = [createSearchResult(oversize)];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.sendTbToRd('hash-1');
			});

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('629.1 GB'),
				expect.anything()
			);
		});

		// A season pack whose biggest file is small must still be measured whole.
		it('measures the whole release, not its biggest file', async () => {
			currentResults = [
				createSearchResult({ fileSize: 50_000, biggestFileSize: 8_000, tbAvailable: true }),
			];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.sendTbToRd('hash-1');
			});

			// 50 GB total is under the cap, so this one is not refused here.
			expect(toast.error).not.toHaveBeenCalledWith(
				expect.stringContaining('over the 100 GB limit'),
				expect.anything()
			);
		});
	});
	describe('Offcloud', () => {
		it('stores the row the add handler builds and records its progress', async () => {
			const row = makeUserTorrent({
				id: 'oc:req-1',
				hash: 'hash-1',
				progress: 100,
				status: UserTorrentStatus.finished,
			});
			mockHandleAddAsMagnetInOc.mockImplementation(async (_key, _hash, callback) => {
				if (callback) await callback(row);
			});
			mockDb.all.mockResolvedValue([row]);
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addOc('hash-1');
			});

			expect(mockHandleAddAsMagnetInOc).toHaveBeenCalledWith(
				'oc-key',
				'hash-1',
				expect.any(Function)
			);
			expect(mockDb.add).toHaveBeenCalledWith(row);
			expect(mockAddTorrentToCache).toHaveBeenCalledWith(row);
			expect(result.current.hashAndProgress['oc:hash-1']).toBe(100);
		});

		it('deletes only the oc: rows for a hash, leaving the other services alone', async () => {
			mockDb.getAllByHash.mockResolvedValue([
				makeUserTorrent({ id: 'oc:req-1', hash: 'hash-1' }),
				makeUserTorrent({ id: 'pm:tabc', hash: 'hash-1' }),
			]);
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.deleteOc('hash-1');
			});

			expect(mockHandleDeleteOcTorrent).toHaveBeenCalledTimes(1);
			expect(mockHandleDeleteOcTorrent).toHaveBeenCalledWith('oc-key', 'oc:req-1');
			expect(mockDb.deleteByHash).toHaveBeenCalledWith('oc', 'hash-1');
		});

		it('does nothing at all without an Offcloud key', async () => {
			const { result } = renderHook(() =>
				useTorrentManagement('rd-key', null, null, null, null, null, 'tt123', [], vi.fn())
			);

			await act(async () => {
				await result.current.addOc('hash-1');
				await result.current.deleteOc('hash-1');
			});

			expect(mockHandleAddAsMagnetInOc).not.toHaveBeenCalled();
			expect(mockHandleDeleteOcTorrent).not.toHaveBeenCalled();
		});
	});

	describe('Debrid-Link', () => {
		it('stores the row the add handler builds and records its progress', async () => {
			const row = makeUserTorrent({
				id: 'dl:seed-1',
				hash: 'hash-1',
				progress: 100,
				status: UserTorrentStatus.finished,
			});
			mockHandleAddAsMagnetInDl.mockImplementation(async (_key, _hash, callback) => {
				if (callback) await callback(row);
			});
			mockDb.all.mockResolvedValue([row]);
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addDl('hash-1');
			});

			expect(mockHandleAddAsMagnetInDl).toHaveBeenCalledWith(
				'dl-key',
				'hash-1',
				expect.any(Function)
			);
			expect(mockDb.add).toHaveBeenCalledWith(row);
			expect(mockAddTorrentToCache).toHaveBeenCalledWith(row);
			expect(result.current.hashAndProgress['dl:hash-1']).toBe(100);
		});

		it('adds without consulting any availability flag - there is none to consult', async () => {
			// Debrid-Link publishes no cache probe, so `addDl` cannot be gated on
			// one. This asserts the absence: an add on a row with every flag false
			// still reaches the handler.
			mockHandleAddAsMagnetInDl.mockResolvedValue(undefined);
			currentResults = [createSearchResult({ hash: 'hash-1' })];
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.addDl('hash-1');
			});

			expect(mockHandleAddAsMagnetInDl).toHaveBeenCalled();
		});

		it('deletes only the dl: rows for a hash, leaving the other services alone', async () => {
			mockDb.getAllByHash.mockResolvedValue([
				makeUserTorrent({ id: 'dl:seed-1', hash: 'hash-1' }),
				makeUserTorrent({ id: 'oc:req-1', hash: 'hash-1' }),
			]);
			const { result } = renderManagementHook();

			await act(async () => {
				await result.current.deleteDl('hash-1');
			});

			expect(mockHandleDeleteDlTorrent).toHaveBeenCalledTimes(1);
			expect(mockHandleDeleteDlTorrent).toHaveBeenCalledWith('dl-key', 'dl:seed-1');
			expect(mockDb.deleteByHash).toHaveBeenCalledWith('dl', 'hash-1');
		});

		it('does nothing at all without a Debrid-Link credential', async () => {
			const { result } = renderHook(() =>
				useTorrentManagement('rd-key', null, null, null, null, null, 'tt123', [], vi.fn())
			);

			await act(async () => {
				await result.current.addDl('hash-1');
				await result.current.deleteDl('hash-1');
			});

			expect(mockHandleAddAsMagnetInDl).not.toHaveBeenCalled();
			expect(mockHandleDeleteDlTorrent).not.toHaveBeenCalled();
		});
	});
});
