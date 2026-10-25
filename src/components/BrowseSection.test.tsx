import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseSection } from './BrowseSection';

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

describe('BrowseSection', () => {
	const push = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		(useRouter as any).mockReturnValue({
			push,
		});
	});

	it('renders quick browse links and random term href is sanitized', () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
		render(<BrowseSection terms={['Action!', 'Drama']} />);

		expect(screen.getByRole('link', { name: /genres/i })).toBeInTheDocument();
		const randomLink = screen.getByRole('link', { name: 'Action!' });
		expect(randomLink.getAttribute('href')).toBe('/browse/Action');

		randomSpy.mockRestore();
	});

	it('links to the anime page from the home page', () => {
		render(<BrowseSection terms={['Action!', 'Drama']} />);

		const animeLink = screen.getByRole('link', { name: /anime/i });
		expect(animeLink.getAttribute('href')).toBe('/anime');
	});

	it('drops the anime link when the user hides anime', () => {
		localStorage.setItem('settings:hideAnime', 'true');
		try {
			render(<BrowseSection terms={['action']} />);
			expect(screen.queryByRole('link', { name: /anime/i })).toBeNull();
		} finally {
			localStorage.removeItem('settings:hideAnime');
		}
	});

	it('routes to cleaned term when a custom search is entered', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const promptMock = vi.spyOn(window, 'prompt').mockReturnValue('  One-Word  ');
		render(<BrowseSection terms={['Action!', 'Drama']} />);

		await userEvent.click(screen.getByRole('button', { name: /browse/i }));

		expect(promptMock).toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith('/browse/OneWord');

		randomSpy.mockRestore();
		promptMock.mockRestore();
	});

	it('does not route when prompt is cancelled or cleaned term is empty', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
		const promptMock = vi
			.spyOn(window, 'prompt')
			.mockReturnValueOnce(null)
			.mockReturnValueOnce('   !!!   ');
		render(<BrowseSection terms={['Action!', 'Drama']} />);

		const browseButton = screen.getByRole('button', { name: /browse/i });
		await userEvent.click(browseButton);
		await userEvent.click(browseButton);

		expect(push).not.toHaveBeenCalled();

		randomSpy.mockRestore();
		promptMock.mockRestore();
	});

	// justify-center on an overflow-x-auto row pushed the first chip past the
	// left edge, where scrolling cannot reach; long or emoji terms also wrapped
	// inside their chip. The row wraps instead and each chip stays on one line.
	it('wraps the chip row instead of centring an overflowing scroller', () => {
		render(<BrowseSection terms={['🎃 halloween']} />);
		const genres = screen.getByRole('link', { name: /genres/i });
		const row = genres.parentElement!;
		expect(row).toHaveClass('flex-wrap');
		expect(row).not.toHaveClass('overflow-x-auto');
		for (const chip of Array.from(row.children)) {
			expect(chip).toHaveClass('whitespace-nowrap');
		}
	});
});
