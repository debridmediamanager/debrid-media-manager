import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteLinks } from './SiteLinks';

describe('SiteLinks', () => {
	it('links to every other site in a new tab', () => {
		render(<SiteLinks />);

		const nav = screen.getByRole('navigation', { name: 'Other DMM sites' });
		const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual([
			'https://zurg.debridmediamanager.com/',
			'https://rex.debridmediamanager.com/',
			'https://notes.debridmediamanager.com/',
			'https://gatekeeper.debridmediamanager.com/',
		]);
		for (const link of nav.querySelectorAll('a')) {
			expect(link).toHaveAttribute('target', '_blank');
			expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		}
	});
});
