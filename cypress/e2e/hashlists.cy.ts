describe('Hashlists Page', () => {
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
	});

	it('renders the hashlists page', () => {
		cy.visit('/hashlists', authSetup);
		cy.url().should('include', '/hashlists');
	});

	it('shows icon navigation buttons', () => {
		cy.visit('/hashlists', authSetup);
		cy.get('button[title="Previous"], button[title="Next"], button[title="Random"]').should(
			'have.length.greaterThan',
			0
		);
	});

	it('has a home link', () => {
		cy.visit('/hashlists', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('shows loading state', () => {
		// The page fetches from GitHub API directly
		cy.intercept(
			'GET',
			'**/api.github.com/repos/debridmediamanager/hashlists/contents*',
			(req) => {
				req.reply({ delay: 2000, body: [] });
			}
		);

		cy.visit('/hashlists', authSetup);
		// Loading text shown in the status area
		cy.contains('Loading hashlists...').should('be.visible');
	});

	it('shows error on failed load', () => {
		cy.intercept('GET', '**/api.github.com/repos/debridmediamanager/hashlists/contents*', {
			statusCode: 500,
			body: { message: 'Failed to fetch hashlists' },
		}).as('hashlistError');

		cy.visit('/hashlists', authSetup);
		cy.wait('@hashlistError');
		// The page shows the error message from the fetch response
		cy.get('.text-red-400').should('be.visible');
	});
});
