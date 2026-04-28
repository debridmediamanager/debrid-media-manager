import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryHelpText from './LibraryHelpText';

describe('LibraryHelpText', () => {
	it('renders help text', () => {
		render(<LibraryHelpText helpText="Press Enter to search" onHide={vi.fn()} />);
		expect(screen.getByText('Press Enter to search')).toBeInTheDocument();
	});

	it('returns null when helpText is empty string', () => {
		const { container } = render(<LibraryHelpText helpText="" onHide={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});

	it('returns null when helpText is "hide"', () => {
		const { container } = render(<LibraryHelpText helpText="hide" onHide={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});

	it('calls onHide when clicked', () => {
		const handleHide = vi.fn();
		render(<LibraryHelpText helpText="Some help" onHide={handleHide} />);
		fireEvent.click(screen.getByText('Some help'));
		expect(handleHide).toHaveBeenCalledOnce();
	});

	it('renders with the lightbulb icon', () => {
		const { container } = render(<LibraryHelpText helpText="Tip text" onHide={vi.fn()} />);
		const svg = container.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('applies the correct background class', () => {
		const { container } = render(<LibraryHelpText helpText="Styled text" onHide={vi.fn()} />);
		const div = container.firstChild as HTMLElement;
		expect(div.className).toContain('bg-blue-900');
	});
});
