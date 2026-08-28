import type { SearchResult } from '@/services/mediasearch';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MovieSearchResults from './MovieSearchResults';

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

const baseResult: SearchResult = {
	title: 'Sample Movie',
	fileSize: 1024 * 10,
	hash: 'hash1',
	rdAvailable: false,
	adAvailable: false,
	tbAvailable: false,
	pmAvailable: false,
	files: [{ fileId: 1, filename: 'Sample.mkv', filesize: 1024 * 10 }],
	noVideos: false,
	medianFileSize: 10,
	biggestFileSize: 10,
	videoCount: 1,
	imdbId: 'tt123',
};

const renderComponent = (override?: Partial<React.ComponentProps<typeof MovieSearchResults>>) => {
	const props: React.ComponentProps<typeof MovieSearchResults> = {
		filteredResults: [baseResult],
		onlyShowCached: false,
		movieMaxSize: '20',
		rdKey: 'rd-key',
		adKey: null,
		torboxKey: null,
		premiumizeKey: null,
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
		deleteRd: vi.fn().mockResolvedValue(undefined),
		deleteAd: vi.fn().mockResolvedValue(undefined),
		deleteTb: vi.fn().mockResolvedValue(undefined),
		deletePm: vi.fn().mockResolvedValue(undefined),
		imdbId: 'tt123',
		isHashServiceChecking: () => false,
		...override,
	};

	return {
		...render(<MovieSearchResults {...props} />),
		props,
	};
};

describe('MovieSearchResults', () => {
	beforeEach(() => {
		localStorage.clear();
		downloadSpy.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it('adds torrents to RD and copies magnet links by default', async () => {
		const { props } = renderComponent();

		await userEvent.click(screen.getByRole('button', { name: /DL with RD/i }));
		await waitFor(() => expect(props.addRd).toHaveBeenCalledWith('hash1'));

		await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
		expect(props.handleCopyMagnet).toHaveBeenCalledWith('hash1');
		expect(downloadSpy).not.toHaveBeenCalled();
	});

	it('removes torrents from RD and triggers availability checks', async () => {
		const resultInLibrary: SearchResult = {
			...baseResult,
			hash: 'hash2',
		};
		const hashAndProgress = { 'rd:hash2': 75 };
		const { props } = renderComponent({
			filteredResults: [resultInLibrary],
			hashAndProgress,
		});

		await userEvent.click(screen.getByRole('button', { name: /RD \(75%\)/i }));
		await waitFor(() => expect(props.deleteRd).toHaveBeenCalledWith('hash2'));

		await userEvent.click(screen.getByRole('button', { name: /Check RD/i }));
		await waitFor(() => expect(props.checkServiceAvailability).toHaveBeenCalled());
	});

	it('downloads magnets when the setting is enabled', async () => {
		localStorage.setItem('settings:downloadMagnets', 'true');
		renderComponent();

		await userEvent.click(screen.getByRole('button', { name: /Download/i }));
		expect(downloadSpy).toHaveBeenCalledWith('hash1');
	});

	describe('TB → RD button', () => {
		const tbCachedResult: SearchResult = {
			...baseResult,
			tbAvailable: true,
			pmAvailable: false,
			rdAvailable: false,
		};

		it('shows when logged into both services and the result is TB-cached but not RD-cached', async () => {
			const sendTbToRd = vi.fn().mockResolvedValue(undefined);
			renderComponent({
				torboxKey: 'tb-key',
				sendTbToRd,
				filteredResults: [tbCachedResult],
			});

			await userEvent.click(screen.getByRole('button', { name: /TB → RD/i }));
			await waitFor(() => expect(sendTbToRd).toHaveBeenCalledWith('hash1'));
		});

		it('is hidden without a TorBox login', () => {
			renderComponent({
				torboxKey: null,
				sendTbToRd: vi.fn(),
				filteredResults: [tbCachedResult],
			});

			expect(screen.queryByRole('button', { name: /TB → RD/i })).toBeNull();
		});

		it('is hidden when the result is already RD-cached', () => {
			renderComponent({
				torboxKey: 'tb-key',
				sendTbToRd: vi.fn(),
				filteredResults: [{ ...tbCachedResult, rdAvailable: true }],
			});

			expect(screen.queryByRole('button', { name: /TB → RD/i })).toBeNull();
		});

		it('is hidden when the torrent is already in the RD library', () => {
			renderComponent({
				torboxKey: 'tb-key',
				sendTbToRd: vi.fn(),
				filteredResults: [tbCachedResult],
				hashAndProgress: { 'rd:hash1': 100 },
			});

			expect(screen.queryByRole('button', { name: /TB → RD/i })).toBeNull();
		});

		it('still shows on an RD-blocked (infringing) name — the transfer de-infringes it', async () => {
			const sendTbToRd = vi.fn().mockResolvedValue(undefined);
			renderComponent({
				torboxKey: 'tb-key',
				sendTbToRd,
				filteredResults: [
					{ ...tbCachedResult, title: 'Some.Movie.2024.1080p.WEB-DL.x264-GRP' },
				],
			});

			await userEvent.click(screen.getByRole('button', { name: /TB → RD/i }));
			await waitFor(() => expect(sendTbToRd).toHaveBeenCalledWith('hash1'));
		});
	});

	describe('AD → RD button', () => {
		const adCachedResult: SearchResult = {
			...baseResult,
			adAvailable: true,
			rdAvailable: false,
		};

		it('shows when logged into RD + AD and the result is AD-cached but not RD-cached', async () => {
			const sendAdToRd = vi.fn().mockResolvedValue(undefined);
			renderComponent({
				adKey: 'ad-key',
				sendAdToRd,
				filteredResults: [adCachedResult],
			});

			await userEvent.click(screen.getByRole('button', { name: /AD → RD/i }));
			await waitFor(() => expect(sendAdToRd).toHaveBeenCalledWith('hash1'));
		});

		it('is hidden without an AllDebrid login', () => {
			renderComponent({
				adKey: null,
				sendAdToRd: vi.fn(),
				filteredResults: [adCachedResult],
			});

			expect(screen.queryByRole('button', { name: /AD → RD/i })).toBeNull();
		});

		it('is hidden when the result is already RD-cached', () => {
			renderComponent({
				adKey: 'ad-key',
				sendAdToRd: vi.fn(),
				filteredResults: [{ ...adCachedResult, rdAvailable: true }],
			});

			expect(screen.queryByRole('button', { name: /AD → RD/i })).toBeNull();
		});
	});

	describe('size display', () => {
		it('shows the debrid file size when the source reported none', () => {
			// Peerflix-style result: filename as title, no size, then RD reports
			// the real bytes via the availability check
			renderComponent({
				movieMaxSize: '0',
				filteredResults: [
					{
						...baseResult,
						title: 'Michael.2026.BDRemux.2160p.HDR-DV.mkv',
						fileSize: 0,
						rdAvailable: true,
						videoCount: 1,
						medianFileSize: 80 * 1024,
						biggestFileSize: 80 * 1024,
						files: [
							{
								fileId: 1,
								filename: 'Michael.2026.BDRemux.2160p.HDR-DV.mkv',
								filesize: 80 * 1024 * 1024 * 1024,
							},
						],
					},
				],
			});

			expect(screen.getByText(/Total: 80\.00 GB/)).toBeTruthy();
			expect(screen.queryByText(/Total: 0\.00 GB/)).toBeNull();
		});

		it('still shows 0.00 GB when nothing at all is known', () => {
			renderComponent({
				movieMaxSize: '0',
				filteredResults: [
					{
						...baseResult,
						fileSize: 0,
						videoCount: 1,
						medianFileSize: 0,
						biggestFileSize: 0,
						files: [],
					},
				],
			});

			expect(screen.getByText(/Total: 0\.00 GB/)).toBeTruthy();
		});
	});

	// The action row reads left to right as "what each service can do", then the
	// things that are not tied to a service. Watch used to sit inside the RD
	// group, which made it look like an RD action when it picks its own service.
	describe('action row grouping', () => {
		const everywhere = {
			...baseResult,
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
			const { container } = renderComponent({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendAdToRd: vi.fn(),
				sendTbToRd: vi.fn(),
				handleCastAllDebrid: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			const labels = labelsInOrder(container);
			const rd = indexOfLabel(labels, 'Check RD');
			const ad = indexOfLabel(labels, 'Instant AD');
			const adToRd = indexOfLabel(labels, 'AD \u2192 RD');
			const tb = indexOfLabel(labels, 'Instant TB');
			const tbToRd = indexOfLabel(labels, 'TB \u2192 RD');
			const watch = indexOfLabel(labels, 'Watch');
			const copy = indexOfLabel(labels, 'Copy');

			expect([rd, ad, adToRd, tb, tbToRd, watch, copy].every((i) => i >= 0)).toBe(true);
			// RD group, then AD group, then TB group
			expect(rd).toBeLessThan(ad);
			expect(adToRd).toBeLessThan(tb);
			expect(tb).toBeLessThan(watch);
			expect(tbToRd).toBeLessThan(watch);
			// then the service-agnostic tail
			expect(watch).toBeLessThan(copy);
		});

		it('draws a separator between the provider group and the shared actions', () => {
			const { container } = renderComponent({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendAdToRd: vi.fn(),
				sendTbToRd: vi.fn(),
				handleCastAllDebrid: vi.fn(),
				handleCastTorBox: vi.fn(),
			});

			expect(container.querySelector('[data-action-separator]')).not.toBeNull();
		});

		// A rule only earns its place between two groups that both rendered
		// something - otherwise a user with one service gets a stray line.
		it('rules off each service group when the neighbouring group exists', () => {
			const { container } = renderComponent({
				rdKey: 'rd-key',
				adKey: 'ad-key',
				torboxKey: 'tb-key',
				player: 'windows/vlc',
				filteredResults: [everywhere],
				sendAdToRd: vi.fn(),
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
			const { container } = renderComponent({
				rdKey: 'rd-key',
				adKey: null,
				torboxKey: null,
				player: 'windows/vlc',
				filteredResults: [everywhere],
			});

			expect(container.querySelectorAll('[data-action-separator]')).toHaveLength(1);
		});

		it('skips the rule for a service that is not logged in', () => {
			const { container } = renderComponent({
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
			const { container } = renderComponent({
				rdKey: null,
				adKey: null,
				torboxKey: null,
				player: 'windows/vlc',
				filteredResults: [everywhere],
			});

			expect(container.querySelector('[data-action-separator]')).toBeNull();
		});
	});

	describe('Premiumize watch', () => {
		it('hands the Premiumize key to openWatch for a PM-cached result', async () => {
			// The render-time and click-time service picks are two separate calls;
			// leaving the key out of the second silently does nothing on click.
			openWatchSpy.mockClear();
			renderComponent({
				rdKey: null,
				premiumizeKey: 'pm-key',
				player: 'windows/vlc',
				filteredResults: [{ ...baseResult, rdAvailable: false, pmAvailable: true }],
			});

			await userEvent.click(screen.getByTitle('Watch via Premiumize'));

			await waitFor(() => expect(openWatchSpy).toHaveBeenCalledTimes(1));
			expect(openWatchSpy.mock.calls[0][0]).toMatchObject({
				service: 'pm',
				keys: expect.objectContaining({ premiumizeKey: 'pm-key' }),
			});
		});

		it('offers no per-row Premiumize check button', () => {
			// Page load already probes PM for every row with the same
			// `cache/check` call a per-row button would repeat, so there is
			// nothing left for it to find. RD has no such probe - its load-time
			// answer is DMM's database - so its check button stays.
			renderComponent({
				rdKey: 'rd-key',
				premiumizeKey: 'pm-key',
				filteredResults: [{ ...baseResult, rdAvailable: false, pmAvailable: false }],
			});

			expect(screen.queryByRole('button', { name: /Check PM/i })).toBeNull();
			expect(screen.getByRole('button', { name: /Check RD/i })).toBeTruthy();
		});

		it('offers no watch button when the user has no Premiumize key', () => {
			renderComponent({
				rdKey: null,
				premiumizeKey: null,
				player: 'windows/vlc',
				filteredResults: [{ ...baseResult, rdAvailable: false, pmAvailable: true }],
			});

			expect(screen.queryByTitle('Watch via Premiumize')).toBeNull();
		});
	});
});
