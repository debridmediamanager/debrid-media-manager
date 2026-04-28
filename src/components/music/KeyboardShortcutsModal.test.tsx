import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';

describe('KeyboardShortcutsModal', () => {
	const mockOnClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the modal with title', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
	});

	it('renders all shortcut entries', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		expect(screen.getByText('Play / Pause')).toBeInTheDocument();
		expect(screen.getByText('Previous track')).toBeInTheDocument();
		expect(screen.getByText('Next track')).toBeInTheDocument();
		expect(screen.getByText('Volume up')).toBeInTheDocument();
		expect(screen.getByText('Volume down')).toBeInTheDocument();
		expect(screen.getByText('Mute / Unmute')).toBeInTheDocument();
		expect(screen.getByText('Toggle shuffle')).toBeInTheDocument();
		expect(screen.getByText('Toggle repeat')).toBeInTheDocument();
		expect(screen.getByText('Toggle queue')).toBeInTheDocument();
	});

	it('renders keyboard keys for each shortcut', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		expect(screen.getByText('Space')).toBeInTheDocument();
		expect(screen.getByText('M')).toBeInTheDocument();
		expect(screen.getByText('S')).toBeInTheDocument();
		expect(screen.getByText('R')).toBeInTheDocument();
		expect(screen.getByText('Q')).toBeInTheDocument();
		expect(screen.getByText('?')).toBeInTheDocument();
		expect(screen.getByText('F1')).toBeInTheDocument();
	});

	it('renders arrow key symbols', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		expect(screen.getByText('←')).toBeInTheDocument();
		expect(screen.getByText('→')).toBeInTheDocument();
		expect(screen.getByText('↑')).toBeInTheDocument();
		expect(screen.getByText('↓')).toBeInTheDocument();
	});

	it('has two entries for Show shortcuts (? and F1)', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		const showShortcutsEntries = screen.getAllByText('Show shortcuts');
		expect(showShortcutsEntries).toHaveLength(2);
	});

	it('calls onClose when the close button is clicked', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		const buttons = screen.getAllByRole('button');
		fireEvent.click(buttons[0]);
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose when the backdrop is clicked', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		const backdrop = screen.getByText('Keyboard Shortcuts').closest('.fixed');
		fireEvent.click(backdrop!);
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('does not call onClose when the modal content is clicked', () => {
		render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		fireEvent.click(screen.getByText('Keyboard Shortcuts'));
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('renders kbd elements for shortcut keys', () => {
		const { container } = render(<KeyboardShortcutsModal onClose={mockOnClose} />);
		const kbdElements = container.querySelectorAll('kbd');
		expect(kbdElements.length).toBe(11);
	});
});
