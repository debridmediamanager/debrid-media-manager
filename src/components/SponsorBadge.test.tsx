import { SPONSOR_TOKEN_KEY } from '@/hooks/useSponsor';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SponsorBadge } from './SponsorBadge';

function storeToken(claims: object) {
	const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
	window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(`${body}.sig`));
}

const ACTIVE = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	sources: ['github'],
	keyVersion: 1,
	exp: Date.now() + 60_000,
};

describe('SponsorBadge', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it('renders nothing without a sponsorship', () => {
		const { container } = render(<SponsorBadge />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders nothing once the token has expired', () => {
		storeToken({ ...ACTIVE, exp: Date.now() - 1 });
		const { container } = render(<SponsorBadge />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders the badge for a sponsor', async () => {
		storeToken(ACTIVE);
		render(<SponsorBadge />);
		expect(await screen.findByText('Sponsor')).toBeInTheDocument();
	});

	it('shows the linked GitHub account when asked', async () => {
		storeToken(ACTIVE);
		render(<SponsorBadge showName />);
		expect(await screen.findByText('· someone')).toBeInTheDocument();
	});
});
