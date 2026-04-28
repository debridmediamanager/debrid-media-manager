import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryTableHeader from './LibraryTableHeader';

function renderInTable(ui: React.ReactElement) {
	return render(
		<table>
			<thead>{ui}</thead>
		</table>
	);
}

const defaultProps = {
	sortBy: { column: 'added' as const, direction: 'desc' as const },
	onSort: vi.fn(),
	filteredListLength: 25,
	selectedTorrentsSize: 0,
};

describe('LibraryTableHeader', () => {
	it('renders all column headers', () => {
		renderInTable(<LibraryTableHeader {...defaultProps} />);
		expect(screen.getByText(/Select/)).toBeInTheDocument();
		expect(screen.getByText(/Title/)).toBeInTheDocument();
		expect(screen.getByText(/Size/)).toBeInTheDocument();
		expect(screen.getByText(/Status/)).toBeInTheDocument();
		expect(screen.getByText(/Added/)).toBeInTheDocument();
		expect(screen.getByText('Actions')).toBeInTheDocument();
	});

	it('displays filtered list length in Title column', () => {
		renderInTable(<LibraryTableHeader {...defaultProps} filteredListLength={42} />);
		expect(screen.getByText(/Title \(42\)/)).toBeInTheDocument();
	});

	it('displays selected torrents count in Select column', () => {
		renderInTable(<LibraryTableHeader {...defaultProps} selectedTorrentsSize={3} />);
		expect(screen.getByText(/Select \(3\)/)).toBeInTheDocument();
	});

	it('does not display count when selectedTorrentsSize is 0', () => {
		renderInTable(<LibraryTableHeader {...defaultProps} selectedTorrentsSize={0} />);
		expect(screen.getByText(/Select/)).not.toHaveTextContent('(0)');
	});

	it('shows ascending arrow for current sort column', () => {
		renderInTable(
			<LibraryTableHeader {...defaultProps} sortBy={{ column: 'title', direction: 'asc' }} />
		);
		expect(screen.getByText(/Title.*↑/)).toBeInTheDocument();
	});

	it('shows descending arrow for current sort column', () => {
		renderInTable(
			<LibraryTableHeader {...defaultProps} sortBy={{ column: 'bytes', direction: 'desc' }} />
		);
		expect(screen.getByText(/Size.*↓/)).toBeInTheDocument();
	});

	it('does not show arrow for non-sorted columns', () => {
		renderInTable(
			<LibraryTableHeader {...defaultProps} sortBy={{ column: 'added', direction: 'asc' }} />
		);
		const sizeHeader = screen.getByText('Size');
		expect(sizeHeader.textContent).not.toMatch(/[↑↓]/);
	});

	it('calls onSort with "id" when Select header is clicked', () => {
		const onSort = vi.fn();
		renderInTable(<LibraryTableHeader {...defaultProps} onSort={onSort} />);
		fireEvent.click(screen.getByText(/Select/));
		expect(onSort).toHaveBeenCalledWith('id');
	});

	it('calls onSort with "title" when Title header is clicked', () => {
		const onSort = vi.fn();
		renderInTable(<LibraryTableHeader {...defaultProps} onSort={onSort} />);
		fireEvent.click(screen.getByText(/Title/));
		expect(onSort).toHaveBeenCalledWith('title');
	});

	it('calls onSort with "bytes" when Size header is clicked', () => {
		const onSort = vi.fn();
		renderInTable(<LibraryTableHeader {...defaultProps} onSort={onSort} />);
		fireEvent.click(screen.getByText('Size'));
		expect(onSort).toHaveBeenCalledWith('bytes');
	});

	it('calls onSort with "progress" when Status header is clicked', () => {
		const onSort = vi.fn();
		renderInTable(<LibraryTableHeader {...defaultProps} onSort={onSort} />);
		fireEvent.click(screen.getByText('Status'));
		expect(onSort).toHaveBeenCalledWith('progress');
	});

	it('calls onSort with "added" when Added header is clicked', () => {
		const onSort = vi.fn();
		renderInTable(<LibraryTableHeader {...defaultProps} onSort={onSort} />);
		fireEvent.click(screen.getByText(/Added/));
		expect(onSort).toHaveBeenCalledWith('added');
	});

	it('shows sort indicator on Added column when sorted by added desc', () => {
		renderInTable(
			<LibraryTableHeader {...defaultProps} sortBy={{ column: 'added', direction: 'desc' }} />
		);
		expect(screen.getByText(/Added.*↓/)).toBeInTheDocument();
	});
});
