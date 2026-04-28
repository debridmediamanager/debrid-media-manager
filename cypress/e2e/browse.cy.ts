describe('Browse Page', () => {
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

	it('shows genre grid when no search term', () => {
		cy.visit('/browse', authSetup);
		cy.contains('Browse').should('be.visible');
		cy.contains('Action').should('be.visible');
		cy.contains('Comedy').should('be.visible');
		cy.contains('Drama').should('be.visible');
		cy.contains('Horror').should('be.visible');
		cy.contains('Thriller').should('be.visible');
	});

	it('has a Go Home link', () => {
		cy.visit('/browse', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('navigates to genre page on click', () => {
		cy.visit('/browse', authSetup);
		cy.contains('Action').click();
		cy.url().should('include', '/browse/genre/action');
	});

	it('shows loading state when searching', () => {
		cy.intercept('GET', '**/api/info/browse*', (req) => {
			req.reply({ delay: 2000, body: {} });
		});

		cy.visit('/browse/test-search', authSetup);
		cy.contains('Loading').should('be.visible');
	});
});
