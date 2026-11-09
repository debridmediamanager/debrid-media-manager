import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function reachStremioRecommendation(
	workflow: RegExp = /Choose and play as I go/,
	host: RegExp = /An existing server or host/
) {
	render(<ChooseYourSetupPage />);
	fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('radio', { name: host }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('radio', { name: workflow }));
	fireEvent.click(screen.getByRole('button', { name: 'Next' }));
	fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));
}

// An unavailable card stays in the Tab order so its reason is read out, and ignores activation.
function expectUnavailable(card: HTMLElement) {
	expect(card).toHaveAttribute('aria-disabled', 'true');
	expect(card).not.toBeDisabled();
	fireEvent.click(card);
	expect(card).toHaveAttribute('aria-checked', 'false');
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
				'DMM Cast does not require sponsorship; sponsoring lets you raise the per-profile limit from five to ten other streams.'
			)
		).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
		expect(document.activeElement).toHaveTextContent('DMM Cast → Stremio');
	});

	it.each([
		[
			/^Kodi/,
			'The Kodi addon does not require sponsorship; sponsoring lets you raise the per-profile limit from five to ten other streams.',
		],
		[
			/^Stremio/,
			'DMM Cast does not require sponsorship; sponsoring lets you raise the per-profile limit from five to ten other streams.',
		],
		[
			/^I am not sure yet/,
			'DMM Cast and the Kodi addon do not require sponsorship; sponsoring lets you raise the per-profile limit from five to ten other streams.',
		],
	])('words the free Cast footnote for the chosen player (%s)', (player, footnote) => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: player }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /An external player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /AllDebrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /My own Usenet/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /HTTP links or files/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /None yet/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText('Choose a source first.')
		).toBeInTheDocument();
	});

	it('says only that sponsorship is optional when the route uses no DMM tool and no account', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Existing Stremio URL addons/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /AllDebrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
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
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('radio', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expectUnavailable(arr);
		expect(
			screen.getByText(/Unavailable: The arr workflow needs an existing or willing full host/)
		).toBeInTheDocument();
	});

	it('disables arr until a supported acquisition backend is selected', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Easynews/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('radio', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expectUnavailable(arr);
		expect(
			screen.getByText(
				/Unavailable: The arr workflow needs a supported debrid or NZB backend/
			)
		).toBeInTheDocument();
	});

	it('keeps arr enabled for a mixed source set with a supported backend', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /Easynews/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('radio', { name: /Automation with Sonarr\/Radarr/ })
		).toHaveAttribute('aria-disabled', 'false');
	});

	const ARR = /Automation with Sonarr\/Radarr/;

	function expectArrKept() {
		expect(
			screen.getByRole('heading', { name: 'How do you want to choose titles?' })
		).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: ARR })).toHaveAttribute('aria-checked', 'true');
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	}

	function expectArrReset() {
		expectUnavailable(screen.getByRole('radio', { name: ARR }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		expect(screen.getByRole('radio', { name: /I am not sure yet/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
	}

	it('keeps arr when swapping one debrid source for another passes through no source', () => {
		reachStremioRecommendation(ARR);
		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /AllDebrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectArrKept();
	});

	it('keeps arr when No host is clicked by mistake before the existing host again', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectArrKept();
	});

	it('keeps arr when going back past the sources step before fixing the host', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectArrKept();
	});

	it('resets arr on leaving the host step once no host can run it', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How do you want to choose titles?' })
		).toBeInTheDocument();
		expectArrReset();
	});

	it('resets arr on leaving the sources step once no source can back it', () => {
		reachStremioRecommendation(ARR);
		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /None yet/ }));
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectUnavailable(screen.getByRole('radio', { name: ARR }));
		expect(screen.getByRole('radio', { name: /I am not sure yet/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	it('keeps the sources-step arr reset notice on the workflow step', () => {
		reachStremioRecommendation(ARR);
		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /Existing Stremio URL addons/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How do you want to choose titles?' })
		).toBeInTheDocument();
		expectArrReset();
	});

	// The notice's reason is stale once the sources allow arr again, though the choice stays reset.
	it('drops the arr reset notice once the sources allow arr again', () => {
		reachStremioRecommendation(ARR);
		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /Existing Stremio URL addons/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How do you want to choose titles?' })
		).toBeInTheDocument();
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.getByRole('radio', { name: ARR })).toHaveAttribute('aria-disabled', 'false');
	});

	// A notice set on the host step still holds while the host is unchanged, whatever the sources say.
	it('keeps a host-step arr reset notice when only the sources step is passed again', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
	});

	// A showing notice gives the reason that rules arr out now, the one the disabled arr card shows.
	it('updates a showing arr reset notice to the reason that still rules arr out', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('status')).toHaveTextContent(/full host/);
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: /Existing Stremio URL addons/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const reason = 'The arr workflow needs a supported debrid or NZB backend.';
		expect(screen.getByRole('status').textContent).toBe(
			`Automation with Sonarr/Radarr was reset to “I am not sure yet”. ${reason}`
		);
		expect(screen.getByRole('radio', { name: ARR })).toHaveTextContent(
			`Unavailable: ${reason}`
		);
		expectArrReset();
	});

	it('keeps arr when a new player drops the Android host that is asked again later', () => {
		reachStremioRecommendation(ARR);
		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /Android \/ Google TV/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectArrKept();
	});

	it('drops the arr reset notice once the setup is submitted and edited again', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Automation with Sonarr\/Radarr/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('Can a machine stay on while you watch?');
		fireEvent.click(screen.getByRole('radio', { name: /No host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('status')).toHaveTextContent(
			/Automation with Sonarr\/Radarr was reset to/
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('Where do you want to watch?');
		expect(
			screen.getByRole('heading', { name: 'Where do you want to watch?' })
		).toBeInTheDocument();
		expect(
			screen.queryByText(/Automation with Sonarr\/Radarr was reset to/)
		).not.toBeInTheDocument();
	});

	it('keeps arr enabled and executable when a full host is selected', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('radio', {
			name: /Automation with Sonarr\/Radarr/,
		});
		expect(arr).toHaveAttribute('aria-disabled', 'false');
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
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectUnavailable(screen.getByRole('radio', { name: /Android \/ Google TV/ }));
		expect(
			screen.getByText(
				'Unavailable: Plex Media Server needs a full server host; zurg Android cannot give a server on that device a library.'
			)
		).toBeInTheDocument();
	});

	it('offers Android for rex, which zurg+rex Android runs on the device', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Use rex for Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const android = screen.getByRole('radio', { name: /Android \/ Google TV/ });
		expect(android).toHaveAttribute('aria-disabled', 'false');
		fireEvent.click(android);
		expect(android).toHaveAttribute('aria-checked', 'true');
	});

	function editAnswer(question: string) {
		const row = screen.getByText(question).parentElement?.parentElement;
		expect(row).not.toBeNull();
		fireEvent.click(
			within(row as HTMLElement).getByRole('button', { name: `Edit ${question}` })
		);
	}

	const ANDROID = /Android \/ Google TV/;

	function expectAndroidDropped(
		reason = 'zurg Android has no TorBox hosted NZB backend; that route needs a normal host.'
	) {
		const group = screen.getByRole('radiogroup', {
			name: 'Can a machine stay on while you watch?',
		});
		expect(
			within(group)
				.getAllByRole('radio')
				.filter((radio) => radio.getAttribute('aria-checked') === 'true')
		).toEqual([]);
		expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
		expectUnavailable(screen.getByRole('radio', { name: ANDROID }));
		expect(screen.getByText(`Unavailable: ${reason}`)).toBeInTheDocument();
	}

	function expectAndroidKept() {
		expect(
			screen.getByRole('heading', { name: 'Can a machine stay on while you watch?' })
		).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: ANDROID })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
	}

	it('drops an Android host on leaving the sources step once TorBox hosted NZBs would need zurg on it', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Android \/ Google TV/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidDropped();
	});

	it('keeps an Android host when TorBox hosted NZBs are ticked and unticked again', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: ANDROID }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('What do you already have?');
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidKept();
	});

	it('drops an Android host on leaving the player step for one that would play TorBox hosted NZBs through zurg', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /TorBox Pro hosted NZBs/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Android \/ Google TV/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('Where do you want to watch?');
		fireEvent.click(screen.getByRole('radio', { name: /WebDAV or SMB player/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidDropped();
	});

	it('keeps an Android host when arrowing across Plex apps and back', async () => {
		const user = userEvent.setup();
		reachStremioRecommendation(/Choose and play as I go/, ANDROID);
		editAnswer('Where do you want to watch?');
		screen.getByRole('radio', { name: /Stremio/ }).focus();
		await user.keyboard('{ArrowDown}{ArrowDown}');
		expect(screen.getByRole('radio', { name: /Plex apps/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await user.keyboard('{ArrowUp}{ArrowUp}');
		expect(screen.getByRole('radio', { name: /Stremio/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await user.click(screen.getByRole('button', { name: 'Next' }));
		await user.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidKept();
	});

	it('drops an Android host on leaving the player step for Plex apps', () => {
		reachStremioRecommendation(/Choose and play as I go/, ANDROID);
		editAnswer('Where do you want to watch?');
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expectAndroidDropped(
			'Plex Media Server needs a full server host; zurg Android cannot give a server on that device a library.'
		);
	});

	it('keeps the Plex route when arrowing to another player and back to Plex', async () => {
		const user = userEvent.setup();
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Use rex for Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /A managed library/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		editAnswer('Where do you want to watch?');
		screen.getByRole('radio', { name: /Plex apps/ }).focus();
		await user.keyboard('{ArrowDown}');
		expect(screen.getByRole('radio', { name: /^Jellyfin/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await user.keyboard('{ArrowUp}');
		await user.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How should Plex get the library?' })
		).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /Use rex for Plex apps/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
	});

	it('says only the Sonarr/Radarr choice changes the route', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByText(
				'Only the Sonarr/Radarr choice changes the route; a managed library can add Wanted notes and benefits.'
			)
		).toBeInTheDocument();
	});

	it('moves focus to the next question for keyboard users', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
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
			'rex and rex-stremio do not require sponsorship; any sponsor benefits below apply to the zurg, rex-stremio, API or help parts of the setup.',
		],
	])('names rex-stremio as free only where it is offered (%s)', (source, footnote) => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Use rex for Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: source }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /An existing server or host/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('radio', { name: /Choose and play as I go/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'See my setup' }));

		expect(
			within(screen.getByTestId('sponsorship-section')).getByText(footnote)
		).toBeInTheDocument();
	});

	it('requires the conditional Plex choice before continuing', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Plex apps/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			screen.getByRole('heading', { name: 'How should Plex get the library?' })
		).toBeInTheDocument();
		const next = screen.getByRole('button', { name: 'Next' });
		expect(next).toBeDisabled();
		fireEvent.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
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

		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Where do you want to watch?' })
		);
		expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
		expect(screen.getByRole('radio', { name: /Stremio/ })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('leaves focus at the top on first load and moves it with each step after that', () => {
		render(<ChooseYourSetupPage />);

		const first = screen.getByRole('heading', { name: 'Where do you want to watch?' });
		expect(document.activeElement).not.toBe(first);
		expect(document.activeElement).toBe(document.body);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'What do you already have?' })
		);
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Where do you want to watch?' })
		);
	});

	it('moves focus to the edited question from the result', () => {
		reachStremioRecommendation();
		editAnswer('Can a machine stay on while you watch?');

		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Can a machine stay on while you watch?' })
		);
	});

	it('reads the progress bar out as the question number', () => {
		render(<ChooseYourSetupPage />);
		expect(screen.getByRole('progressbar')).toHaveAttribute(
			'aria-valuetext',
			'Question 1 of 5'
		);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('progressbar')).toHaveAttribute(
			'aria-valuetext',
			'Question 2 of 5'
		);
	});

	it('presents a single-choice step as radios named by its question', () => {
		render(<ChooseYourSetupPage />);

		const group = screen.getByRole('radiogroup', { name: 'Where do you want to watch?' });
		const stremio = within(group).getByRole('radio', { name: /Stremio/ });
		expect(stremio).toHaveAttribute('aria-checked', 'false');
		expect(stremio).not.toHaveAttribute('aria-pressed');
		fireEvent.click(stremio);
		expect(stremio).toHaveAttribute('aria-checked', 'true');
		expect(
			within(group)
				.getAllByRole('radio')
				.filter((radio) => radio.getAttribute('aria-checked') === 'true')
		).toEqual([stremio]);
	});

	it('presents a multi-select step as toggle buttons named by its question', () => {
		render(<ChooseYourSetupPage />);
		fireEvent.click(screen.getByRole('radio', { name: /Stremio/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		const group = screen.getByRole('group', { name: 'What do you already have?' });
		expect(within(group).queryAllByRole('radio')).toEqual([]);
		const realDebrid = within(group).getByRole('button', { name: /Real-Debrid/ });
		const easynews = within(group).getByRole('button', { name: /Easynews/ });
		expect(realDebrid).not.toHaveAttribute('aria-checked');
		fireEvent.click(realDebrid);
		fireEvent.click(easynews);
		expect(realDebrid).toHaveAttribute('aria-pressed', 'true');
		expect(easynews).toHaveAttribute('aria-pressed', 'true');
		expect(within(group).getAllByText('Select all that apply')[0]).toHaveClass('text-gray-400');
	});

	it('toggles cards with Enter and Space and reaches an unavailable card with Tab', async () => {
		const user = userEvent.setup();
		render(<ChooseYourSetupPage />);
		const stremio = screen.getByRole('radio', { name: /Stremio/ });
		stremio.focus();
		await user.keyboard('{Enter}');
		expect(stremio).toHaveAttribute('aria-checked', 'true');
		await user.click(screen.getByRole('button', { name: 'Next' }));

		const realDebrid = screen.getByRole('button', { name: /Real-Debrid/ });
		realDebrid.focus();
		await user.keyboard(' ');
		expect(realDebrid).toHaveAttribute('aria-pressed', 'true');
		await user.keyboard('{Enter}');
		expect(realDebrid).toHaveAttribute('aria-pressed', 'false');
		await user.keyboard(' ');
		await user.click(screen.getByRole('button', { name: 'Next' }));
		await user.click(screen.getByRole('radio', { name: /No host/ }));
		await user.click(screen.getByRole('button', { name: 'Next' }));

		const arr = screen.getByRole('radio', { name: ARR });
		for (let i = 0; i < 10 && document.activeElement !== arr; i++) await user.tab();
		expect(document.activeElement).toBe(arr);
		expect(arr).toHaveAccessibleName(/Unavailable: The arr workflow needs/);
		await user.keyboard('{Enter}');
		await user.keyboard(' ');
		expect(arr).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByRole('radio', { name: /I am not sure yet/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	it('moves and selects with arrow keys inside a radio group, skipping unavailable cards', async () => {
		const user = userEvent.setup();
		render(<ChooseYourSetupPage />);
		const stremio = screen.getByRole('radio', { name: /Stremio/ });
		const kodi = screen.getByRole('radio', { name: /Kodi/ });
		stremio.focus();
		await user.keyboard('{ArrowRight}');
		expect(document.activeElement).toBe(kodi);
		expect(kodi).toHaveAttribute('aria-checked', 'true');
		await user.keyboard('{ArrowLeft}');
		expect(document.activeElement).toBe(stremio);
		expect(stremio).toHaveAttribute('aria-checked', 'true');
		expect(kodi).toHaveAttribute('aria-checked', 'false');

		await user.click(screen.getByRole('radio', { name: /Plex apps/ }));
		await user.click(screen.getByRole('button', { name: 'Next' }));
		await user.click(screen.getByRole('radio', { name: /Keep my existing Plex Media Server/ }));
		await user.click(screen.getByRole('button', { name: 'Next' }));
		await user.click(screen.getByRole('button', { name: /Real-Debrid/ }));
		await user.click(screen.getByRole('button', { name: 'Next' }));

		const existing = screen.getByRole('radio', { name: /An existing server or host/ });
		const willing = screen.getByRole('radio', { name: /I can run a host/ });
		const android = screen.getByRole('radio', { name: /Android \/ Google TV/ });
		const noHost = screen.getByRole('radio', { name: /No host/ });
		expectUnavailable(android);
		willing.focus();
		await user.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(noHost);
		expect(noHost).toHaveAttribute('aria-checked', 'true');
		expect(android).toHaveAttribute('aria-checked', 'false');
		await user.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(existing);
		await user.keyboard('{ArrowUp}');
		expect(document.activeElement).toBe(noHost);
		await user.keyboard('{Home}');
		expect(document.activeElement).toBe(existing);
		await user.keyboard('{End}');
		expect(document.activeElement).toBe(noHost);
		expect(noHost).toHaveAttribute('aria-checked', 'true');
	});

	it('gives the question labels under Your answers readable contrast', () => {
		reachStremioRecommendation();

		const label = screen.getByText('What do you already have?');
		expect(label).toHaveClass('text-gray-400');
		expect(label).not.toHaveClass('text-gray-500');
	});
});
