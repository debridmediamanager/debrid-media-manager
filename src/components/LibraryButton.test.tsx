import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryButton from './LibraryButton';

describe('LibraryButton', () => {
	it('renders children text', () => {
		render(<LibraryButton variant="orange">Click me</LibraryButton>);
		expect(screen.getByText('Click me')).toBeInTheDocument();
	});

	it('renders as a button element', () => {
		render(<LibraryButton variant="green">Test</LibraryButton>);
		expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
	});

	it('applies variant-specific classes', () => {
		const { container } = render(<LibraryButton variant="red">Red</LibraryButton>);
		const button = container.querySelector('button')!;
		expect(button.className).toContain('border-red-500');
		expect(button.className).toContain('bg-red-900/30');
	});

	it('defaults to sm size', () => {
		const { container } = render(<LibraryButton variant="orange">Sm</LibraryButton>);
		const button = container.querySelector('button')!;
		expect(button.className).toContain('text-[0.6rem]');
	});

	it('applies xs size classes', () => {
		const { container } = render(
			<LibraryButton variant="orange" size="xs">
				Xs
			</LibraryButton>
		);
		const button = container.querySelector('button')!;
		expect(button.className).toContain('text-xs');
	});

	it('shows count when showCount is greater than 0', () => {
		render(
			<LibraryButton variant="green" showCount={5}>
				Items
			</LibraryButton>
		);
		expect(screen.getByText(/Items/)).toHaveTextContent('Items (5)');
	});

	it('does not show count when showCount is 0', () => {
		render(
			<LibraryButton variant="green" showCount={0}>
				Items
			</LibraryButton>
		);
		expect(screen.getByText('Items')).toBeInTheDocument();
		expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
	});

	it('does not show count when showCount is undefined', () => {
		render(<LibraryButton variant="green">Items</LibraryButton>);
		expect(screen.getByText('Items')).toBeInTheDocument();
	});

	it('disables button when disabled prop is true', () => {
		render(
			<LibraryButton variant="orange" disabled>
				Disabled
			</LibraryButton>
		);
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('applies disabled styling classes', () => {
		const { container } = render(
			<LibraryButton variant="orange" disabled>
				Disabled
			</LibraryButton>
		);
		const button = container.querySelector('button')!;
		expect(button.className).toContain('cursor-not-allowed');
		expect(button.className).toContain('opacity-60');
	});

	it('calls onClick handler when clicked', () => {
		const handleClick = vi.fn();
		render(
			<LibraryButton variant="teal" onClick={handleClick}>
				Clickable
			</LibraryButton>
		);
		fireEvent.click(screen.getByRole('button'));
		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('does not call onClick when disabled', () => {
		const handleClick = vi.fn();
		render(
			<LibraryButton variant="teal" onClick={handleClick} disabled>
				Disabled
			</LibraryButton>
		);
		fireEvent.click(screen.getByRole('button'));
		expect(handleClick).not.toHaveBeenCalled();
	});

	it('merges custom className', () => {
		const { container } = render(
			<LibraryButton variant="cyan" className="custom-class">
				Custom
			</LibraryButton>
		);
		const button = container.querySelector('button')!;
		expect(button.className).toContain('custom-class');
		expect(button.className).toContain('border-cyan-500');
	});

	it('passes through additional button attributes', () => {
		render(
			<LibraryButton variant="slate" data-testid="my-btn" title="tooltip">
				Extra
			</LibraryButton>
		);
		const button = screen.getByTestId('my-btn');
		expect(button).toHaveAttribute('title', 'tooltip');
	});
});
