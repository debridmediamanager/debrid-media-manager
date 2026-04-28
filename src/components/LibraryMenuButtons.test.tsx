import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryMenuButtons from './LibraryMenuButtons';

vi.mock('next/link', () => ({
	default: ({ children, href, ...props }: any) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const defaultProps = {
	currentPage: 1,
	maxPages: 5,
	onPrevPage: vi.fn(),
	onNextPage: vi.fn(),
	onResetFilters: vi.fn(),
	sameHashSize: 0,
	sameTitleSize: 0,
	selectedTorrentsSize: 0,
	uncachedCount: 0,
	inProgressCount: 0,
	slowCount: 0,
	failedCount: 0,
};

function findLinkByText(text: string) {
	const links = screen.getAllByRole('link');
	return links.find((l) => l.textContent?.includes(text)) ?? null;
}

describe('LibraryMenuButtons', () => {
	it('renders page numbers', () => {
		render(<LibraryMenuButtons {...defaultProps} />);
		expect(screen.getByText('1/5')).toBeInTheDocument();
	});

	it('renders Movies, TV shows, and Others links', () => {
		render(<LibraryMenuButtons {...defaultProps} />);
		expect(screen.getByText('Movies')).toBeInTheDocument();
		expect(findLinkByText('TV')).not.toBeNull();
		expect(screen.getByText('Others')).toBeInTheDocument();
	});

	it('renders Reset button', () => {
		render(<LibraryMenuButtons {...defaultProps} />);
		expect(screen.getByText('Reset')).toBeInTheDocument();
	});

	it('disables prev button on first page', () => {
		render(<LibraryMenuButtons {...defaultProps} currentPage={1} />);
		const buttons = screen.getAllByRole('button');
		expect(buttons[0]).toBeDisabled();
	});

	it('disables next button on last page', () => {
		render(<LibraryMenuButtons {...defaultProps} currentPage={5} maxPages={5} />);
		const buttons = screen.getAllByRole('button');
		expect(buttons[1]).toBeDisabled();
	});

	it('enables both navigation buttons on middle pages', () => {
		render(<LibraryMenuButtons {...defaultProps} currentPage={3} />);
		const buttons = screen.getAllByRole('button');
		expect(buttons[0]).not.toBeDisabled();
		expect(buttons[1]).not.toBeDisabled();
	});

	it('calls onPrevPage when prev button is clicked', () => {
		const onPrevPage = vi.fn();
		render(<LibraryMenuButtons {...defaultProps} currentPage={3} onPrevPage={onPrevPage} />);
		const buttons = screen.getAllByRole('button');
		fireEvent.click(buttons[0]);
		expect(onPrevPage).toHaveBeenCalledOnce();
	});

	it('calls onNextPage when next button is clicked', () => {
		const onNextPage = vi.fn();
		render(<LibraryMenuButtons {...defaultProps} currentPage={3} onNextPage={onNextPage} />);
		const buttons = screen.getAllByRole('button');
		fireEvent.click(buttons[1]);
		expect(onNextPage).toHaveBeenCalledOnce();
	});

	it('calls onResetFilters when Reset is clicked', () => {
		const onResetFilters = vi.fn();
		render(<LibraryMenuButtons {...defaultProps} onResetFilters={onResetFilters} />);
		fireEvent.click(screen.getByText('Reset'));
		expect(onResetFilters).toHaveBeenCalledOnce();
	});

	it('shows Same hash link when sameHashSize > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} sameHashSize={3} />);
		expect(findLinkByText('hash')).not.toBeNull();
	});

	it('hides Same hash link when sameHashSize is 0', () => {
		render(<LibraryMenuButtons {...defaultProps} sameHashSize={0} />);
		expect(findLinkByText('hash')).toBeNull();
	});

	it('shows Same title link when sameTitleSize > sameHashSize', () => {
		render(<LibraryMenuButtons {...defaultProps} sameHashSize={2} sameTitleSize={5} />);
		expect(findLinkByText('title')).not.toBeNull();
	});

	it('hides Same title link when sameTitleSize equals sameHashSize', () => {
		render(<LibraryMenuButtons {...defaultProps} sameHashSize={3} sameTitleSize={3} />);
		expect(findLinkByText('title')).toBeNull();
	});

	it('shows Selected link with count when selectedTorrentsSize > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} selectedTorrentsSize={7} />);
		expect(screen.getByText('Selected (7)')).toBeInTheDocument();
	});

	it('hides Selected link when selectedTorrentsSize is 0', () => {
		render(<LibraryMenuButtons {...defaultProps} selectedTorrentsSize={0} />);
		expect(findLinkByText('Selected')).toBeNull();
	});

	it('shows Uncached link when uncachedCount > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} uncachedCount={2} />);
		expect(screen.getByText('Uncached')).toBeInTheDocument();
	});

	it('shows In progress link when inProgressCount > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} inProgressCount={1} />);
		expect(findLinkByText('progress')).not.toBeNull();
	});

	it('shows No seeds link when slowCount > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} slowCount={4} />);
		expect(findLinkByText('seeds')).not.toBeNull();
	});

	it('shows Failed link when failedCount > 0', () => {
		render(<LibraryMenuButtons {...defaultProps} failedCount={2} />);
		expect(screen.getByText('Failed')).toBeInTheDocument();
	});

	it('hides all conditional links when counts are 0', () => {
		render(<LibraryMenuButtons {...defaultProps} />);
		expect(findLinkByText('hash')).toBeNull();
		expect(findLinkByText('title')).toBeNull();
		expect(findLinkByText('Selected')).toBeNull();
		expect(findLinkByText('Uncached')).toBeNull();
		expect(findLinkByText('progress')).toBeNull();
		expect(findLinkByText('seeds')).toBeNull();
		expect(findLinkByText('Failed')).toBeNull();
	});

	it('renders correct hrefs for media type links', () => {
		render(<LibraryMenuButtons {...defaultProps} />);
		const links = screen.getAllByRole('link');
		const hrefs = links.map((l) => l.getAttribute('href'));
		expect(hrefs).toContain('/library?mediaType=movie&page=1');
		expect(hrefs).toContain('/library?mediaType=tv&page=1');
		expect(hrefs).toContain('/library?mediaType=other&page=1');
	});
});
