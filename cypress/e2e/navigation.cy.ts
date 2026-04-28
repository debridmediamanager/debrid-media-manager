describe('Navigation', () => {
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

	it('navigates from home to library', () => {
		cy.visit('/', authSetup);
		cy.contains('Library').click();
		cy.url().should('include', '/library');
	});

	it('navigates from home to settings', () => {
		cy.visit('/', authSetup);
		cy.contains('Settings').click();
		cy.url().should('include', '/settings');
	});

	it('navigates from settings back to home', () => {
		cy.visit('/settings', authSetup);
		cy.contains('Back to dashboard').click();
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});

	it('navigates from library to home', () => {
		cy.visit('/library', authSetup);
		cy.contains('Go Home').click();
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});

	it('navigates from browse to home', () => {
		cy.visit('/browse', authSetup);
		cy.contains('Go Home').click();
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});

	it('navigates from home to browse genres', () => {
		cy.visit('/browse', authSetup);
		cy.contains('Action').click();
		cy.url().should('include', '/browse/genre/action');
	});

	it('navigates from calendar to home', () => {
		cy.visit('/calendar', authSetup);
		cy.contains('Go Home').click();
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});

	it('unauthenticated user is redirected to /start', () => {
		cy.visit('/');
		cy.url().should('include', '/start');
	});

	it('authenticated user visiting /start is redirected home', () => {
		cy.visit('/start', authSetup);
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});
});
