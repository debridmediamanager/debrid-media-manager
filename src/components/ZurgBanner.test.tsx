import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZURG_BANNER_DISMISS_KEY, ZURG_SITE_URL, ZurgBanner } from './ZurgBanner';

describe('ZurgBanner', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it('links to the zurg site in a new tab', () => {
		render(<ZurgBanner />);

		const cta = screen.getByRole('link', { name: 'Get zurg' });
		expect(cta.getAttribute('href')).toBe(ZURG_SITE_URL);
		expect(cta.getAttribute('target')).toBe('_blank');
		expect(cta.getAttribute('rel')).toContain('noopener');
		expect(screen.getByText(/read it like a normal drive/i)).toBeInTheDocument();
		expect(screen.getByText('No symlinks!')).toBeInTheDocument();
	});

	it('stays gone after it is dismissed', async () => {
		const user = userEvent.setup();
		const { unmount } = render(<ZurgBanner />);

		await user.click(screen.getByRole('button', { name: /dismiss/i }));
		expect(screen.queryByRole('link', { name: 'Get zurg' })).toBeNull();
		unmount();

		render(<ZurgBanner />);
		expect(screen.queryByRole('link', { name: 'Get zurg' })).toBeNull();
	});

	// A remount is not a page load. Module state survives one and dies on the
	// other, so the two tests below pin the dismissal to localStorage itself -
	// without them the banner can come back on every reload and the suite stays
	// green.
	it('writes the dismissal to localStorage', async () => {
		const user = userEvent.setup();
		render(<ZurgBanner />);

		await user.click(screen.getByRole('button', { name: /dismiss/i }));

		expect(window.localStorage.getItem(ZURG_BANNER_DISMISS_KEY)).toBe('1');
	});

	it('reads the dismissal back out of localStorage on a fresh load', () => {
		window.localStorage.setItem(ZURG_BANNER_DISMISS_KEY, '1');
		const getItem = vi.spyOn(Storage.prototype, 'getItem');

		render(<ZurgBanner />);

		expect(getItem).toHaveBeenCalledWith(ZURG_BANNER_DISMISS_KEY);
		expect(screen.queryByRole('link', { name: 'Get zurg' })).toBeNull();

		getItem.mockRestore();
	});

	it('renders the same markup on the server whether or not it was dismissed', () => {
		// The dismissal flag must not be read while rendering. If it were, the
		// prerendered page and the first client render would disagree and React
		// would throw the whole tree away as a hydration error.
		const fresh = renderToString(<ZurgBanner />);
		window.localStorage.setItem(ZURG_BANNER_DISMISS_KEY, '1');

		expect(renderToString(<ZurgBanner />)).toBe(fresh);
		expect(fresh).toContain(ZURG_SITE_URL);
	});
});
