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
	files: [{ fileId: 1, filename: 'Sample.S01E01.1080p.mkv', filesize: 1024 * 10 }],
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
			const { container } = renderTv({
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
			const { container } = renderTv({
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
});
