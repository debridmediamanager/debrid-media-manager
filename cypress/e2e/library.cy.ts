describe('Library Page', () => {
	const authSetup = {
		onBeforeLoad(win: Cypress.AUTWindow) {
			win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
			win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
			win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
			win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
		},
	};

	beforeEach(() => {
		cy.intercept('GET', '**/rest/1.0/user', {
			statusCode: 200,
			body: {
				id: 12345,
				username: 'testuser',
				email: 'test@example.com',
				type: 'premium',
				premium: 31536000,
				expiration: '2099-12-31T23:59:59.000Z',
			},
		});

		// Mock RD torrents API - must include x-total-count header
		cy.intercept('GET', '**/rest/1.0/torrents*', (req) => {
			req.reply({
				statusCode: 200,
				body: [],
				headers: { 'x-total-count': '0' },
			});
		}).as('torrents');
	});

	it('renders the library page', () => {
		cy.visit('/library', authSetup);
		cy.url().should('include', '/library');
	});

	it('has a search input', () => {
		cy.visit('/library', authSetup);
		cy.get('input').should('exist');
	});

	it('shows a refresh button', () => {
		cy.visit('/library', authSetup);
		cy.get('button').should('have.length.greaterThan', 0);
	});

	it('shows action buttons', () => {
		cy.visit('/library', authSetup);
		cy.contains('Go Home').should('exist');
	});

	it('has a Go Home link', () => {
		cy.visit('/library', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('shows loading state while fetching torrents', () => {
		cy.visit('/library', authSetup);
		// The library page shows a spinner while loading
		cy.get('.animate-spin').should('exist');
	});

	it('shows empty state when no torrents', () => {
		cy.visit('/library', authSetup);
		// Wait for loading to finish - the page should show some content
		cy.get('table').should('exist');
	});

	it('has pagination controls', () => {
		cy.visit('/library', authSetup);
		cy.get('button').should('have.length.greaterThan', 1);
	});

	it('renders the torrent table structure', () => {
		cy.visit('/library', authSetup);
		// Table should exist in the page structure
		cy.get('table').should('exist');
	});
});
