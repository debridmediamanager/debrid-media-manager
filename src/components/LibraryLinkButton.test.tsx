import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryLinkButton from './LibraryLinkButton';

vi.mock('next/link', () => ({
	default: ({ children, href, ...props }: any) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

describe('LibraryLinkButton', () => {
	it('renders children text', () => {
		render(
			<LibraryLinkButton href="/test" variant="orange">
				Link Text
			</LibraryLinkButton>
		);
		expect(screen.getByText('Link Text')).toBeInTheDocument();
	});

	it('renders as a link with correct href', () => {
		render(
			<LibraryLinkButton href="/library" variant="yellow">
				Go
			</LibraryLinkButton>
		);
		const link = screen.getByRole('link', { name: 'Go' });
		expect(link).toHaveAttribute('href', '/library');
	});

	it('applies variant-specific classes', () => {
		render(
			<LibraryLinkButton href="/test" variant="amber">
				Amber
			</LibraryLinkButton>
		);
		const link = screen.getByRole('link');
		expect(link.className).toContain('border-amber-500');
		expect(link.className).toContain('bg-amber-900/30');
	});

	it('defaults to xs size', () => {
		render(
			<LibraryLinkButton href="/test" variant="orange">
				Default
			</LibraryLinkButton>
		);
		const link = screen.getByRole('link');
		expect(link.className).toContain('text-xs');
		expect(link.className).toContain('py-0.5');
	});

	it('applies sm size classes', () => {
		render(
			<LibraryLinkButton href="/test" variant="orange" size="sm">
				Small
			</LibraryLinkButton>
		);
		const link = screen.getByRole('link');
		expect(link.className).toContain('py-0');
	});

	it('calls onClick handler when clicked', () => {
		const handleClick = vi.fn();
		render(
			<LibraryLinkButton href="/test" variant="slate" onClick={handleClick}>
				Clickable
			</LibraryLinkButton>
		);
		fireEvent.click(screen.getByRole('link'));
		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('renders all variant styles correctly', () => {
		const variants = ['orange', 'yellow', 'amber', 'slate'] as const;
		for (const variant of variants) {
			const { unmount } = render(
				<LibraryLinkButton href="/test" variant={variant}>
					{variant}
				</LibraryLinkButton>
			);
			const link = screen.getByRole('link');
			expect(link.className).toContain(`border-${variant}-500`);
			unmount();
		}
	});
});
