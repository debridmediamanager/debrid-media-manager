describe('Auth Redirects', () => {
	beforeEach(() => {
		cy.clearLocalStorage();
	});

	it('redirects unauthenticated users from / to /start', () => {
		cy.visit('/');
		cy.url().should('include', '/start');
		cy.contains('Welcome to Debrid Media Manager').should('be.visible');
	});

	it('redirects unauthenticated users from /library to /start', () => {
		cy.visit('/library');
		cy.url().should('include', '/start');
	});

	it('redirects unauthenticated users from /search to /start', () => {
		cy.visit('/search');
		cy.url().should('include', '/start');
	});

	it('redirects unauthenticated users from /settings to /start', () => {
		cy.visit('/settings');
		cy.url().should('include', '/start');
	});

	it('redirects unauthenticated users from /browse to /start', () => {
		cy.visit('/browse');
		cy.url().should('include', '/start');
	});

	it('redirects authenticated users from /start to /', () => {
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

		cy.visit('/start', {
			onBeforeLoad(win) {
				win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
				win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
				win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
				win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
			},
		});
		cy.url().should('not.include', '/start');
	});
});
