import duplicateFilms from '@/test/fixtures/library/duplicate-films.json';
import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouter = {
	pathname: '/library',
	asPath: '/library',
	query: {} as Record<string, string | string[]>,
	push: vi.fn(),
	replace: vi.fn().mockResolvedValue(true),
	events: {
		on: vi.fn(),
		off: vi.fn(),
	},
};

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => mockRouter,
}));

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			traktClientId: 'test-trakt-client-id',
		},
	}),
}));

const mockAddTorrent = vi.fn();
const mockRefreshLibrary = vi.fn();
const mockLibraryCache = {
	libraryItems: [] as UserTorrent[],
	isLoading: false,
	isFetching: false,
	refreshLibrary: mockRefreshLibrary,
	setLibraryItems: vi.fn(),
	addTorrent: mockAddTorrent,
	removeTorrent: vi.fn(),
	updateTorrent: vi.fn(),
	error: null,
	lastFetchTime: null,
};

vi.mock('@/contexts/LibraryCacheContext', () => ({
	__esModule: true,
	useLibraryCache: () => mockLibraryCache,
}));

const mockCredentials = vi.hoisted(
	(): { rd: string | null; ad: string | null; tb: string | null; pm: string | null } => ({
		rd: 'test-rd-key',
		ad: 'test-ad-key',
		tb: 'test-tb-key',
		pm: null,
	})
);

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => [mockCredentials.rd],
	useAllDebridApiKey: () => mockCredentials.ad,
	useTorBoxAccessToken: () => mockCredentials.tb,
	usePremiumizeCredential: () => mockCredentials.pm,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
}));

vi.mock('@/hooks/useRelativeTimeLabel', () => ({
	__esModule: true,
	useRelativeTimeLabel: () => 'Just now',
}));

const mockHandleAddAsMagnetInRd = vi.fn();
const mockHandleAddAsMagnetInPm = vi.fn();
const mockHandleAddAsMagnetInAd = vi.fn();

const mockAddFilesInRd = vi.fn();
const mockAddHashesInRd = vi.fn();
const mockModalFire = vi.fn();

vi.mock('@/components/modals/modal', () => ({
	default: {
		fire: (...args: unknown[]) => mockModalFire(...args),
		DismissReason: { cancel: 'cancel' },
	},
}));
// A restore to RD is spaced a minute per add; do not wait the gaps out
vi.mock('@/utils/delay', () => ({ delay: vi.fn(async () => {}) }));

vi.mock('@/utils/addMagnet', () => ({
	__esModule: true,
	handleAddAsMagnetInRd: (...args: unknown[]) => mockHandleAddAsMagnetInRd(...args),
	handleAddAsMagnetInAd: (...args: unknown[]) => mockHandleAddAsMagnetInAd(...args),
	handleAddAsMagnetInTb: vi.fn(),
	handleAddAsMagnetInPm: (...args: unknown[]) => mockHandleAddAsMagnetInPm(...args),
	handleAddMultipleHashesInRd: (...args: unknown[]) => mockAddHashesInRd(...args),
	handleAddMultipleHashesInAd: vi.fn(),
	handleAddMultipleHashesInTb: vi.fn(),
	handleAddMultipleHashesInPm: vi.fn(),
	handleAddMultipleHashesInOc: vi.fn(),
	handleAddMultipleHashesInDl: vi.fn(),
	handleAddMultipleTorrentFilesInRd: (...args: unknown[]) => mockAddFilesInRd(...args),
	handleAddMultipleTorrentFilesInAd: vi.fn(),
	handleAddMultipleTorrentFilesInPm: vi.fn(),
	handleAddMultipleTorrentFilesInOc: vi.fn(),
	handleAddMultipleTorrentFilesInDl: vi.fn(),
	handleAddMultipleTorrentFilesInTb: vi.fn(),
	handleReinsertTorrentinRd: vi.fn(),
	handleRestartTorrent: vi.fn(),
}));

const mockAd = vi.hoisted(() => ({
	uploadMagnetAd: vi.fn(),
	deleteMagnetAd: vi.fn(),
	getMagnetStatusAd: vi.fn(),
	getMagnetFiles: vi.fn(),
}));

vi.mock('@/services/allDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/allDebrid')>()),
	...mockAd,
	__esModule: true,
	uploadMagnet: vi.fn().mockResolvedValue({
		magnets: [{ id: 123, hash: 'testhash' }],
	}),
	getMagnetStatus: vi.fn().mockResolvedValue({
		status: 'success',
		data: {
			magnets: [
				{
					id: 123,
					filename: 'Test.Torrent.mkv',
					hash: 'testhash',
					size: 1000000,
					status: 'Ready',
					statusCode: 4,
					links: [],
				},
			],
		},
	}),
}));

vi.mock('@/services/torbox', () => ({
	__esModule: true,
	createTorrent: vi.fn(),
	getTorrentList: vi.fn(),
	controlTorrent: vi.fn(),
}));

const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
		promise: vi.fn(),
	})
);

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: mockToast,
	toast: mockToast,
	Toaster: () => null,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

import LibraryPage from '@/pages/library';
import adRestore from '@/test/fixtures/allDebridRestore/upload-ready-and-not-2026-11-04.json';
import check2 from '@/test/fixtures/realdebrid/check2-restore-2026-10-14.json';
import { mintProblemToken, validateProblemToken } from '@/utils/problemToken';
import { resetTokenCache } from '@/utils/token';

describe('Library Page - addMagnet Query Parameter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRouter.query = {};
		mockRouter.push.mockClear();
		mockRouter.replace.mockClear();
		mockCredentials.rd = 'test-rd-key';
		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('should optimistically add RealDebrid torrent to cache when addMagnet query param is present', async () => {
		mockCredentials.ad = null;
		mockCredentials.tb = null;

		const testHash = '08ada5a7a6183aae1e09d831df6748d566095a10';
		mockRouter.query = { addMagnet: testHash };

		const mockTorrentInfo = {
			id: 'rd123',
			filename: 'Test.Movie.2024.mkv',
			hash: testHash,
			bytes: 5000000000,
			status: 'downloaded',
			added: new Date().toISOString(),
			links: ['http://link1.com', 'http://link2.com'],
			progress: 100,
			files: [],
			seeders: 10,
			speed: 0,
		};

		mockHandleAddAsMagnetInRd.mockImplementation((rdKey, hash, callback) => {
			if (callback) {
				callback(mockTorrentInfo);
			}
			return Promise.resolve();
		});

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockRouter.replace).toHaveBeenCalledWith('/library?page=1', undefined, {
				shallow: true,
			});
		});

		await waitFor(
			() => {
				expect(mockAddTorrent).toHaveBeenCalled();
				const rdTorrent = mockAddTorrent.mock.calls.find((call) =>
					call[0].id.startsWith('rd:')
				);
				expect(rdTorrent).toBeDefined();
				if (rdTorrent) {
					expect(rdTorrent[0].hash).toBe(testHash);
				}
			},
			{ timeout: 3000 }
		);

		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('should optimistically add AllDebrid torrent to cache when addMagnet query param is present', async () => {
		mockCredentials.rd = null;
		mockCredentials.tb = null;

		const testHash = '08ada5a7a6183aae1e09d831df6748d566095a10';
		mockRouter.query = { addMagnet: testHash };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockRouter.replace).toHaveBeenCalledWith('/library?page=1', undefined, {
				shallow: true,
			});
		});

		await waitFor(
			() => {
				expect(mockAddTorrent).toHaveBeenCalled();
				const addedTorrent = mockAddTorrent.mock.calls.find((call) =>
					call[0].id.startsWith('ad:')
				);
				expect(addedTorrent).toBeDefined();
			},
			{ timeout: 5000 }
		);

		mockCredentials.rd = 'test-rd-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('should not process if no addMagnet query param', async () => {
		mockRouter.query = { page: '1' };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
			expect(mockAddTorrent).not.toHaveBeenCalled();
		});
	});

	it('should not process if more than one hash extracted', async () => {
		mockRouter.query = {
			addMagnet:
				'08ada5a7a6183aae1e09d831df6748d566095a10 dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
		};

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
		});
	});

	// The browser extension sends the bare hash. This one RD refused by name on
	// 2026-10-13 and again an hour later (rd-add-name-retest-2026-10-13.json);
	// without its name the add took that 451 for the account's pause and held
	// the user for five minutes of retries.
	it('hands the RD add the names DMM has on record for a bare hash', async () => {
		mockCredentials.ad = null;
		mockCredentials.tb = null;
		const hash = '4d2e9e41c6dd2d2183888b90d5393d7ae472f1b6';
		const name = 'Sinners 2025 2160p iT WEB-DL DDP5 1 Atmos DV HDR H 265-BYNDR';
		mockRouter.query = { addMagnet: hash };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url === '/api/challenge') {
					return { ok: true, json: async () => ({ token: 'tok', hash: 'sig' }) };
				}
				if (url === '/api/availability/check2') {
					expect(JSON.parse(String(init?.body)).hashes).toEqual([hash]);
					const available = [{ hash, filename: name, originalFilename: name, files: [] }];
					return { ok: true, json: async () => ({ available }) };
				}
				return { ok: false, json: async () => ({}) };
			})
		);
		mockHandleAddAsMagnetInRd.mockResolvedValue('infringing_file');

		try {
			render(<LibraryPage />);

			await waitFor(() => expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledTimes(1));
			const args = mockHandleAddAsMagnetInRd.mock.calls[0];
			expect(args[0]).toBe('test-rd-key');
			expect(args[1]).toBe(hash);
			expect(args[8]).toEqual([name, name]);
		} finally {
			vi.unstubAllGlobals();
			mockCredentials.ad = 'test-ad-key';
			mockCredentials.tb = 'test-tb-key';
		}
	});
});

// Card 359, reproduced live 2026-11-04: signed in to RD and Premiumize, the
// extension's /library?addMagnet=<hash> landed Cosmos Laundromat on both accounts.
describe('Library addMagnet with several providers signed in', () => {
	const COSMOS = 'c9e15763f722f23e98a29decdfae341b98d53056';

	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		mockRouter.query = { addMagnet: COSMOS };
		mockCredentials.rd = 'test-rd-key';
		mockCredentials.ad = null;
		mockCredentials.tb = null;
		mockCredentials.pm = 'test-pm-key';
		mockHandleAddAsMagnetInRd.mockResolvedValue('success');
		mockHandleAddAsMagnetInPm.mockResolvedValue(undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, json: async () => ({}) }))
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
		mockCredentials.pm = null;
	});

	// The picker's radio is what preConfirm reads; answer as if the user picked `value`.
	const answer = (value: string) =>
		mockModalFire.mockImplementation(async (options: { html: string }) => {
			expect(options.html).toContain('Real-Debrid');
			expect(options.html).toContain('Premiumize');
			return { isConfirmed: true, value };
		});

	it('asks first and adds only to the provider picked', async () => {
		answer('pm');
		render(<LibraryPage />);

		await waitFor(() => expect(mockHandleAddAsMagnetInPm).toHaveBeenCalledTimes(1));
		expect(mockModalFire).toHaveBeenCalledTimes(1);
		expect(mockHandleAddAsMagnetInPm.mock.calls[0][0]).toBe('test-pm-key');
		expect(mockHandleAddAsMagnetInPm.mock.calls[0][1]).toBe(COSMOS);
		expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
		expect(window.localStorage.getItem('settings:addMagnetProvider')).toBe('pm');
	});

	it('adds nothing when the picker is cancelled', async () => {
		mockModalFire.mockResolvedValue({ isConfirmed: false, isDismissed: true });
		render(<LibraryPage />);

		await waitFor(() => expect(mockModalFire).toHaveBeenCalledTimes(1));
		await act(async () => {});
		expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
		expect(mockHandleAddAsMagnetInPm).not.toHaveBeenCalled();
	});

	it('keeps adding to every provider when the user picks All', async () => {
		answer('all');
		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledTimes(1);
			expect(mockHandleAddAsMagnetInPm).toHaveBeenCalledTimes(1);
		});
	});

	it('preselects the last choice', async () => {
		window.localStorage.setItem('settings:addMagnetProvider', 'pm');
		answer('pm');
		render(<LibraryPage />);

		await waitFor(() => expect(mockModalFire).toHaveBeenCalledTimes(1));
		expect(mockModalFire.mock.calls[0][0].html).toMatch(/value="pm" checked/);
		expect(mockModalFire.mock.calls[0][0].html).not.toMatch(/value="rd" checked/);
	});
});

describe('Library mixed torrent submissions', () => {
	it('finishes native uploads before starting magnets on the same account', async () => {
		mockRouter.query = {};
		const operations: string[] = [];
		let finishUpload!: () => void;
		const uploading = new Promise<void>((resolve) => {
			finishUpload = resolve;
		});
		mockAddFilesInRd.mockImplementation(async () => {
			operations.push('upload:start');
			await uploading;
			operations.push('upload:end');
		});
		mockAddHashesInRd.mockImplementation(async () => {
			operations.push('magnet:start');
		});
		mockModalFire.mockResolvedValue({
			value: {
				torrentInputs: [
					{
						kind: 'hash',
						source: '08ada5a7a6183aae1e09d831df6748d566095a10',
						hash: '08ada5a7a6183aae1e09d831df6748d566095a10',
					},
				],
				torrentFiles: [new File(['torrent bytes'], 'sintel.torrent')],
				webDownloadLinks: [],
			},
		});
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /RD\s+Add/ }));
		});
		expect(operations).toEqual(['upload:start']);
		await act(async () => {
			finishUpload();
			await uploading;
		});
		await waitFor(() => {
			expect(operations).toEqual(['upload:start', 'upload:end', 'magnet:start']);
		});
	});
});

// Restore asked /api/availability/check2 with an empty dmmProblemKey and
// solution, which production answers 403 (captured 2026-10-14), so every
// backup restored as uncached and the RD add never had the names on record.
describe('Library backup restore to Real-Debrid', () => {
	const [SINNERS, WEAPONS] = check2.hashes;
	const recorded = check2.withChallengeToken.body.available[0];

	beforeEach(() => {
		vi.clearAllMocks();
		resetTokenCache();
		mockRouter.query = {};
		mockCredentials.ad = null;
		mockCredentials.tb = null;
		vi.stubEnv('DMM_PROBLEM_SECRET', 'restore-test-secret');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url === '/api/challenge') {
					const [token, hash] = mintProblemToken('restore-test-secret');
					return { ok: true, json: async () => ({ token, hash }) };
				}
				if (url === '/api/availability/check2') {
					const { dmmProblemKey, solution } = JSON.parse(String(init?.body));
					const answer = validateProblemToken(dmmProblemKey, solution)
						? check2.withChallengeToken
						: check2.emptyCredentials;
					return {
						ok: answer.status === 200,
						status: answer.status,
						json: async () => answer.body,
					};
				}
				return { ok: false, status: 404, json: async () => ({}) };
			})
		);
		mockHandleAddAsMagnetInRd.mockResolvedValue('success');
		mockModalFire.mockResolvedValue({
			isConfirmed: true,
			value: {
				files: [
					{ hash: SINNERS, filename: 'Sinners 2025 2160p' },
					{ hash: WEAPONS, filename: 'Weapons.2025.MA.WEB-DL.1080p.BLUEBIRD.mkv' },
				],
				cachedOnly: false,
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('restores what DMM has on record first, with the names it returned', async () => {
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /RD Restore/ }));
		});

		await waitFor(() => expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledTimes(2));
		expect(mockToast.success).toHaveBeenCalledWith(
			'1 cached torrents queued first.',
			expect.anything()
		);
		const [first, second] = mockHandleAddAsMagnetInRd.mock.calls;
		expect(first[1]).toBe(SINNERS);
		expect(first[6]).toBe('Sinners 2025 2160p');
		expect(first[8]).toEqual([recorded.originalFilename, recorded.filename]);
		expect(second[1]).toBe(WEAPONS);
		expect(second[8]).toEqual([]);
	});

	it('settles all 7500 modelled backup entries and counts RD refusals as failures', async () => {
		// Scale replay only: no reporter backup was attached and no provider is mutated.
		const files = Array.from({ length: 7500 }, (_, index) => ({
			hash: index.toString(16).padStart(40, '0'),
			filename: `Replay.Movie.${index}.mkv`,
		}));
		mockModalFire.mockResolvedValue({ isConfirmed: true, value: { files, cachedOnly: false } });
		mockHandleAddAsMagnetInRd.mockImplementation(async (_key, hash) =>
			hash === files[100].hash ? 'infringing_file' : 'success'
		);
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /RD Restore/ }));
		});
		await waitFor(() => expect(mockToast.promise).toHaveBeenCalled());
		const processing = mockToast.promise.mock.calls[0][0];
		await expect(processing).resolves.toEqual({ success: 7499, notCached: 0, error: 1 });
		expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledTimes(7500);
		expect(new Set(mockHandleAddAsMagnetInRd.mock.calls.map((call) => call[1])).size).toBe(
			7500
		);
		expect(mockToast.loading).not.toHaveBeenCalledWith(
			'Restoring... do not refresh.',
			expect.anything()
		);
	});

	it('still reports the restored count when the final library refresh fails', async () => {
		mockRefreshLibrary.mockRejectedValueOnce(new Error('Library fetch failed'));
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /RD Restore/ }));
		});
		await waitFor(() => expect(mockToast.promise).toHaveBeenCalled());
		const [processing] = mockToast.promise.mock.calls[0];
		await expect(processing).resolves.toEqual({ success: 2, notCached: 0, error: 0 });
		expect(mockRefreshLibrary).toHaveBeenCalled();
		expect(mockToast.dismiss).toHaveBeenCalledWith('restore-progress');
	});
});

// Restore to AD deleted every magnet AD had not cached and still counted it as
// restored: "Restored 3; 0 failed" for a backup of which two were thrown away
// (reproduced live 2026-11-04). Drives the real dialog and the real AD add
// against AD's captured upload answers.
describe('Library backup restore to AllDebrid', () => {
	const backup = adRestore.uploads.map((u) => ({ hash: u.hash, filename: u.name }));
	const uncachedIds = adRestore.uploads.filter((u) => !u.ready).map((u) => u.id);

	const restoreThroughDialog = async (uncheckCachedOnly: boolean) => {
		mockModalFire.mockImplementation(async (opts: any) => {
			document.body.insertAdjacentHTML(
				'beforeend',
				`<div id="restore-dialog">${opts.html}</div>`
			);
			const input = document.getElementById('restoreFile') as HTMLInputElement;
			Object.defineProperty(input, 'files', {
				value: [new File([JSON.stringify(backup)], 'backup.json')],
			});
			const cachedOnly = document.getElementById('ad-cached-only') as HTMLInputElement | null;
			if (cachedOnly && uncheckCachedOnly) cachedOnly.checked = false;
			const value = await opts.preConfirm();
			document.getElementById('restore-dialog')?.remove();
			return { isConfirmed: true, value };
		});
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /AD Restore/ }));
		});
		await waitFor(() => expect(mockToast.promise).toHaveBeenCalled());
		const [processing, messages] = mockToast.promise.mock.calls[0];
		const result = await processing;
		vi.useFakeTimers(); // the summary schedules a page reload
		const summary = messages.success(result);
		vi.useRealTimers();
		return { result, summary };
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		mockRouter.query = {};
		mockCredentials.rd = null;
		mockCredentials.tb = null;
		const actual =
			await vi.importActual<typeof import('@/utils/addMagnet')>('@/utils/addMagnet');
		mockHandleAddAsMagnetInAd.mockImplementation(actual.handleAddAsMagnetInAd);
		mockAd.uploadMagnetAd.mockImplementation(async (_key: string, hash: string) =>
			adRestore.uploads.find((u) => u.hash === hash)
		);
		mockAd.getMagnetStatusAd.mockResolvedValue(adRestore.sintelStatus);
		mockAd.getMagnetFiles.mockResolvedValue({ magnets: [] });
		mockAd.deleteMagnetAd.mockResolvedValue(undefined);
	});

	afterEach(() => {
		mockCredentials.rd = 'test-rd-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('reports titles AD has not cached as skipped, never as restored', async () => {
		const { result, summary } = await restoreThroughDialog(false);

		expect(result).toEqual({ success: 1, notCached: 2, error: 0 });
		expect(summary).toBe(
			'Restored 1, 2 not cached on AllDebrid (skipped); 0 failed in AD library. Refreshing in 10s.'
		);
		expect(mockAd.deleteMagnetAd.mock.calls.map((call) => call[1]).sort()).toEqual(
			[...uncachedIds].sort()
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			'Torrent not instant; removed.',
			expect.anything()
		);
	});

	it('keeps uncached titles for AD to download when cached-only is unchecked', async () => {
		const { result, summary } = await restoreThroughDialog(true);

		expect(result).toEqual({ success: 3, notCached: 0, error: 0 });
		expect(summary).toBe('Restored 3; 0 failed in AD library. Refreshing in 10s.');
		expect(mockAd.deleteMagnetAd).not.toHaveBeenCalled();
	});
	it('skips an AD hash already in the library regardless of hash casing', async () => {
		const owned = adRestore.uploads.find((upload) => !upload.ready)!;
		const previousItems = mockLibraryCache.libraryItems;
		mockLibraryCache.libraryItems = [
			{
				id: `ad:${owned.id}`,
				hash: owned.hash.toUpperCase(),
				filename: owned.name,
				title: owned.name,
				bytes: owned.size,
				progress: 0,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'Downloading',
				added: new Date('2026-11-05T00:00:00Z'),
				mediaType: 'other',
				links: [],
				selectedFiles: [],
				seeders: 1,
				speed: 0,
			},
		];
		try {
			const { result } = await restoreThroughDialog(false);
			expect(result).toEqual({ success: 1, notCached: 1, error: 0 });
			expect(mockAd.uploadMagnetAd.mock.calls.map((call) => call[1])).not.toContain(
				owned.hash
			);
			expect(mockAd.deleteMagnetAd.mock.calls.map((call) => call[1])).not.toContain(owned.id);
		} finally {
			mockLibraryCache.libraryItems = previousItems;
		}
	});
});

describe('Library identification arriving after initial grouping', () => {
	const southpaw = duplicateFilms.films.tt1798684;
	let answerIdentification: (results: (LibraryIdentification | null)[]) => Promise<void>;
	let identificationRequested: Promise<void>;

	const rowFromRelease = (
		release: { filename: string; hash: string },
		index: number
	): UserTorrent => ({
		id: `rd:identity-${index}`,
		filename: release.filename,
		hash: release.hash,
		title: 'Southpaw (2015)',
		bytes: 1_000_000,
		progress: 100,
		status: UserTorrentStatus.finished,
		serviceStatus: 'downloaded',
		added: new Date('2026-10-22T00:00:00.000Z'),
		mediaType: 'movie',
		links: [],
		selectedFiles: [],
		seeders: 0,
		speed: 0,
	});
	const identity = (index: number): LibraryIdentification => ({
		...southpaw[index].identification,
		kind: 'movie',
	});
	const expectSouthpawRows = () => {
		for (const release of southpaw) {
			expect(screen.getByText(release.filename, { exact: false })).toBeVisible();
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockRouter.query = {};
		mockRouter.asPath = '/library';
		mockCredentials.rd = 'test-rd-key';
		mockCredentials.ad = null;
		mockCredentials.tb = null;
		mockLibraryCache.libraryItems = southpaw.map(rowFromRelease);
		const { promise: requestedPromise, resolve: requested } = Promise.withResolvers<void>();
		identificationRequested = requestedPromise;
		const { promise: response, resolve: respond } = Promise.withResolvers<Response>();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				if (String(input) === '/api/library/identify') {
					requested();
					return response;
				}
				return new Response('{}', { status: 404 });
			})
		);
		answerIdentification = async (results) => {
			await act(async () => {
				respond(new Response(JSON.stringify({ results })));
				await response;
			});
		};
	});

	afterEach(() => {
		mockLibraryCache.libraryItems = [];
		mockRouter.query = {};
		mockRouter.asPath = '/library';
		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
		vi.unstubAllGlobals();
	});

	it('keeps both same-title rows visible when their delayed movie identities arrive without another keystroke', async () => {
		const page = render(<LibraryPage />);
		await identificationRequested;
		await waitFor(expectSouthpawRows);
		mockRouter.query = { status: 'sametitle', page: '1' };
		page.rerender(<LibraryPage />);
		await waitFor(expectSouthpawRows);

		await answerIdentification([identity(0), identity(1)]);

		await waitFor(expectSouthpawRows);
	});

	it('keeps an existing parsed-title library link populated after both IMDb identities arrive', async () => {
		mockRouter.query = { title: 'southpaw2015', page: '1' };
		mockRouter.asPath = '/library?title=southpaw2015&page=1';
		render(<LibraryPage />);
		await identificationRequested;
		await waitFor(expectSouthpawRows);

		await answerIdentification([identity(0), identity(1)]);

		await waitFor(expectSouthpawRows);
	});

	it('still groups matching parsed movie titles when only one release has been identified', async () => {
		const page = render(<LibraryPage />);
		await identificationRequested;
		await waitFor(expectSouthpawRows);
		await answerIdentification([identity(0), null]);
		mockRouter.query = { status: 'sametitle', page: '1' };
		page.rerender(<LibraryPage />);

		await waitFor(expectSouthpawRows);
	});

	it('does not join distinct known movies through an unidentified parsed-title bridge', async () => {
		// This is an intentional title-collision control, not a provider capture:
		// three real releases share a deliberately ambiguous local parsed title.
		const taken = duplicateFilms.films.tt0936501[0];
		mockLibraryCache.libraryItems = [...southpaw, taken].map(rowFromRelease);
		const page = render(<LibraryPage />);
		await identificationRequested;
		await waitFor(expectSouthpawRows);
		await answerIdentification([identity(0), null, { ...taken.identification, kind: 'movie' }]);
		mockRouter.query = { status: 'sametitle', page: '1' };
		page.rerender(<LibraryPage />);

		await waitFor(() => {
			for (const release of [...southpaw, taken]) {
				expect(screen.queryByText(release.filename, { exact: false })).toBeNull();
			}
		});
	});
});
