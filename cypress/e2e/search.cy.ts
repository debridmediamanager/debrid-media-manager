describe('Search Page', () => {
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

	it('renders the search page', () => {
		cy.visit('/search', authSetup);
		cy.get('input').should('exist');
	});

	it('performs a search and shows results', () => {
		cy.intercept('GET', '**/api/search/title*', {
			statusCode: 200,
			body: {
				results: [
					{
						imdbid: 'tt0111161',
						title: 'The Shawshank Redemption',
						year: 1994,
						type: 'movie',
						poster: '',
					},
					{
						imdbid: 'tt0068646',
						title: 'The Godfather',
						year: 1972,
						type: 'movie',
						poster: '',
					},
				],
			},
		}).as('searchResults');

		cy.visit('/search?query=shawshank', authSetup);
		cy.wait('@searchResults');
		cy.contains('The Shawshank Redemption').should('be.visible');
	});

	it('shows error message on search failure', () => {
		cy.intercept('GET', '**/api/search/title*', {
			statusCode: 500,
			body: { errorMessage: 'Failed to fetch search results' },
		}).as('searchError');

		cy.visit('/search?query=test', authSetup);
		cy.wait('@searchError');
		cy.contains('Failed to fetch search results').should('be.visible');
	});
});
