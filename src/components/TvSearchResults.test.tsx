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

const baseTvResult: SearchResult = {
	title: 'Sample Show',
	fileSize: 1024 * 20,
	hash: 'tv-hash',
	rdAvailable: true,
	adAvailable: false,
	tbAvailable: false,
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
});
