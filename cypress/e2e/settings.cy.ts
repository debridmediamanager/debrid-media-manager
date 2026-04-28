describe('Settings Page', () => {
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

	it('renders the settings page with title', () => {
		cy.visit('/settings', authSetup);
		cy.title().should('include', 'Settings');
	});

	it('has a back to dashboard link', () => {
		cy.visit('/settings', authSetup);
		cy.contains('Back to dashboard').should('be.visible').click();
		cy.url().should('eq', Cypress.config().baseUrl + '/');
	});
});
