describe('Browse Recently Updated', () => {
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

	it('renders the recently updated page', () => {
		cy.visit('/browse/recent', authSetup);
		cy.url().should('include', '/browse/recent');
	});

	it('has a Go Home link', () => {
		cy.visit('/browse/recent', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('shows loading state', () => {
		cy.intercept('GET', '**/api/browse/recent*', (req) => {
			req.reply({ delay: 2000, body: [] });
		});

		cy.visit('/browse/recent', authSetup);
		// Loading spinner is an animated div, not text
		cy.get('.animate-spin').should('be.visible');
	});

	it('displays poster grid when data loads', () => {
		cy.intercept('GET', '**/api/browse/recent*', {
			statusCode: 200,
			body: ['movie:tt0111161', 'movie:tt0068646'],
		}).as('browseResults');

		cy.visit('/browse/recent', authSetup);
		cy.wait('@browseResults');
		// Posters render as links wrapping Poster components
		cy.get('a[href="/movie/tt0111161"]').should('exist');
	});
});
