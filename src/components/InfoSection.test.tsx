import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommunityLinks, InfoSection } from './InfoSection';

describe('InfoSection', () => {
	it('keeps every extension download link, with external targets', () => {
		render(<CommunityLinks />);

		const chromeLink = screen.getByRole('link', { name: 'Chrome' });
		expect(chromeLink.getAttribute('href')).toContain('chromewebstore');
		expect(chromeLink.getAttribute('target')).toBe('_blank');

		const firefoxLink = screen.getByRole('link', { name: 'Firefox' });
		expect(firefoxLink.getAttribute('href')).toContain('mozilla.org');
		expect(firefoxLink.getAttribute('target')).toBe('_blank');

		const safariLink = screen.getByRole('link', { name: /Safari/ });
		expect(safariLink.getAttribute('href')).toContain('apple.com');
		expect(safariLink.getAttribute('target')).toBe('_blank');

		const userscriptLink = screen.getByRole('link', { name: 'userscript' });
		expect(userscriptLink.getAttribute('href')).toContain('greasyfork');
		expect(userscriptLink.getAttribute('target')).toBe('_blank');

		expect(chromeLink.closest('details')).not.toBeNull();
	});

	// The sponsorship block named three payment links and no way to use a
	// sponsorship already paid for. gatekeeper is where the key comes from.
	it('says where a sponsor gets the key that opens the features', () => {
		render(<InfoSection />);

		expect(screen.getByRole('link', { name: 'gatekeeper' })).toHaveAttribute(
			'href',
			'https://gatekeeper.debridmediamanager.com'
		);
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
	});

	it('promotes community and sponsorship resources', () => {
		render(
			<>
				<InfoSection />
				<CommunityLinks />
			</>
		);

		expect(screen.queryByRole('link', { name: /zurg/i })).toBeNull();
		expect(
			screen.getByRole('link', { name: /r\/debridmediamanager/i }).getAttribute('href')
		).toContain('reddit.com');
		expect(screen.getByRole('link', { name: 'gatekeeper' }).getAttribute('href')).toBe(
			'https://gatekeeper.debridmediamanager.com'
		);
		for (const link of screen.getAllByRole('link')) {
			expect(link.getAttribute('href')).not.toMatch(
				/patreon\.com|paypal\.me|github\.com\/sponsors/
			);
		}
		expect(screen.getByRole('link', { name: /Discord/i }).getAttribute('href')).toContain(
			'discord.gg'
		);
	});

	it('keeps only the sponsor line in the info card', () => {
		render(<InfoSection />);

		expect(screen.queryByRole('link', { name: /Discord/i })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Chrome' })).toBeNull();
		expect(screen.queryByText(/Lastly/)).toBeNull();
	});
});
