import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import ChooseYourSetupPage from '@/pages/choose-your-setup';

beforeEach(() => {
	window.scrollTo = vi.fn();
});

function reachStremioRecommendation() {
	render(<ChooseYourSetupPage />);
	fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));
}

describe('choose your setup page', () => {
	it('uses explicit next steps and shows a useful recommendation', () => {
		reachStremioRecommendation();

		expect(screen.getByRole('heading', { name: 'DMM Cast → Stremio' })).toBeInTheDocument();
		expect(
			screen.getAllByRole('link', { name: 'Read the full setup guide' })[0]
		).toHaveAttribute('href', 'https://notes.debridmediamanager.com/guides/choose-your-setup/');
		expect(screen.getByTestId('sponsorship-section')).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Connect your key in DMM settings' })
		).toHaveAttribute('href', '/settings');
		expect(screen.getByRole('link', { name: 'Sponsor DMM' })).toHaveAttribute(
			'href',
			'https://gatekeeper.debridmediamanager.com'
		);
		expect(
			screen.getByText(/DMM Cast itself does not require sponsorship/)
		).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
		expect(document.activeElement).toHaveTextContent('DMM Cast → Stremio');
	});

	it('keeps unsupported routes ahead of sponsorship marketing and explains the limit', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /HTTP links or files/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		const warning = screen.getByRole('heading', { name: 'A constraint to resolve' });
		const sponsorship = screen.getByTestId('sponsorship-section');
		expect(
			warning.compareDocumentPosition(sponsorship) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			screen.getByText(
				'Choose a supported source and resolve the setup requirements above first. Sponsorship does not remove them.'
			)
		).toBeInTheDocument();
	});

	it('moves focus to the next question for keyboard users', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(document.activeElement).toHaveTextContent('What do you already have?');
	});

	it('requires the conditional Plex choice before continuing', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How should Plex get the library?' })
		).toBeInTheDocument();
		const next = screen.getByRole('button', { name: 'Next' });
		expect(next).toBeDisabled();
		fireEvent.click(screen.getByRole('button', { name: /Keep my existing Plex Media Server/ }));
		expect(next).not.toBeDisabled();
	});

	it('recomputes after editing an answer instead of keeping the old route', () => {
		reachStremioRecommendation();

		const answerLabel = screen.getByText('What do you already have?');
		const answerRow = answerLabel.parentElement?.parentElement;
		expect(answerRow).not.toBeNull();
		fireEvent.click(
			within(answerRow as HTMLElement).getByRole('button', {
				name: 'Edit What do you already have?',
			})
		);
		fireEvent.click(screen.getByRole('button', { name: /None yet/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			screen.queryByRole('heading', { name: 'DMM Cast → Stremio' })
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Choose the player, then a source' })
		).toBeInTheDocument();
	});

	it('resets answers and returns to the first keyboard-reachable question', () => {
		reachStremioRecommendation();
		fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

		expect(
			screen.getByRole('heading', { name: 'Where do you want to watch?' })
		).toBeInTheDocument();
		expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
		expect(screen.getByRole('button', { name: /Stremio/ })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});
});
