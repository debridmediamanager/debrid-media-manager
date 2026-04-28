import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
	},
}));

vi.mock('./poster', () => ({
	__esModule: true,
	default: ({ imdbId }: { imdbId: string; title: string }) => (
		<div data-testid={`poster-${imdbId}`} />
	),
}));

import axios from 'axios';
import { CastSearchModal } from './CastSearchModal';

const mockOnClose = vi.fn();
const mockOnSelectImdbId = vi.fn();

const defaultProps = {
	isOpen: true,
	onClose: mockOnClose,
	torrentInfo: {
		title: 'Inception.2010.1080p.BluRay.x264',
		filename: 'Inception.2010.1080p.BluRay.x264.mkv',
		hash: 'abcdef1234567890abcdef1234567890abcdef12',
		files: [
			{ path: '/Inception.mkv', bytes: 5000000000 },
			{ path: '/Inception.srt', bytes: 50000 },
		],
	},
	onSelectImdbId: mockOnSelectImdbId,
};

describe('CastSearchModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns null when not open', () => {
		const { container } = render(<CastSearchModal {...defaultProps} isOpen={false} />);
		expect(container.innerHTML).toBe('');
	});

	it('renders the modal with header and torrent info', () => {
		render(<CastSearchModal {...defaultProps} />);
		expect(screen.getByText('Cast to Stremio')).toBeInTheDocument();
		expect(screen.getByText(defaultProps.torrentInfo.filename)).toBeInTheDocument();
		expect(screen.getByText(/2 files/)).toBeInTheDocument();
		expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
	});

	it('renders the close button and calls onClose when clicked', () => {
		render(<CastSearchModal {...defaultProps} />);
		const closeButton = screen.getByLabelText('Close');
		fireEvent.click(closeButton);
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('initializes search input with cleaned torrent title', () => {
		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...') as HTMLInputElement;
		expect(input.value).toContain('Inception');
		expect(input.value).not.toContain('x264');
	});

	it('shows help text when query is too short', async () => {
		vi.useRealTimers();
		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'a' } });

		await waitFor(() => {
			expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();
		});
	});

	it('fetches suggestions after debounce and displays results', async () => {
		vi.useRealTimers();
		const mockResults = [
			{
				type: 'movie' as const,
				score: 100,
				movie: {
					title: 'Inception',
					year: 2010,
					ids: { imdb: 'tt1375666', trakt: 16662, slug: 'inception-2010', tmdb: 27205 },
				},
			},
		];

		(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResults });

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'Inception' } });

		await waitFor(
			() => {
				expect(screen.getByText('tt1375666')).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);
	});

	it('calls onSelectImdbId when a suggestion is clicked', async () => {
		vi.useRealTimers();
		const mockResults = [
			{
				type: 'movie' as const,
				score: 100,
				movie: {
					title: 'Inception',
					year: 2010,
					ids: { imdb: 'tt1375666', trakt: 16662, slug: 'inception-2010', tmdb: 27205 },
				},
			},
		];

		(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResults });

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'Inception' } });

		await waitFor(
			() => {
				expect(screen.getByText('tt1375666')).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);

		fireEvent.click(screen.getByText('tt1375666').closest('button')!);
		expect(mockOnSelectImdbId).toHaveBeenCalledWith('tt1375666');
	});

	it('shows no results message when search returns empty', async () => {
		vi.useRealTimers();
		(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'xyznonexistent' } });

		await waitFor(
			() => {
				expect(
					screen.getByText('No results found. Try a different search term.')
				).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);
	});

	it('handles API errors gracefully', async () => {
		vi.useRealTimers();
		(axios.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'Inception' } });

		await waitFor(
			() => {
				expect(
					screen.getByText('No results found. Try a different search term.')
				).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);
	});

	it('skips suggestions without imdb ids', async () => {
		vi.useRealTimers();
		const mockResults = [
			{
				type: 'movie' as const,
				score: 100,
				movie: {
					title: 'No IMDB',
					year: 2020,
					ids: { trakt: 123, slug: 'no-imdb', tmdb: 456 },
				},
			},
			{
				type: 'movie' as const,
				score: 90,
				movie: {
					title: 'Has IMDB',
					year: 2021,
					ids: { imdb: 'tt9999999', trakt: 789, slug: 'has-imdb', tmdb: 101 },
				},
			},
		];

		(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResults });

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'test query' } });

		await waitFor(
			() => {
				expect(screen.getByText('Has IMDB')).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);
		expect(screen.queryByText('No IMDB')).not.toBeInTheDocument();
	});

	it('displays show type results with TV Show label', async () => {
		vi.useRealTimers();
		const mockResults = [
			{
				type: 'show' as const,
				score: 100,
				show: {
					title: 'Breaking Bad',
					year: 2008,
					ids: { imdb: 'tt0903747', trakt: 1388, slug: 'breaking-bad', tmdb: 1396 },
				},
			},
		];

		(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResults });

		render(<CastSearchModal {...defaultProps} />);
		const input = screen.getByPlaceholderText('Type to search...');
		fireEvent.change(input, { target: { value: 'Breaking Bad' } });

		await waitFor(
			() => {
				expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
				expect(screen.getByText(/TV Show/)).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);
	});

	it('displays singular file count for single file torrents', () => {
		render(
			<CastSearchModal
				{...defaultProps}
				torrentInfo={{
					...defaultProps.torrentInfo,
					files: [{ path: '/movie.mkv', bytes: 5000000000 }],
				}}
			/>
		);
		expect(screen.getByText(/1 file/)).toBeInTheDocument();
		expect(screen.queryByText(/1 files/)).not.toBeInTheDocument();
	});
});
