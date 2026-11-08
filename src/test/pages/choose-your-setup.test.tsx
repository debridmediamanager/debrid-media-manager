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
	fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
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

	it('disables arr until a full host is selected, with a visible reason', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('button', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).toBeDisabled();
		expect(
			screen.getByText(/Unavailable: The arr workflow needs an existing or willing full host/)
		).toBeInTheDocument();
	});

	it('disables arr until a supported acquisition backend is selected', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Easynews/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('button', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).toBeDisabled();
		expect(
			screen.getByText(
				/Unavailable: The arr workflow needs a supported debrid or NZB backend/
			)
		).toBeInTheDocument();
	});

	it('keeps arr enabled for a mixed source set with a supported backend', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /Easynews/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('button', { name: /Automation with Sonarr\/Radarr/ })
		).not.toBeDisabled();
	});

	it('clears a stale arr choice when editing a valid route to no host', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Automation with Sonarr\/Radarr/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		const hostRow = screen.getByText('Can a machine stay on while you watch?').parentElement
			?.parentElement;
		expect(hostRow).not.toBeNull();
		fireEvent.click(
			within(hostRow as HTMLElement).getByRole('button', {
				name: 'Edit Can a machine stay on while you watch?',
			})
		);
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('button', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).toBeDisabled();
		expect(screen.getByRole('button', { name: /I am not sure yet/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('clears a stale arr choice when editing sources to an unsupported set', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Automation with Sonarr\/Radarr/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		const sourceRow = screen.getByText('What do you already have?').parentElement
			?.parentElement;
		expect(sourceRow).not.toBeNull();
		fireEvent.click(
			within(sourceRow as HTMLElement).getByRole('button', {
				name: 'Edit What do you already have?',
			})
		);
		fireEvent.click(screen.getByRole('button', { name: /None yet/ }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('button', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).toBeDisabled();
		expect(screen.getByRole('button', { name: /I am not sure yet/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('keeps arr enabled and executable when a full host is selected', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('button', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).not.toBeDisabled();
		fireEvent.click(arr);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));
		expect(
			screen.getByRole('heading', { name: 'DMM indexers → Sonarr/Radarr → zurg' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('heading', { name: 'Resolve the setup requirements first' })
		).not.toBeInTheDocument();
	});

	it('marks Android as insufficient for a full Plex stack', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Keep my existing Plex Media Server/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const android = screen.getByRole('button', { name: /Android \/ Google TV/ });
		expect(android).toBeDisabled();
		expect(
			screen.getByText(/Unavailable: Plex apps server needs a full server host/)
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
