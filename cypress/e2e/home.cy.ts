describe('Home Page (Authenticated)', () => {
	beforeEach(() => {
		cy.intercept('GET', '**/rest/1.0/user', {
			statusCode: 200,
			body: {
				id: 12345,
				username: 'testuser',
				email: 'test@example.com',
				points: 100,
				locale: 'en',
				avatar: '',
				type: 'premium',
				premium: 31536000,
				expiration: '2099-12-31T23:59:59.000Z',
			},
		}).as('rdUser');

		cy.visit('/', {
			onBeforeLoad(win) {
				win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
				win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
				win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
				win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
			},
		});
	});

	it('renders the home page with title', () => {
		cy.contains('Debrid Media Manager').should('be.visible');
	});

	it('shows the search bar', () => {
		cy.get('input[type="text"], input[type="search"]').should('exist');
	});

	it('shows navigation action buttons', () => {
		cy.contains('Library').should('exist');
		cy.contains('Settings').should('exist');
	});

	it('shows the Real-Debrid service card with username', () => {
		cy.contains('Real-Debrid').should('exist');
		cy.contains('testuser').should('exist');
	});
});
