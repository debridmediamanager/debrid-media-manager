import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleReinsertTorrentinRd,
	handleRestartTbTorrent,
	handleRestartTorrent,
} from '@/utils/addMagnet';
import {
	handleDeleteAdTorrent,
	handleDeletePmTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import LibraryTorrentRow from './LibraryTorrentRow';

// Mock dependencies
vi.mock('@/utils/addMagnet');
vi.mock('@/utils/deleteTorrent');
vi.mock('@/utils/copyMagnet');
vi.mock('@/utils/hashList');
vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));
vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			traktClientId: 'test-trakt-client-id',
		},
	}),
}));

const mockHandleReinsertTorrentinRd = handleReinsertTorrentinRd as MockedFunction<
	typeof handleReinsertTorrentinRd
>;
const mockHandleRestartTorrent = handleRestartTorrent as MockedFunction<
	typeof handleRestartTorrent
>;
const mockHandleDeleteRdTorrent = handleDeleteRdTorrent as MockedFunction<
	typeof handleDeleteRdTorrent
>;
const mockHandleDeleteAdTorrent = handleDeleteAdTorrent as MockedFunction<
	typeof handleDeleteAdTorrent
>;
const mockHandleDeleteTbTorrent = handleDeleteTbTorrent as MockedFunction<
	typeof handleDeleteTbTorrent
>;
const mockHandleRestartTbTorrent = handleRestartTbTorrent as MockedFunction<
	typeof handleRestartTbTorrent
>;
const mockHandleDeletePmTorrent = handleDeletePmTorrent as MockedFunction<
	typeof handleDeletePmTorrent
>;

describe('LibraryTorrentRow Reinsert Functionality', () => {
	const mockRouter = {
		push: vi.fn(),
		query: {},
	};

	const mockTorrent: UserTorrent = {
		id: 'rd:123',
		hash: 'abc123hash',
		filename: 'test.mkv',
		title: 'Test Movie',
		bytes: 1000000000,
		progress: 100,
		status: UserTorrentStatus.finished,
		serviceStatus: 'downloaded',
		added: new Date('2024-01-01'),
		mediaType: 'movie',
		links: ['link1', 'link2'],
		selectedFiles: [],
		seeders: 10,
		speed: 0,
	};

	const defaultProps = {
		torrent: mockTorrent,
		rdKey: 'test-rd-key',
		adKey: null,
		tbKey: null,
		pmKey: null,
		shouldDownloadMagnets: false,
		hashGrouping: {},
		titleGrouping: {},
		tvGroupingByTitle: {},
		isSelected: false,
		onSelect: vi.fn(),
		onDelete: vi.fn(),
		onShowInfo: vi.fn(),
		onTypeChange: vi.fn(),
		onRefreshLibrary: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue?.(mockRouter);
		// For safety if not using vi.fn return, set directly
		// @ts-ignore - test mock setup
		(useRouter as any).mockReturnValue?.(mockRouter);
	});

	describe('Premiumize cast button', () => {
		const pmProps = (overrides: Partial<UserTorrent> = {}) => ({
			...defaultProps,
			rdKey: null,
			pmKey: 'test-pm-key',
			torrent: { ...mockTorrent, id: 'pm:abc', hash: 'f'.repeat(40), ...overrides },
		});

		it('renders for a Premiumize row that reports an info hash', () => {
			const { container } = render(<LibraryTorrentRow {...pmProps()} />);
			expect(container.querySelector('button[title="Cast (PM)"]')).toBeInTheDocument();
		});

		// A row whose transfer record was cleared reports no info hash, and
		// Premiumize resolves a cast from the hash alone - so there is nothing to
		// cast and the button must not be offered.
		it('is hidden when the row has no info hash', () => {
			const { container } = render(<LibraryTorrentRow {...pmProps({ hash: '' })} />);
			expect(container.querySelector('button[title="Cast (PM)"]')).not.toBeInTheDocument();
		});

		it('is hidden without a Premiumize key', () => {
			const { container } = render(<LibraryTorrentRow {...pmProps()} pmKey={null} />);
			expect(container.querySelector('button[title="Cast (PM)"]')).not.toBeInTheDocument();
		});

		it('posts the key as a bearer token, never in the URL', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				json: async () => ({ status: 'success', redirectUrl: '/x' }),
			});
			vi.stubGlobal('fetch', fetchMock);

			const { container } = render(<LibraryTorrentRow {...pmProps()} />);
			fireEvent.click(container.querySelector('button[title="Cast (PM)"]')!);
			await waitFor(() => expect(fetchMock).toHaveBeenCalled());

			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe(`/api/stremio-pm/cast/library/${'f'.repeat(40)}`);
			expect(url).not.toContain('test-pm-key');
			expect(init.headers.Authorization).toBe('Bearer test-pm-key');
		});
	});

	describe('Reinsert Button Click', () => {
		it('should call handleReinsertTorrentinRd without selectedFileIds for RD torrents', async () => {
			mockHandleReinsertTorrentinRd.mockResolvedValueOnce('rd:reinserted');

			const { container } = render(<LibraryTorrentRow {...defaultProps} />);

			// Find the reinsert button
			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			expect(reinsertButton).toBeInTheDocument();

			// Click the reinsert button
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				// Should call handleReinsertTorrentinRd with no selectedFileIds
				expect(mockHandleReinsertTorrentinRd).toHaveBeenCalledWith(
					'test-rd-key',
					mockTorrent,
					true
				);
				// Should NOT pass selectedFileIds since the function handles it internally
				expect(mockHandleReinsertTorrentinRd).toHaveBeenCalledTimes(1);
				expect(mockHandleReinsertTorrentinRd.mock.calls[0].length).toBe(3);
			});

			// Should call onDelete after successful reinsert
			expect(defaultProps.onDelete).toHaveBeenCalledWith('rd:123');

			// Should refresh library
			expect(defaultProps.onRefreshLibrary).toHaveBeenCalled();
		});

		it('should handle AllDebrid torrents differently', async () => {
			const adTorrent = { ...mockTorrent, id: 'ad:456' };
			const adProps = {
				...defaultProps,
				torrent: adTorrent,
				rdKey: null,
				adKey: 'test-ad-key',
			};

			mockHandleRestartTorrent.mockResolvedValueOnce(undefined);

			const { container } = render(<LibraryTorrentRow {...adProps} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				// Should call handleRestartTorrent for AD
				expect(mockHandleRestartTorrent).toHaveBeenCalledWith('test-ad-key', 'ad:456');
				// Should NOT call RD reinsert
				expect(mockHandleReinsertTorrentinRd).not.toHaveBeenCalled();
			});

			// Should still refresh library
			expect(adProps.onRefreshLibrary).toHaveBeenCalled();
		});

		it('should call appropriate restart function for TB torrents', async () => {
			const tbTorrent = { ...mockTorrent, id: 'tb:789' };
			const tbProps = {
				...defaultProps,
				torrent: tbTorrent,
				rdKey: null,
				adKey: null,
				tbKey: 'test-tb-key',
			};

			mockHandleRestartTbTorrent.mockResolvedValueOnce(undefined);

			const { container } = render(<LibraryTorrentRow {...tbProps} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				// Should call handleRestartTbTorrent for TB
				expect(mockHandleRestartTbTorrent).toHaveBeenCalledWith('test-tb-key', 'tb:789');
				// Should NOT call RD reinsert or AD restart
				expect(mockHandleReinsertTorrentinRd).not.toHaveBeenCalled();
				expect(mockHandleRestartTorrent).not.toHaveBeenCalled();
			});

			// Should still refresh library
			expect(tbProps.onRefreshLibrary).toHaveBeenCalled();
		});

		it('waits for RD reinsertion before refreshing library', async () => {
			const refreshSpy = vi.fn();
			const onDelete = vi.fn();
			let resolveReinsert: ((value: string) => void) | undefined;
			const reinsertPromise = new Promise<string>((resolve) => {
				resolveReinsert = resolve;
			});

			mockHandleReinsertTorrentinRd.mockReturnValueOnce(reinsertPromise);

			const { container } = render(
				<LibraryTorrentRow
					{...defaultProps}
					onRefreshLibrary={refreshSpy}
					onDelete={onDelete}
				/>
			);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				expect(mockHandleReinsertTorrentinRd).toHaveBeenCalledWith(
					'test-rd-key',
					expect.any(Object),
					true
				);
			});

			expect(refreshSpy).not.toHaveBeenCalled();
			expect(onDelete).not.toHaveBeenCalled();
			expect(typeof resolveReinsert).toBe('function');

			resolveReinsert?.('rd:deferred');

			await waitFor(() => {
				expect(refreshSpy).toHaveBeenCalled();
				expect(onDelete).toHaveBeenCalledWith('rd:123');
			});
		});

		it('should handle errors gracefully', async () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const error = new Error('Reinsert failed');
			mockHandleReinsertTorrentinRd.mockRejectedValueOnce(error);

			const { container } = render(<LibraryTorrentRow {...defaultProps} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				expect(consoleErrorSpy).toHaveBeenCalledWith(error);
			});

			// Should NOT call onDelete or refresh on error
			expect(defaultProps.onDelete).not.toHaveBeenCalled();
			expect(defaultProps.onRefreshLibrary).not.toHaveBeenCalled();

			consoleErrorSpy.mockRestore();
		});

		it('should stop event propagation to prevent row click', async () => {
			mockHandleReinsertTorrentinRd.mockResolvedValueOnce('rd:reinserted-again');

			const { container } = render(<LibraryTorrentRow {...defaultProps} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			const clickEvent = new MouseEvent('click', { bubbles: true });
			const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

			fireEvent(reinsertButton!, clickEvent);

			expect(stopPropagationSpy).toHaveBeenCalled();
		});
	});

	describe('Added Column Formatting', () => {
		it('formats added timestamp using UTC timezone', () => {
			const spy = vi.spyOn(Date.prototype, 'toLocaleString');
			try {
				render(<LibraryTorrentRow {...defaultProps} />);

				const sawUtc = spy.mock.calls.some(
					([localeArg, optionsArg]) =>
						localeArg === undefined &&
						Boolean(
							optionsArg &&
								typeof optionsArg === 'object' &&
								'timeZone' in optionsArg &&
								optionsArg.timeZone === 'UTC'
						)
				);
				expect(sawUtc).toBe(true);
			} finally {
				spy.mockRestore();
			}
		});
	});

	describe('Delete Button', () => {
		it('should call appropriate delete function for RD torrents', async () => {
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			const { container } = render(<LibraryTorrentRow {...defaultProps} />);

			const deleteButton = container.querySelector('button[title="Delete"]');
			fireEvent.click(deleteButton!);

			await waitFor(() => {
				expect(mockHandleDeleteRdTorrent).toHaveBeenCalledWith('test-rd-key', 'rd:123');
				expect(defaultProps.onDelete).toHaveBeenCalledWith('rd:123');
			});
		});

		it('should call appropriate delete function for AD torrents', async () => {
			const adTorrent = { ...mockTorrent, id: 'ad:456' };
			const adProps = {
				...defaultProps,
				torrent: adTorrent,
				rdKey: null,
				adKey: 'test-ad-key',
			};

			mockHandleDeleteAdTorrent.mockResolvedValueOnce(true);

			const { container } = render(<LibraryTorrentRow {...adProps} />);

			const deleteButton = container.querySelector('button[title="Delete"]');
			fireEvent.click(deleteButton!);

			await waitFor(() => {
				expect(mockHandleDeleteAdTorrent).toHaveBeenCalledWith('test-ad-key', 'ad:456');
				expect(adProps.onDelete).toHaveBeenCalledWith('ad:456');
			});
		});

		it('should call appropriate delete function for TB torrents', async () => {
			const tbTorrent = { ...mockTorrent, id: 'tb:789' };
			const tbProps = {
				...defaultProps,
				torrent: tbTorrent,
				rdKey: null,
				adKey: null,
				tbKey: 'test-tb-key',
			};

			mockHandleDeleteTbTorrent.mockResolvedValueOnce(true);

			const { container } = render(<LibraryTorrentRow {...tbProps} />);

			const deleteButton = container.querySelector('button[title="Delete"]');
			fireEvent.click(deleteButton!);

			await waitFor(() => {
				expect(mockHandleDeleteTbTorrent).toHaveBeenCalledWith('test-tb-key', 'tb:789');
				expect(tbProps.onDelete).toHaveBeenCalledWith('tb:789');
			});
		});
	});

	describe('Cast Quick Action', () => {
		it('calls cast API endpoint for RD torrents when rdKey is present', async () => {
			const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
				json: () => Promise.resolve({ status: 'success', redirectUrl: 'stremio://test' }),
			} as Response);
			render(<LibraryTorrentRow {...defaultProps} />);
			const castButton = screen.getByTitle('Cast (RD)');
			fireEvent.click(castButton);
			const expectedUrl = `/api/stremio/cast/library/${mockTorrent.id.substring(3)}:${mockTorrent.hash}`;
			await waitFor(() => {
				// The key rides in the header: a query parameter is written
				// verbatim into every access log on the way, and an RD apitoken
				// key never expires.
				expect(fetchSpy).toHaveBeenCalledWith(expectedUrl, {
					headers: { Authorization: `Bearer ${defaultProps.rdKey}` },
				});
			});
			fetchSpy.mockRestore();
		});

		it('hides cast button when rdKey is missing', () => {
			const { queryByTitle } = render(<LibraryTorrentRow {...defaultProps} rdKey={null} />);
			expect(queryByTitle('Cast (RD)')).not.toBeInTheDocument();
		});

		it('hides cast button for non-RD torrents', () => {
			const { queryByTitle } = render(
				<LibraryTorrentRow
					{...defaultProps}
					torrent={{ ...defaultProps.torrent, id: 'ad:456' }}
				/>
			);
			expect(queryByTitle('Cast (RD)')).not.toBeInTheDocument();
		});
	});

	describe('Row Display', () => {
		it('should display torrent information correctly', () => {
			render(<LibraryTorrentRow {...defaultProps} />);

			// Check title is displayed
			expect(screen.getByText('Test Movie')).toBeInTheDocument();

			// Check file size (approx 1GB in GiB units)
			expect(screen.getByText('0.9 GB')).toBeInTheDocument();

			// Check status for finished torrent
			expect(screen.getByText('Downloaded')).toBeInTheDocument();
		});

		it('should show progress for downloading torrents', () => {
			const downloadingTorrent = {
				...mockTorrent,
				status: UserTorrentStatus.downloading,
				progress: 45.67,
				seeders: 5,
				speed: 1000000,
			};

			render(<LibraryTorrentRow {...defaultProps} torrent={downloadingTorrent} />);

			// Check progress percentage
			expect(screen.getByText('45.67%')).toBeInTheDocument();

			// Check seeders
			expect(screen.getByText('5')).toBeInTheDocument();

			// Check speed (1 MB/s)
			expect(screen.getByText('1 MB/s')).toBeInTheDocument();
		});

		it('should apply selected styling when selected', () => {
			const { container } = render(<LibraryTorrentRow {...defaultProps} isSelected={true} />);

			const row = container.querySelector('tr');
			expect(row).toHaveClass('bg-green-800');
		});
	});

	describe('Conditional Rendering', () => {
		it('should not call reinsert if no rdKey for RD torrent', async () => {
			const propsNoRdKey = { ...defaultProps, rdKey: null };

			const { container } = render(<LibraryTorrentRow {...propsNoRdKey} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				expect(mockHandleReinsertTorrentinRd).not.toHaveBeenCalled();
			});
		});

		it('should not call reinsert if no adKey for AD torrent', async () => {
			const adTorrent = { ...mockTorrent, id: 'ad:456' };
			const propsNoAdKey = {
				...defaultProps,
				torrent: adTorrent,
				rdKey: null,
				adKey: null,
			};

			const { container } = render(<LibraryTorrentRow {...propsNoAdKey} />);

			const reinsertButton = container.querySelector('button[title="Reinsert"]');
			fireEvent.click(reinsertButton!);

			await waitFor(() => {
				expect(mockHandleRestartTorrent).not.toHaveBeenCalled();
			});
		});
	});

	describe('Premiumize rows', () => {
		const pmProps = (over: Partial<UserTorrent> = {}) => ({
			...defaultProps,
			rdKey: null,
			pmKey: 'test-pm-key',
			torrent: {
				...mockTorrent,
				id: 'pm:tC_c5ShzmbWdwiIc-KMP_5A',
				hash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
				serviceStatus: 'finished',
				...over,
			},
		});

		it('deletes through the Premiumize path, not another service', async () => {
			mockHandleDeletePmTorrent.mockResolvedValueOnce(true);
			const onDelete = vi.fn();

			const { container } = render(<LibraryTorrentRow {...pmProps()} onDelete={onDelete} />);
			fireEvent.click(container.querySelector('button[title="Delete"]')!);

			await waitFor(() =>
				expect(mockHandleDeletePmTorrent).toHaveBeenCalledWith(
					'test-pm-key',
					'pm:tC_c5ShzmbWdwiIc-KMP_5A'
				)
			);
			expect(mockHandleDeleteRdTorrent).not.toHaveBeenCalled();
			expect(mockHandleDeleteTbTorrent).not.toHaveBeenCalled();
			expect(onDelete).toHaveBeenCalledWith('pm:tC_c5ShzmbWdwiIc-KMP_5A');
		});

		it('offers magnet actions while the transfer still reports a hash', () => {
			const { container } = render(<LibraryTorrentRow {...pmProps()} />);

			expect(container.querySelector('button[title="Share"]')).toBeInTheDocument();
			expect(container.querySelector('button[title="Copy magnet url"]')).toBeInTheDocument();
		});

		it('hides magnet actions on cloud content with no hash left', () => {
			// transfer/clearfinished leaves the files and takes the record, and
			// with it the only route to the info hash.
			const { container } = render(
				<LibraryTorrentRow {...pmProps({ id: 'pm:fhp92DFAmxWqvNFC_IzGbWw', hash: '' })} />
			);

			expect(container.querySelector('button[title="Share"]')).not.toBeInTheDocument();
			expect(
				container.querySelector('button[title="Copy magnet url"]')
			).not.toBeInTheDocument();
			expect(container.querySelector('button[title="Delete"]')).toBeInTheDocument();
		});

		it('shows a Premiumize status in words', () => {
			const { container } = render(
				<LibraryTorrentRow {...pmProps({ serviceStatus: 'stored' })} />
			);

			expect(container.textContent).toContain('In cloud');
		});
	});
});
