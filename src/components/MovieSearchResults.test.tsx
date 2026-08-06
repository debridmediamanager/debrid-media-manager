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

const baseResult: SearchResult = {
	title: 'Sample Movie',
	fileSize: 1024 * 10,
	hash: 'hash1',
	rdAvailable: false,
	adAvailable: false,
	tbAvailable: false,
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
		player: '',
		hashAndProgress: {},
		handleShowInfo: vi.fn(),
		handleCast: vi.fn().mockResolvedValue(undefined),
		handleCopyMagnet: vi.fn(),
		checkServiceAvailability: vi.fn().mockResolvedValue(undefined),
		addRd: vi.fn().mockResolvedValue(undefined),
		addAd: vi.fn().mockResolvedValue(undefined),
		addTb: vi.fn().mockResolvedValue(undefined),
		deleteRd: vi.fn().mockResolvedValue(undefined),
		deleteAd: vi.fn().mockResolvedValue(undefined),
		deleteTb: vi.fn().mockResolvedValue(undefined),
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
});
