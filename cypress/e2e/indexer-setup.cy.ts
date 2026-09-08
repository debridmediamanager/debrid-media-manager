// The two indexer setup pages, in a real browser.
//
// Both render a credential, so the thing worth checking here rather than in
// jsdom is what actually reaches the screen: the key masked by default, the
// whole key only after asking, and the clipboard carrying the whole key either
// way. The guide itself is shown to everyone, so a seeded token only decides
// whether the sponsorship pitch sits above it.

const API_KEY = 'a1b2c3' + 'd'.repeat(54) + 'ef12';
const MASKED = 'a1b2c3••••••••ef12';

/** The page decodes this client-side; the signature is only checked server-side. */
function sponsorToken(): string {
	const claims = {
		shortId: 'ZP1M',
		githubUsername: 'someone',
		sources: ['github'],
		keyVersion: 1,
		exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
	};
	return `${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;
}

function visitAsSponsor(path: string, apiKey: string | null) {
	cy.visit(path, {
		onBeforeLoad(win) {
			win.localStorage.setItem('dmm:sponsorToken', JSON.stringify(sponsorToken()));
			if (apiKey) win.localStorage.setItem('dmm:apiKey', JSON.stringify(apiKey));
		},
	});
}

function visitAsVisitor(path: string) {
	cy.visit(path, { onBeforeLoad: (win) => win.localStorage.clear() });
}

for (const { name, path, indexerUrl } of [
	{ name: 'Newznab', path: '/newznab', indexerUrl: '/api/newznab' },
	{ name: 'Torznab', path: '/torznab', indexerUrl: '/api/torznab' },
]) {
	describe(`${name} setup page`, () => {
		it('fills in the indexer URL for the instance it is served from', () => {
			visitAsSponsor(path, API_KEY);
			cy.get('[data-testid="field-URL"]').should('contain', indexerUrl);
			cy.get('[data-testid="field-API Path"]').should('contain', '/api');
		});

		it('shows the linked key masked, and reveals it on request', () => {
			visitAsSponsor(path, API_KEY);

			cy.get('[data-testid="field-API Key"]').should('contain', MASKED);
			cy.contains(API_KEY).should('not.exist');

			cy.get('[aria-label="Reveal API key"]').click();
			cy.get('[data-testid="field-API Key"]').should('contain', API_KEY);

			cy.get('[aria-label="Hide API key"]').click();
			cy.get('[data-testid="field-API Key"]').should('contain', MASKED);
		});

		it('copies the whole key, not the masked form', () => {
			visitAsSponsor(path, API_KEY);

			// The clipboard needs a permission this run does not have, so the call
			// is captured instead — what matters is the value handed to it.
			cy.window().then((win) => {
				cy.stub(win.navigator.clipboard, 'writeText').as('writeText').resolves();
			});
			cy.get('[aria-label="Copy API Key"]').click();
			cy.get('@writeText').should('have.been.calledWith', API_KEY);
		});

		it('points at gatekeeper when this browser has no key', () => {
			visitAsSponsor(path, null);

			cy.get('[data-testid="field-API Key"]').should(
				'contain',
				'your DMM API key from gatekeeper'
			);
			cy.get('[aria-label="Reveal API key"]').should('not.exist');
		});

		it('offers a way back to the dashboard', () => {
			visitAsSponsor(path, API_KEY);
			cy.contains('a', 'Back to dashboard').should('have.attr', 'href', '/');
		});

		// The guide used to be replaced wholesale by the pitch, which withheld
		// the setup from everyone being asked to pay for it. The endpoint checks
		// the key on every request, so the page can show the whole thing.
		it('shows the same guide to someone who has not linked a sponsorship', () => {
			visitAsVisitor(path);

			cy.get('[data-testid="field-URL"]').should('contain', indexerUrl);
			cy.get('[data-testid="field-API Key"]').should(
				'contain',
				'your DMM API key from gatekeeper'
			);
			cy.contains('A sponsor feature').should('exist');
			cy.contains('a', 'gatekeeper').should(
				'have.attr',
				'href',
				'https://gatekeeper.debridmediamanager.com'
			);
		});
	});
}
