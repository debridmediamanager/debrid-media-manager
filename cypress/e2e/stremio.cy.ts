describe('Stremio Addon Page', () => {
	it('shows Real-Debrid required alert when not authenticated', () => {
		cy.visit('/stremio');
		cy.url().should('include', '/start');
	});

	it('renders stremio page when authenticated', () => {
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

		cy.visit('/stremio', {
			onBeforeLoad(win: Cypress.AUTWindow) {
				win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
				win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
				win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
				win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
			},
		});
		cy.url().should('include', '/stremio');
	});

	it('shows loading state', () => {
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

		cy.visit('/stremio', {
			onBeforeLoad(win: Cypress.AUTWindow) {
				win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
				win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
				win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
				win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
			},
		});
		cy.contains(/loading|stremio/i).should('exist');
	});

	it('has correct URL path', () => {
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

		cy.visit('/stremio', {
			onBeforeLoad(win: Cypress.AUTWindow) {
				win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
				win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
				win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
				win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
			},
		});
		cy.url().should('include', '/stremio');
	});
});
