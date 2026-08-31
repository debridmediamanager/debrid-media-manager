import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZURG_SITE_URL, ZurgBanner } from './ZurgBanner';

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

	it('renders the same markup on the server whether or not it was dismissed', () => {
		// The dismissal flag must not be read while rendering. If it were, the
		// prerendered page and the first client render would disagree and React
		// would throw the whole tree away as a hydration error.
		const fresh = renderToString(<ZurgBanner />);
		window.localStorage.setItem('zurg_banner_dismissed', '1');

		expect(renderToString(<ZurgBanner />)).toBe(fresh);
		expect(fresh).toContain(ZURG_SITE_URL);
	});
});
