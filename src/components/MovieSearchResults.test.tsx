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
});
