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
			screen.getByText(
				'DMM Cast does not require sponsorship; sponsoring raises the per-profile limit from five to ten other streams.'
			)
		).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
		expect(document.activeElement).toHaveTextContent('DMM Cast → Stremio');
	});

	it.each([
		[
			/^Kodi/,
			'The Kodi addon does not require sponsorship; sponsoring raises the per-profile limit from five to ten other streams.',
		],
		[
			/^Stremio/,
			'DMM Cast does not require sponsorship; sponsoring raises the per-profile limit from five to ten other streams.',
		],
		[
			/^I am not sure yet/,
			'DMM Cast and the Kodi addon do not require sponsorship; sponsoring raises the per-profile limit from five to ten other streams.',
		],
	])('words the free Cast footnote for the chosen player (%s)', (player, footnote) => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: player }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(footnote)
		).toBeInTheDocument();
	});

	it('names the upgrades below when the free tools have some', () => {
		reachStremioRecommendation();

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(
				'Sponsorship is optional for the free tools in this setup. Sponsor DMM for the upgrades below.'
			)
		).toBeInTheDocument();
	});

	it('names no upgrades when only the sponsor page and Discord role are listed', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /An external player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /AllDebrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(
				'Sponsorship is optional for the free tools in this setup.'
			)
		).toBeInTheDocument();
	});

	it('writes each source line as sentences', () => {
		reachStremioRecommendation();

		expect(
			screen.getByText('Real-Debrid: DMM Cast → Stremio. A Real-Debrid account.')
		).toBeInTheDocument();
	});

	it('keeps a constraint ahead of sponsorship marketing and explains the limit', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /My own Usenet/ }));
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
				'Resolve the setup requirements above first. Sponsorship does not remove them.'
			)
		).toBeInTheDocument();
	});

	it('asks for a supported source when the player cannot use the selected ones', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /HTTP links or files/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			screen.queryByRole('heading', { name: 'A constraint to resolve' })
		).not.toBeInTheDocument();
		expect(
			screen.getByText(
				'Choose a source your player supports first; DMM has no route for the selected sources with this player.'
			)
		).toBeInTheDocument();
	});

	it('asks for a source first in the sponsor box when none is selected', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /None yet/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText('Choose a source first.')
		).toBeInTheDocument();
	});

	it('says only that sponsorship is optional when the route uses no DMM tool and no account', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Existing Stremio URL addons/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(
				'Sponsorship is optional here.'
			)
		).toBeInTheDocument();
	});

	it("says sponsorship is for your accounts or other routes for a provider's own WebDAV", () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(
				'Sponsorship is optional here; the benefits below are for your accounts or other routes.'
			)
		).toBeInTheDocument();
	});

	it("says only that sponsorship is optional for AllDebrid's own WebDAV, which no benefit is for", () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /AllDebrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(
				'Sponsorship is optional here.'
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
			screen.getByText(
				'Unavailable: Plex Media Server needs a full server host; zurg Android cannot give a server on that device a library.'
			)
		).toBeInTheDocument();
	});

	function editAnswer(question: string) {
		const row = screen.getByText(question).parentElement?.parentElement;
		expect(row).not.toBeNull();
		fireEvent.click(
			within(row as HTMLElement).getByRole('button', { name: `Edit ${question}` })
		);
	}

	function expectAndroidDropped() {
		const android = screen.getByRole('button', { name: /Android \/ Google TV/ });
		expect(android).toBeDisabled();
		expect(android).toHaveAttribute('aria-pressed', 'false');
		expect(
			screen.getByText(
				'Unavailable: zurg Android has no TorBox hosted NZB backend; that route needs a normal host.'
			)
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
	}

	it('drops an Android host when added TorBox hosted NZBs would need zurg on it', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Android \/ Google TV/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidDropped();
	});

	it('drops an Android host when a new player would play TorBox hosted NZBs through zurg', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Android \/ Google TV/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('Where do you want to watch?');
		fireEvent.click(screen.getByRole('button', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidDropped();
	});

	it('says only the Sonarr/Radarr choice changes the route', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByText(
				'Only the Sonarr/Radarr choice changes the route; a managed library can add Wanted notes and benefits.'
			)
		).toBeInTheDocument();
	});

	it('moves focus to the next question for keyboard users', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(document.activeElement).toHaveTextContent('What do you already have?');
	});

	it.each([
		[
			/My own Usenet/,
			'rex does not require sponsorship; any sponsor benefits below apply to the zurg, API or help parts of the setup.',
		],
		[
			/Existing Stremio URL addons/,
			'rex and rex-stremio do not require sponsorship; any sponsor benefits below apply to the zurg, API or help parts of the setup.',
		],
	])('names rex-stremio as free only where it is offered (%s)', (source, footnote) => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('button', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Use rex for Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: source }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(footnote)
		).toBeInTheDocument();
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
			screen.getByRole('heading', { name: 'Choose a source for Stremio' })
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
