import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LibraryHelpText from './LibraryHelpText';
import LibraryLinkButton from './LibraryLinkButton';
import LibraryMenuButtons from './LibraryMenuButtons';
import LibrarySize from './LibrarySize';
import LibraryTableHeader from './LibraryTableHeader';
import { TraktSection } from './TraktSection';

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

describe('LibraryHelpText', () => {
	it('hides when help text is empty or explicitly hidden', () => {
		expect(
			render(<LibraryHelpText helpText="" onHide={vi.fn()} />).container.firstChild
		).toBeNull();
		expect(
			render(<LibraryHelpText helpText="hide" onHide={vi.fn()} />).container.firstChild
		).toBeNull();
	});

	it('renders message and triggers hide handler on click', async () => {
		const onHide = vi.fn();
		render(<LibraryHelpText helpText="Read the tooltip" onHide={onHide} />);

		await userEvent.click(screen.getByText('Read the tooltip'));
		expect(onHide).toHaveBeenCalledTimes(1);
	});
});

describe('LibrarySize', () => {
	const TB = 1024 ** 4;

	it('shows loading indicator while totals are pending', () => {
		render(<LibrarySize torrentCount={5} totalBytes={TB} isLoading />);
		expect(screen.getByText(/5 torrents/)).toHaveTextContent('💭');
	});

	it('maps total size to the correct mood indicator', () => {
		const cases: Array<[number, string]> = [
			[15000, '😱'],
			[1500, '😨'],
			[150, '😮'],
			[15, '🙂'],
			[5, '😐'],
			[0.5, '🙁'],
		];

		cases.forEach(([tb, emoji]) => {
			const { unmount } = render(
				<LibrarySize torrentCount={1} totalBytes={tb * TB} isLoading={false} />
			);
			const label = screen.getByText(/1 torrents/);
			expect(label).toHaveTextContent(emoji);
			expect(label).toHaveTextContent(`${tb.toFixed(1)} TB`);
			unmount();
		});
	});
});

describe('LibraryLinkButton', () => {
	it('renders styled link and propagates click events', async () => {
		const handleClick = vi.fn();
		render(
			<LibraryLinkButton href="/library/test" variant="amber" onClick={handleClick}>
				Go
			</LibraryLinkButton>
		);

		const link = screen.getByRole('link', { name: 'Go' });
		expect(link.getAttribute('href')).toBe('/library/test');
		expect(link.className).toContain('border-amber-500');

		await userEvent.click(link);
		expect(handleClick).toHaveBeenCalledTimes(1);
	});
});

describe('LibraryTableHeader', () => {
	it('displays counts and forwards sort requests for each column', async () => {
		const onSort = vi.fn();
		render(
			<table>
				<tbody>
					<LibraryTableHeader
						sortBy={{ column: 'id', direction: 'asc' }}
						onSort={onSort}
						filteredListLength={42}
						selectedTorrentsSize={3}
					/>
				</tbody>
			</table>
		);

		expect(screen.getByText(/Title \(42\)/)).toBeInTheDocument();
		expect(screen.getByText(/Select \(3\)/)).toHaveTextContent('↑');

		await userEvent.click(screen.getByText(/Select/));
		await userEvent.click(screen.getByText(/Title/));
		await userEvent.click(screen.getByText(/Size/));
		await userEvent.click(screen.getByText(/Status/));
		await userEvent.click(screen.getByText(/Added/));

		expect(onSort.mock.calls.map((call) => call[0])).toEqual([
			'id',
			'title',
			'bytes',
			'progress',
			'added',
		]);
	});
});

describe('LibraryMenuButtons', () => {
	it('controls pagination and reveals filter shortcuts when counts are provided', async () => {
		const onPrevPage = vi.fn();
		const onNextPage = vi.fn();
		const onResetFilters = vi.fn();
		render(
			<LibraryMenuButtons
				currentPage={1}
				maxPages={5}
				onPrevPage={onPrevPage}
				onNextPage={onNextPage}
				onResetFilters={onResetFilters}
				sameHashSize={2}
				sameTitleSize={3}
				selectedTorrentsSize={4}
				uncachedCount={1}
				inProgressCount={1}
				slowCount={1}
				failedCount={1}
				rdBlockedCount={0}
				activeStatus="samehash"
			/>
		);

		const prevButton = screen.getAllByRole('button')[0];
		expect(prevButton).toBeDisabled();
		await userEvent.click(prevButton);
		expect(onPrevPage).not.toHaveBeenCalled();

		const nextButton = screen.getAllByRole('button')[1];
		expect(nextButton).not.toBeDisabled();
		await userEvent.click(nextButton);
		expect(onNextPage).toHaveBeenCalledTimes(1);

		await userEvent.click(screen.getByRole('button', { name: /Reset/i }));
		expect(onResetFilters).toHaveBeenCalledTimes(1);

		expect(screen.getByRole('link', { name: /Same hash/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Same title/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Selected \(4\)/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Uncached/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /In progress/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /No seeds/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Failed/i })).toBeInTheDocument();
	});

	it('omits optional links when counts are zero and next/prev limits apply', async () => {
		const onPrevPage = vi.fn();
		const onNextPage = vi.fn();
		render(
			<LibraryMenuButtons
				currentPage={3}
				maxPages={3}
				onPrevPage={onPrevPage}
				onNextPage={onNextPage}
				onResetFilters={vi.fn()}
				sameHashSize={0}
				sameTitleSize={0}
				selectedTorrentsSize={0}
				uncachedCount={0}
				inProgressCount={0}
				slowCount={0}
				failedCount={0}
				rdBlockedCount={0}
			/>
		);

		const [prevButton, nextButton] = screen.getAllByRole('button');
		expect(prevButton).not.toBeDisabled();
		await userEvent.click(prevButton);
		expect(onPrevPage).toHaveBeenCalledTimes(1);

		expect(nextButton).toBeDisabled();
		await userEvent.click(nextButton);
		expect(onNextPage).not.toHaveBeenCalled();

		expect(screen.queryByText(/Same hash/)).toBeNull();
		expect(screen.queryByText(/Same title/)).toBeNull();
		expect(screen.queryByText(/Selected/)).toBeNull();
		['Uncached', 'In progress', 'No seeds', 'Failed'].forEach((label) => {
			expect(screen.queryByText(label)).toBeNull();
		});
	});
});

describe('TraktSection', () => {
	const traktUser = {
		user: {
			username: 'demo',
			private: false,
			vip: false,
			joined_at: new Date('2020-01-01').toISOString(),
		},
	} as any;

	it('always links to movies and shows and reveals watchlist shortcuts for authenticated users', () => {
		const { rerender } = render(<TraktSection traktUser={null} />);
		expect(screen.getByRole('link', { name: /Movies/i })).toHaveAttribute(
			'href',
			'/trakt/movies'
		);
		expect(screen.getByRole('link', { name: /Shows/i })).toHaveAttribute(
			'href',
			'/trakt/shows'
		);
		expect(screen.queryByRole('link', { name: /Watchlist/i })).toBeNull();

		rerender(<TraktSection traktUser={traktUser} />);
		expect(screen.getByRole('link', { name: /Watchlist/i })).toHaveAttribute(
			'href',
			'/trakt/watchlist'
		);
		expect(screen.getByRole('link', { name: /Collections/i })).toHaveAttribute(
			'href',
			'/trakt/collection'
		);
		expect(screen.getByRole('link', { name: /My lists/i })).toHaveAttribute(
			'href',
			'/trakt/mylists'
		);
	});
});
