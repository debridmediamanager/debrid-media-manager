import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoSection } from './InfoSection';

describe('InfoSection', () => {
	it('highlights extension download links with external targets', () => {
		render(<InfoSection />);

		const chromeLink = screen.getByRole('link', { name: 'Chrome' });
		expect(chromeLink.getAttribute('href')).toContain('chromewebstore');
		expect(chromeLink.getAttribute('target')).toBe('_blank');

		const firefoxLink = screen.getByRole('link', { name: 'Firefox' });
		expect(firefoxLink.getAttribute('href')).toContain('mozilla.org');
		expect(firefoxLink.getAttribute('target')).toBe('_blank');

		const safariLink = screen.getByRole('link', { name: 'Safari' });
		expect(safariLink.getAttribute('href')).toContain('apple.com');
		expect(safariLink.getAttribute('target')).toBe('_blank');

		const userscriptLink = screen.getByRole('link', { name: 'userscript' });
		expect(userscriptLink.getAttribute('href')).toContain('greasyfork');
		expect(userscriptLink.getAttribute('target')).toBe('_blank');
	});

	it('promotes community and sponsorship resources', () => {
		render(<InfoSection />);

		expect(screen.queryByRole('link', { name: /zurg/i })).toBeNull();
		expect(
			screen.getByRole('link', { name: /r\/debridmediamanager/i }).getAttribute('href')
		).toContain('reddit.com');
		expect(screen.getByRole('link', { name: 'Github' }).getAttribute('href')).toContain(
			'github.com/sponsors'
		);
		expect(screen.getByRole('link', { name: 'Patreon' }).getAttribute('href')).toContain(
			'patreon.com'
		);
		expect(screen.getByRole('link', { name: 'Paypal' }).getAttribute('href')).toContain(
			'paypal.me'
		);
		expect(screen.getByRole('link', { name: /Discord/i }).getAttribute('href')).toContain(
			'discord.gg'
		);
	});
});
