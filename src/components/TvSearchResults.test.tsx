import type { SearchResult } from '@/services/mediasearch';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TvSearchResults from './TvSearchResults';

const downloadSpy = vi.fn();

vi.mock('@/utils/downloadMagnet', () => ({
	downloadMagnetFile: (...args: any[]) => downloadSpy(...args),
}));

vi.mock('./ReportButton', () => ({
	default: () => <div data-testid="report-button" />,
}));

const openWatchSpy = vi.fn();
vi.mock('@/utils/watchService', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/utils/watchService')>();
	return { ...actual, openWatch: (...args: any[]) => openWatchSpy(...args) };
});

const baseTvResult: SearchResult = {
	title: 'Sample Show',
	fileSize: 1024 * 20,
	hash: 'tv-hash',
	rdAvailable: true,
	adAvailable: false,
	tbAvailable: false,
	pmAvailable: false,
	ocAvailable: false,
	files: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
	rdFiles: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
	noVideos: false,
	medianFileSize: 10,
	biggestFileSize: 12,
	videoCount: 1,
	imdbId: 'tt456',
};

const renderTv = (override?: Partial<React.ComponentProps<typeof TvSearchResults>>) => {
	const props: React.ComponentProps<typeof TvSearchResults> = {
		filteredResults: [baseTvResult],
		expectedEpisodeCount: 1,
		onlyShowCached: false,
		episodeMaxSize: '20',
		rdKey: 'rd',
		adKey: null,
		torboxKey: null,
		premiumizeKey: null,
		offcloudKey: null,
		debridLinkKey: null,
		player: '',
		hashAndProgress: {},
		handleShowInfo: vi.fn(),
		handleCast: vi.fn().mockResolvedValue(undefined),
		handleCopyMagnet: vi.fn(),
		checkServiceAvailability: vi.fn().mockResolvedValue(undefined),
		addRd: vi.fn().mockResolvedValue(undefined),
		addAd: vi.fn().mockResolvedValue(undefined),
		addTb: vi.fn().mockResolvedValue(undefined),
		addPm: vi.fn().mockResolvedValue(undefined),
		addOc: vi.fn().mockResolvedValue(undefined),
		addDl: vi.fn().mockResolvedValue(undefined),
		deleteRd: vi.fn().mockResolvedValue(undefined),
		deleteAd: vi.fn().mockResolvedValue(undefined),
		deleteTb: vi.fn().mockResolvedValue(undefined),
		deletePm: vi.fn().mockResolvedValue(undefined),
		deleteOc: vi.fn().mockResolvedValue(undefined),
		deleteDl: vi.fn().mockResolvedValue(undefined),
		imdbId: 'tt456',
		isHashServiceChecking: () => false,
		...override,
	};

	return {
		...render(<TvSearchResults {...props} />),
		props,
	};
};

describe('TvSearchResults', () => {
	beforeEach(() => {
		localStorage.clear();
		downloadSpy.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it('casts episodes with matching filenames', async () => {
		const { props } = renderTv();
		const castButton = await screen.findByRole('button', { name: /Cast \(RD\)/i });
		await userEvent.click(castButton);
		await waitFor(() => expect(props.handleCast).toHaveBeenCalledWith('tv-hash', ['1']));
	});

	// Regression: the four availability checks run concurrently and each
	// overwrites `files`, so reading the ids off `files` casts with whichever
	// provider answered last. RD file ids and TorBox file ids are different
	// numbering systems - sending one to the other picks a different episode.
	it('casts RD with RD file ids even when a TorBox check overwrote files', async () => {
		const contaminated: SearchResult = {
			...baseTvResult,
			tbAvailable: true,
			// TorBox answered last, so `files` carries TorBox's numbering
			files: [{ fileId: 8, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
			rdFiles: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
			tbFiles: [{ fileId: 8, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
		};
		const { props } = renderTv({ filteredResults: [contaminated], torboxKey: 'tb' });

		await userEvent.click(await screen.findByRole('button', { name: /Cast \(RD\)/i }));
		await waitFor(() => expect(props.handleCast).toHaveBeenCalledWith('tv-hash', ['1']));
	});

	it('casts TorBox with TorBox file ids even when an RD check overwrote files', async () => {
		const contaminated: SearchResult = {
			...baseTvResult,
			tbAvailable: true,
			// RD answered last, so `files` carries RD's numbering
			files: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
			rdFiles: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
			tbFiles: [{ fileId: 8, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
		};
		const handleCastTorBox = vi.fn().mockResolvedValue(undefined);
		renderTv({ filteredResults: [contaminated], torboxKey: 'tb', handleCastTorBox });

		await userEvent.click(await screen.findByRole('button', { name: /Cast \(TB\)/i }));
		await waitFor(() => expect(handleCastTorBox).toHaveBeenCalledWith('tv-hash', ['8']));
	});

	// No trustworthy ids means no cast button - offering one would cast a guess.
	it('hides the TorBox cast button when no TorBox file ids are known', () => {
		const noTbIds: SearchResult = { ...baseTvResult, tbAvailable: true, tbFiles: undefined };
		renderTv({
			filteredResults: [noTbIds],
			torboxKey: 'tb',
			handleCastTorBox: vi.fn().mockResolvedValue(undefined),
		});

		expect(screen.queryByRole('button', { name: /Cast \(TB\)/i })).toBeNull();
	});

	it('checks availability for uncached torrents', async () => {
		const uncachedResult = { ...baseTvResult, rdAvailable: false };
		const { props } = renderTv({
			filteredResults: [uncachedResult],
			hashAndProgress: { 'rd:tv-hash': 50 },
		});

		await userEvent.click(screen.getByRole('button', { name: /Check RD/i }));
		await waitFor(() => expect(props.checkServiceAvailability).toHaveBeenCalled());
	});

	it('downloads magnets when setting enabled', async () => {
		localStorage.setItem('settings:downloadMagnets', 'true');
		renderTv();
		await userEvent.click(screen.getByRole('button', { name: /Download/i }));
		expect(downloadSpy).toHaveBeenCalledWith('tv-hash');
	});

	// The action row reads left to right as "what each service can do", then the
	// things that are not tied to a service. Watch used to sit inside the RD
	// group, which made it look like an RD action when it picks its own service.
	describe('action row grouping', () => {
		const everywhere = {
			...baseTvResult,
			rdAvailable: false,
			adAvailable: true,
			tbAvailable: true,
			pmAvailable: false,
		};

		const labelsInOrder = (container: HTMLElement) =>
			Array.from(container.querySelectorAll('button')).map((b) =>
				(b.textContent || '').replace(/\s+/g, ' ').trim()
			);

		const indexOfLabel = (labels: string[], needle: string) =>
			labels.findIndex((l) => l.includes(needle));

		it('orders provider buttons RD then AD then TB, ahead of the shared actions', () => {
			const { container } = renderTv({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendTbToRd: vi.fn(),
				handleCastAllDebrid: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			const labels = labelsInOrder(container);
			const rd = indexOfLabel(labels, 'Check RD');
			const ad = indexOfLabel(labels, 'Instant AD');
			const tb = indexOfLabel(labels, 'Instant TB');
			const tbToRd = indexOfLabel(labels, 'TB \u2192 RD');
			const watch = indexOfLabel(labels, 'Watch');
			const copy = indexOfLabel(labels, 'Copy');

			expect([rd, ad, tb, tbToRd, watch, copy].every((i) => i >= 0)).toBe(true);
			// RD group, then AD group, then TB group
			expect(rd).toBeLessThan(ad);
			expect(ad).toBeLessThan(tb);
			expect(tb).toBeLessThan(watch);
			expect(tbToRd).toBeLessThan(watch);
			// then the service-agnostic tail
			expect(watch).toBeLessThan(copy);
		});

		it('draws a separator between the provider group and the shared actions', () => {
			const { container } = renderTv({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendTbToRd: vi.fn(),
				handleCastAllDebrid: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			expect(container.querySelector('[data-action-separator]')).not.toBeNull();
		});

		// A rule only earns its place between two groups that both rendered
		// something - otherwise a user with one service gets a stray line.
		it('rules off each service group when the neighbouring group exists', () => {
			const { container } = renderTv({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendTbToRd: vi.fn(),
				handleCastAllDebrid: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			expect(container.querySelectorAll('[data-action-separator]')).toHaveLength(3);

			const row = container.querySelector('[data-action-separator]')!.parentElement!;
			const kinds = Array.from(row.children).map((e) =>
				e.hasAttribute('data-action-separator')
					? 'hr'
					: (e.textContent || '').replace(/\s+/g, ' ').trim()
			);
			const ruleAt = kinds.reduce<number[]>(
				(acc, k, i) => (k === 'hr' ? [...acc, i] : acc),
				[]
			);

			// never leading, never trailing, never two in a row
			expect(ruleAt[0]).toBeGreaterThan(0);
			expect(ruleAt[ruleAt.length - 1]).toBeLessThan(kinds.length - 1);
			expect(ruleAt.some((i) => kinds[i + 1] === 'hr')).toBe(false);

			// each rule lands on a service boundary
			expect(kinds[ruleAt[0] + 1]).toContain('AD');
			expect(kinds[ruleAt[1] + 1]).toContain('TB');
			expect(kinds[ruleAt[2] + 1]).toContain('Watch');
		});

		it('draws only the shared-actions rule when one service is logged in', () => {
			const { container } = renderTv({
				rdKey: 'rd-key',
				adKey: null,
				torboxKey: null,
				premiumizeKey: null,
				player: 'windows/vlc',
				filteredResults: [everywhere],
			});

			expect(container.querySelectorAll('[data-action-separator]')).toHaveLength(1);
		});

		it('skips the rule for a service that is not logged in', () => {
			const { container } = renderTv({
				rdKey: 'rd-key',
				adKey: null,
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendTbToRd: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			// RD | TB | shared - no phantom rule where AllDebrid would have been
			expect(container.querySelectorAll('[data-action-separator]')).toHaveLength(2);
		});

		it('leaves the separator out when no service button is shown', () => {
			const { container } = renderTv({
				rdKey: null,
				adKey: null,
				torboxKey: null,
				premiumizeKey: null,
				player: 'windows/vlc',
				filteredResults: [everywhere],
			});

			expect(container.querySelector('[data-action-separator]')).toBeNull();
		});
	});

	describe('Premiumize watch', () => {
		it('offers no per-row Premiumize check button', () => {
			// Same as the movie grid: the load-time PM probe is the whole check,
			// so a per-row repeat of it is dead weight.
			renderTv({
				rdKey: 'rd-key',
				premiumizeKey: 'pm-key',
				filteredResults: [{ ...baseTvResult, rdAvailable: false, pmAvailable: false }],
			});

			expect(screen.queryByRole('button', { name: /Check PM/i })).toBeNull();
			expect(screen.getByRole('button', { name: /Check RD/i })).toBeTruthy();
		});

		it('hands the Premiumize key to openWatch for a PM-cached result', async () => {
			openWatchSpy.mockClear();
			renderTv({
				rdKey: null,
				premiumizeKey: 'pm-key',
				player: 'windows/vlc',
				filteredResults: [{ ...baseTvResult, rdAvailable: false, pmAvailable: true }],
			});

			await userEvent.click(screen.getByTitle('Watch via Premiumize'));

			await waitFor(() => expect(openWatchSpy).toHaveBeenCalledTimes(1));
			expect(openWatchSpy.mock.calls[0][0]).toMatchObject({
				service: 'pm',
				keys: expect.objectContaining({ premiumizeKey: 'pm-key' }),
			});
		});
	});

	describe('Premiumize cast', () => {
		// Premiumize's `cache/check` is the only availability probe that returns
		// no file listing, so a browser holding only a PM key never learns the
		// episode filenames. Gating the button on a client-side listing is what
		// made Cast (PM) a movies-only button.
		it('offers Cast (PM) for a PM-cached show with no file listing', async () => {
			const handleCastPremiumize = vi.fn().mockResolvedValue(undefined);
			renderTv({
				rdKey: null,
				premiumizeKey: 'pm-key',
				handleCastPremiumize,
				filteredResults: [
					{
						...baseTvResult,
						rdAvailable: false,
						pmAvailable: true,
						files: [],
						rdFiles: undefined,
					},
				],
			});

			await userEvent.click(screen.getByText('Cast (PM)'));

			await waitFor(() => expect(handleCastPremiumize).toHaveBeenCalledTimes(1));
			// The hash is all the server needs - it resolves the episodes itself.
			expect(handleCastPremiumize).toHaveBeenCalledWith('tv-hash');
		});

		it('does not offer Cast (PM) for a show that is not cached in Premiumize', () => {
			renderTv({
				rdKey: null,
				premiumizeKey: 'pm-key',
				handleCastPremiumize: vi.fn(),
				filteredResults: [{ ...baseTvResult, rdAvailable: false, pmAvailable: false }],
			});

			expect(screen.queryByText('Cast (PM)')).toBeNull();
		});
	});
	describe('Offcloud', () => {
		it('adds and removes through the Offcloud handlers', async () => {
			const { props } = renderTv({
				offcloudKey: 'oc-key',
				filteredResults: [{ ...baseTvResult, ocAvailable: true }],
			});

			await userEvent.click(screen.getByRole('button', { name: /Instant OC/i }));
			await waitFor(() => expect(props.addOc).toHaveBeenCalledWith('tv-hash'));
		});

		it('offers RM instead of add once the row is in the Offcloud library', async () => {
			const { props } = renderTv({
				offcloudKey: 'oc-key',
				hashAndProgress: { 'oc:tv-hash': 100 },
			});

			expect(screen.queryByRole('button', { name: /DL with OC/i })).toBeNull();
			await userEvent.click(screen.getByRole('button', { name: /OC \(100%\)/i }));
			await waitFor(() => expect(props.deleteOc).toHaveBeenCalledWith('tv-hash'));
		});

		it('styles the add button with a literal class, never an assembled one', () => {
			renderTv({
				offcloudKey: 'oc-key',
				filteredResults: [{ ...baseTvResult, ocAvailable: true }],
			});

			const button = screen.getByRole('button', { name: /Instant OC/i });
			expect(button.className).toContain('border-green-500');
			expect(button.className).not.toContain('${');
		});

		it('offers no per-row Offcloud check button', () => {
			// Same as the movie grid: the load-time OC probe is the whole check,
			// so a per-row repeat of it is dead weight.
			renderTv({
				rdKey: 'rd-key',
				offcloudKey: 'oc-key',
				filteredResults: [{ ...baseTvResult, rdAvailable: false, ocAvailable: false }],
			});

			expect(screen.queryByRole('button', { name: /Check OC/i })).toBeNull();
			expect(screen.getByRole('button', { name: /Check RD/i })).toBeTruthy();
		});

		it('hands the Offcloud key to openWatch for an OC-cached result', async () => {
			openWatchSpy.mockClear();
			renderTv({
				rdKey: null,
				offcloudKey: 'oc-key',
				player: 'windows/vlc',
				filteredResults: [{ ...baseTvResult, rdAvailable: false, ocAvailable: true }],
			});

			await userEvent.click(screen.getByTitle('Watch via Offcloud'));

			await waitFor(() => expect(openWatchSpy).toHaveBeenCalledTimes(1));
			expect(openWatchSpy.mock.calls[0][0]).toMatchObject({
				service: 'oc',
				keys: expect.objectContaining({ offcloudKey: 'oc-key' }),
			});
		});

		it('keeps an OC-only cached row when "only cached" is on', () => {
			renderTv({
				onlyShowCached: true,
				offcloudKey: 'oc-key',
				filteredResults: [{ ...baseTvResult, rdAvailable: false, ocAvailable: true }],
			});

			expect(screen.getByText('Sample Show')).toBeTruthy();
		});
	});

	describe('Debrid-Link', () => {
		it('offers the add button on a row with no availability flag set anywhere', async () => {
			// Debrid-Link has no cache probe, so its button cannot be gated on one
			// and appears on every row - season packs included, with no file-list
			// gate either (the PM lesson from 2026-08-26).
			const { props } = renderTv({
				debridLinkKey: 'dl-key',
				filteredResults: [{ ...baseTvResult }],
			});

			await userEvent.click(screen.getByRole('button', { name: /Add to DL/i }));
			await waitFor(() => expect(props.addDl).toHaveBeenCalledWith('tv-hash'));
		});

		it('shows no DL badge, pill or check button', () => {
			renderTv({
				rdKey: 'rd-key',
				debridLinkKey: 'dl-key',
				filteredResults: [{ ...baseTvResult, rdAvailable: false }],
			});

			expect(screen.queryByRole('button', { name: /Check DL/i })).toBeNull();
			expect(screen.queryByRole('button', { name: /Instant DL/i })).toBeNull();
			expect(screen.getByRole('button', { name: /Check RD/i })).toBeTruthy();
		});

		it('offers RM instead of add once the row is in the Debrid-Link library', async () => {
			const { props } = renderTv({
				debridLinkKey: 'dl-key',
				hashAndProgress: { 'dl:tv-hash': 100 },
			});

			expect(screen.queryByRole('button', { name: /Add to DL/i })).toBeNull();
			await userEvent.click(screen.getByRole('button', { name: /DL \(100%\)/i }));
			await waitFor(() => expect(props.deleteDl).toHaveBeenCalledWith('tv-hash'));
		});

		it('styles the add button with a literal class, never an assembled one', () => {
			renderTv({
				debridLinkKey: 'dl-key',
				filteredResults: [{ ...baseTvResult }],
			});

			const button = screen.getByRole('button', { name: /Add to DL/i });
			expect(button.className).toContain('border-[#38bdf8]');
			expect(button.className).not.toContain('${');
		});

		it('hands the Debrid-Link credential to openWatch for a row in its library', async () => {
			openWatchSpy.mockClear();
			renderTv({
				rdKey: null,
				debridLinkKey: 'dl-key',
				player: 'windows/vlc',
				hashAndProgress: { 'dl:tv-hash': 100 },
			});

			await userEvent.click(screen.getByTitle('Watch via Debrid-Link'));

			await waitFor(() => expect(openWatchSpy).toHaveBeenCalledTimes(1));
			expect(openWatchSpy.mock.calls[0][0]).toMatchObject({
				service: 'dl',
				keys: expect.objectContaining({ debridLinkKey: 'dl-key' }),
			});
		});

		it('renders nothing at all without a Debrid-Link credential', () => {
			renderTv({
				debridLinkKey: null,
				hashAndProgress: { 'dl:tv-hash': 100 },
			});

			expect(screen.queryByRole('button', { name: /Add to DL/i })).toBeNull();
			expect(screen.queryByRole('button', { name: /DL \(100%\)/i })).toBeNull();
		});
	});
});
